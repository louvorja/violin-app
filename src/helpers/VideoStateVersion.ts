import type { VideoMediaState } from "@/types/Media";

function validPlaybackId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/** Gera revisões monotônicas, reiniciadas apenas quando muda o playback. */
export class VideoStateRevisionCounter {
  private playbackId: string | null = null;
  private revision = 0;

  next(
    playbackId: string | null | undefined
  ): Pick<VideoMediaState, "playback_id" | "revision"> | null {
    if (!validPlaybackId(playbackId)) return null;
    if (playbackId !== this.playbackId) {
      this.playbackId = playbackId;
      this.revision = 0;
    }
    this.revision += 1;
    return { playback_id: playbackId, revision: this.revision };
  }

  reset(): void {
    this.playbackId = null;
    this.revision = 0;
  }
}

/** Protege um consumidor contra pacotes atrasados, ambíguos ou malformados. */
export class VideoStateGate {
  private expectedPlaybackId: string | null = null;
  private lastRevision = 0;

  begin(playbackId?: string | null): void {
    const expected = validPlaybackId(playbackId) ? playbackId : null;
    // Replays do mesmo FILE_PROJECTION não devem zerar a monotonicidade.
    if (expected && expected === this.expectedPlaybackId) return;
    this.expectedPlaybackId = expected;
    this.lastRevision = 0;
  }

  clear(): void {
    this.expectedPlaybackId = null;
    this.lastRevision = 0;
  }

  accepts(state: VideoMediaState | null | undefined): boolean {
    if (!state || typeof state !== "object") return false;
    if (!validPlaybackId(state.playback_id) || !validRevision(state.revision)) return false;
    if (!this.expectedPlaybackId || state.playback_id !== this.expectedPlaybackId) return false;
    if (state.revision <= this.lastRevision) return false;
    if (!Number.isFinite(state.currentTime) || state.currentTime < 0 ||
        !(state.duration === Infinity || (Number.isFinite(state.duration) && state.duration >= 0)) ||
        typeof state.isPaused !== "boolean") return false;
    if (state.sampledAt !== undefined && (!Number.isFinite(state.sampledAt) || state.sampledAt < 0)) return false;
    if (state.position !== undefined && (!Number.isFinite(state.position) || state.position < 0)) return false;
    if (state.playing !== undefined && state.playing !== !state.isPaused) return false;
    if (state.rate !== undefined && (!Number.isFinite(state.rate) || state.rate <= 0)) return false;

    this.lastRevision = state.revision;
    return true;
  }
}
