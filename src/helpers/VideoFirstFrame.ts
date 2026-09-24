type VideoFrameCallback = (_now: number, _metadata: unknown) => void;

type VideoElement = {
  requestVideoFrameCallback?: (_callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (_handle: number) => void;
  readyState: number;
};

type Track = (_event: string, _properties: Record<string, unknown>) => void;

const MAX_DURATION_MS = 60_000;
const MAX_SEEN_PLAYBACKS = 32;

/** Uma amostra por playback nesta janela; rVFC confirma frame decodificada, não paint físico. */
export class VideoFirstFrame {
  private active = false;
  private playbackId: string | null = null;
  private revision: number | null = null;
  private startedAt = 0;
  private video: VideoElement | null = null;
  private handle: number | null = null;
  private sample: { kind: "decoded_frame" | "media_ready"; elapsedMs: number } | null = null;
  private readonly seen = new Set<string>();
  private generation = 0;

  constructor(
    private readonly role: "projection" | "return",
    private readonly track: Track,
    private readonly now: () => number = () => performance.now()
  ) {}

  begin(playbackId: string | null | undefined): void {
    if (this.active && this.playbackId === (playbackId || null)) return;
    this.cancel();
    this.active = true;
    this.playbackId = typeof playbackId === "string" && playbackId ? playbackId : null;
    this.revision = null;
    this.sample = null;
    this.startedAt = this.now();
  }

  attach(video: VideoElement | null): void {
    if (!this.active || !video || (this.playbackId && this.seen.has(this.playbackId))) return;
    if (this.video === video) return;
    this.cancelCallback();
    this.video = video;
    if (typeof video.requestVideoFrameCallback !== "function") return;
    const generation = this.generation;
    this.handle = video.requestVideoFrameCallback(() => {
      if (generation !== this.generation || this.video !== video) return;
      this.handle = null;
      this.sample = { kind: "decoded_frame", elapsedMs: this.elapsed() };
      this.emit();
    });
  }

  acceptRevision(revision: number | null | undefined, playbackId?: string): void {
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) return;
    if (!this.playbackId && typeof playbackId === "string" && playbackId) this.playbackId = playbackId;
    this.revision = Number(revision);
    this.emit();
  }

  mediaReady(video: VideoElement | null): void {
    if (!video || !this.active || video.readyState < 2) return;
    this.attach(video);
    if (typeof video.requestVideoFrameCallback === "function" || this.sample) return;
    this.sample = { kind: "media_ready", elapsedMs: this.elapsed() };
    this.emit();
  }

  private elapsed(): number {
    return Math.round(Math.min(MAX_DURATION_MS, Math.max(0, this.now() - this.startedAt)));
  }

  private emit(): void {
    if (!this.playbackId || this.revision === null || !this.sample || this.seen.has(this.playbackId)) return;
    const { kind, elapsedMs } = this.sample;
    this.seen.add(this.playbackId);
    while (this.seen.size > MAX_SEEN_PLAYBACKS) this.seen.delete(this.seen.values().next().value!);
    this.track(kind === "decoded_frame" ? "projection_video_first_decoded_frame" : "projection_video_media_ready", {
      role: this.role,
      playback_id: this.playbackId,
      revision: this.revision,
      elapsed_ms: elapsedMs,
      measurement_method: kind === "decoded_frame" ? "requestVideoFrameCallback" : "readyState",
    });
    this.cancelCallback();
  }

  private cancelCallback(): void {
    this.generation++;
    if (this.handle !== null) this.video?.cancelVideoFrameCallback?.(this.handle);
    this.handle = null;
    this.video = null;
  }

  cancel(): void {
    this.cancelCallback();
    this.sample = null;
    this.active = false;
  }

  dispose(): void {
    this.cancel();
    this.playbackId = null;
  }
}
