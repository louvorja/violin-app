import type { VideoMediaState } from "@/types/Media";
import type { SyncAction } from "@/helpers/VideoSync";

type VideoFrameCallback = (_now: number, _metadata: unknown) => void;

export type FrameConfirmableVideo = {
  requestVideoFrameCallback?: (_callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (_handle: number) => void;
};

type Track = (_event: string, _properties: Record<string, unknown>) => void;

type Scheduler = {
  now: () => number;
  requestAnimationFrame: (_callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (_handle: number) => void;
  setTimeout: (_callback: () => void, _timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (_handle: ReturnType<typeof setTimeout>) => void;
};

export const VIDEO_FRAME_SLOW_MS = 1_500;

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  requestAnimationFrame: (callback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
  setTimeout: (callback, timeout) => setTimeout(callback, timeout),
  clearTimeout: (handle) => clearTimeout(handle),
};

type PendingFrame = {
  token: number;
  video: FrameConfirmableVideo;
  callbackHandle: number;
  callbackKind: "decoded_frame" | "animation_frame_opportunity";
  slowTimer: ReturnType<typeof setTimeout>;
  slowReported: boolean;
  properties: Record<string, unknown>;
};

/**
 * Confirma uma única apresentação após uma correção significativa de VIDEO_STATE.
 *
 * `requestVideoFrameCallback` é a única prova de que uma frame de vídeo foi
 * apresentada. O fallback de rAF existe somente para diagnosticar oportunidade de
 * pintura em navegadores antigos e sempre é marcado como tal.
 */
export class VideoFrameConfirmation {
  private pending: PendingFrame | null = null;
  private token = 0;
  private lastPlaybackId: string | null = null;
  private lastPaused: boolean | null = null;

  constructor(
    private readonly _eventPrefix: string,
    private readonly _track: Track,
    private readonly _scheduler: Scheduler = browserScheduler
  ) {}

  observe(
    video: FrameConfirmableVideo | null,
    state: VideoMediaState,
    syncAction: SyncAction
  ): void {
    const playbackId = state.playback_id;
    const revision = state.revision;
    if (!video || typeof playbackId !== "string" || !Number.isSafeInteger(revision)) return;

    const firstForPlayback = playbackId !== this.lastPlaybackId;
    const pausedChanged = !firstForPlayback && this.lastPaused !== state.isPaused;
    this.lastPlaybackId = playbackId;
    this.lastPaused = state.isPaused;

    // As demais mensagens só ajustam a taxa ou confirmam que já está alinhado.
    // Não observá-las evita transformar o sincronismo periódico em telemetria por frame.
    if (!firstForPlayback && !pausedChanged && syncAction !== "seek") return;

    this.cancel();
    const token = ++this.token;
    const properties = {
      playback_id: playbackId,
      revision,
      sync_action: syncAction,
    };
    const startedAt = this._scheduler.now();
    const hasVideoFrameCallback = typeof video.requestVideoFrameCallback === "function";
    const callbackKind = hasVideoFrameCallback
      ? "decoded_frame"
      : "animation_frame_opportunity";

    const onCallback = () => {
      if (this.pending?.token !== token) return;
      const elapsedMs = Math.max(0, this._scheduler.now() - startedAt);
      const pending = this.pending;
      this.pending = null;
      this._scheduler.clearTimeout(pending.slowTimer);
      this._track(
        `${this._eventPrefix}_${
          callbackKind === "decoded_frame" ? "frame_presented" : "frame_opportunity"
        }`,
        {
          ...properties,
          elapsed_ms: elapsedMs,
          measurement_method: callbackKind,
          actual_decoded_frame: callbackKind === "decoded_frame",
        }
      );
    };

    const callbackHandle = hasVideoFrameCallback
      ? video.requestVideoFrameCallback!(onCallback)
      : this._scheduler.requestAnimationFrame(onCallback);
    const slowTimer = this._scheduler.setTimeout(() => {
      if (this.pending?.token !== token) return;
      if (this.pending.slowReported) return;
      this.pending.slowReported = true;
      this._track(`${this._eventPrefix}_frame_slow`, {
        ...properties,
        elapsed_ms: Math.max(0, this._scheduler.now() - startedAt),
        measurement_method: callbackKind,
        actual_decoded_frame: false,
      });
    }, VIDEO_FRAME_SLOW_MS);
    this.pending = {
      token,
      video,
      callbackHandle,
      callbackKind,
      slowTimer,
      slowReported: false,
      properties,
    };
  }

  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    this._scheduler.clearTimeout(pending.slowTimer);
    if (pending.callbackKind === "decoded_frame") {
      pending.video.cancelVideoFrameCallback?.(pending.callbackHandle);
    } else {
      this._scheduler.cancelAnimationFrame(pending.callbackHandle);
    }
  }

  dispose(): void {
    this.cancel();
    this.lastPlaybackId = null;
    this.lastPaused = null;
  }
}
