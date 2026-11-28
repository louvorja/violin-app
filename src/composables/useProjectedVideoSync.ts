import { ref, type Ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  reportVideoFailure,
  type VideoFailure,
} from "@/helpers/LocalFileStatus";
import {
  mediaDiagnosticLog,
  mediaDiagnosticMessage,
  mediaElementDetails,
  mediaSourceDetails,
} from "@/helpers/MediaDiagnostics";
import Telemetry from "@/helpers/Telemetry";
import { VideoFirstFrame } from "@/helpers/VideoFirstFrame";
import { VideoFrameConfirmation } from "@/helpers/VideoFrameConfirmation";
import { VideoStateGate } from "@/helpers/VideoStateVersion";
import { applyVideoState } from "@/helpers/VideoSync";
import type { VideoMediaState } from "@/types/Media";

export interface ProjectedVideoSyncOptions {
  videoRef: Ref<HTMLVideoElement | null>;
  isVideoActive: () => boolean;
  getPlaybackId: () => string | undefined;
  getSourceUrl: () => string;
  windowRole: "auxiliary" | "auxiliary_return" | "background_projection" | "background_projection_return";
  firstFrameRole: "projection" | "return";
  /** Prefixo para telemetria/eventos (ex.: "file_projection_video", "background_projection_video"). */
  telemetryPrefix: string;
  logLabel: string;
  logPrefix: string;
}

/**
 * Sincroniza um `<video>` mudo de projeção/retorno com o relógio principal via
 * `VIDEO_STATE`, evitando autoplay antes do áudio carregar e mantendo seeks/pausas alinhados.
 */
export function useProjectedVideoSync(options: ProjectedVideoSyncOptions) {
  const videoFailed = ref(false);
  const videoFailure = ref<VideoFailure | null>(null);
  const videoStateGate = new VideoStateGate();
  const videoFrameConfirmation = new VideoFrameConfirmation(
    options.telemetryPrefix,
    (event, properties) => Telemetry.track?.(event, properties)
  );
  const videoFirstFrame = new VideoFirstFrame(options.firstFrameRole, (event, properties) =>
    Telemetry.track?.(event, properties)
  );
  const preparedVideos = new WeakMap<HTMLVideoElement, string>();

  let latestVideoState: VideoMediaState | null = null;
  let sourceDiagnostics: Record<string, unknown> = {};
  let activationGeneration = 0;

  function captureDiagnostics(el: HTMLVideoElement): () => Record<string, unknown> {
    const playbackId = options.getPlaybackId();
    const sourceUrl = options.getSourceUrl();
    const generation = activationGeneration;
    const source = { ...sourceDiagnostics };
    return () => {
      const stale =
        generation !== activationGeneration ||
        playbackId !== options.getPlaybackId() ||
        sourceUrl !== options.getSourceUrl();
      return {
        ...source,
        playback_id: playbackId,
        stale_context: stale,
        ...(stale ? { snapshot_omitted: "source_replaced" } : mediaElementDetails(el)),
      };
    };
  }

  function applyState(state: VideoMediaState): void {
    const el = options.videoRef.value;
    if (!el) return;
    const diagnosticContext = captureDiagnostics(el);
    try {
      const syncAction = applyVideoState(el, state, (error) => {
        mediaDiagnosticLog("warn", `${options.logLabel} play rejected`, {
          ...diagnosticContext(),
          phase: "sync_play",
          window_role: options.windowRole,
          name:
            error && typeof error === "object" && "name" in error && typeof error.name === "string"
              ? error.name
              : undefined,
          message: mediaDiagnosticMessage(error instanceof Error ? error.message : String(error)),
        });
      });
      videoFrameConfirmation.observe(el, state, syncAction);
    } catch {
      /* metadata ainda não chegou */
    }
  }

  function beginPlayback(
    nextPlaybackId: string | undefined,
    previousPlaybackId: string | undefined,
    isVideo: boolean,
    diagnostics: Record<string, unknown>
  ): void {
    ++activationGeneration;
    if (!isVideo || !nextPlaybackId || nextPlaybackId !== previousPlaybackId) {
      latestVideoState = null;
    }
    sourceDiagnostics = diagnostics;
    videoStateGate.begin(nextPlaybackId);
    videoFirstFrame.begin(isVideo ? nextPlaybackId : null);
    if (isVideo) videoFailed.value = false;
  }

  function clearPlayback(): void {
    ++activationGeneration;
    videoStateGate.clear();
    latestVideoState = null;
    videoFailed.value = false;
    videoFailure.value = null;
    videoFirstFrame.cancel();
    videoFrameConfirmation.cancel();
  }

  function prepareVideo(): void {
    const el = options.videoRef.value;
    if (!el || !options.isVideoActive()) return;
    const url = options.getSourceUrl();
    const prepared = `${options.getPlaybackId() ?? ""}|${url}`;
    if (preparedVideos.get(el) === prepared) return;
    preparedVideos.set(el, prepared);
    videoFailed.value = false;
    videoFailure.value = null;
    el.muted = true;
    el.playsInline = true;
    el.autoplay = false;
    el.loop = false;
    videoFirstFrame.attach(el);
    el.load();
    if (latestVideoState) {
      applyState(latestVideoState);
    }
  }

  function requestVideoState(): void {
    if (document.hidden || !options.isVideoActive()) return;
    const playbackId = options.getPlaybackId();
    if (!playbackId) return;
    const el = options.videoRef.value;
    if (!el || el.readyState < 1) return;
    Broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: playbackId });
  }

  function onVideoReady(event: Event): void {
    const el = options.videoRef.value;
    if (!el) return;
    videoFailed.value = false;
    videoFirstFrame.mediaReady(el);
    if (event.type === "loadedmetadata") requestVideoState();
    const playbackId = options.getPlaybackId();
    console.info(`${options.logPrefix} vídeo pronto:`, {
      playback_id: playbackId,
      duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : 0,
      width: el.videoWidth,
      height: el.videoHeight,
      ready_state: el.readyState,
      network_state: el.networkState,
    });
    Telemetry.track?.(`${options.telemetryPrefix}_ready`, {
      readiness: event.type,
      playback_id: playbackId,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      width: el.videoWidth,
      height: el.videoHeight,
    });
    if (latestVideoState) {
      applyState(latestVideoState);
    }
  }

  function onVideoSeeked(): void {
    if (latestVideoState) applyState(latestVideoState);
  }

  function onVideoPlaying(): void {
    const el = options.videoRef.value;
    const playbackId = options.getPlaybackId();
    console.info(`${options.logPrefix} vídeo reproduzindo:`, {
      playback_id: playbackId,
      current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
    });
    Telemetry.track?.(`${options.telemetryPrefix}_playing`, {
      playback_id: playbackId,
    });
  }

  function onVideoBuffering(event: Event): void {
    const el = event.currentTarget as HTMLVideoElement | null;
    const playbackId = options.getPlaybackId();
    console.debug(`${options.logPrefix} vídeo aguardando dados:`, {
      playback_id: playbackId,
      trigger: event.type,
      current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
      ready_state: el?.readyState,
      network_state: el?.networkState,
    });
    mediaDiagnosticLog("warn", `${options.logLabel} buffering`, {
      playback_id: playbackId,
      trigger: event.type,
      current_time: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      ready_state: el?.readyState,
    });
  }

  function onVideoError(event: Event): void {
    const el = event.currentTarget as HTMLVideoElement | null;
    videoFailed.value = true;
    videoFailure.value = null;
    videoFrameConfirmation.cancel();
    videoFirstFrame.cancel();
    const url = options.getSourceUrl();
    const playbackId = options.getPlaybackId();
    console.warn(`${options.logPrefix} vídeo local falhou:`, {
      playback_id: playbackId,
      code: el?.error?.code,
      message: mediaDiagnosticMessage(el?.error?.message),
      source: mediaSourceDetails(url),
    });
    void reportVideoFailure({
      el,
      url,
      label: options.logLabel,
      event: `${options.telemetryPrefix}_failed`,
      operation: options.telemetryPrefix,
      details: {
        ...mediaElementDetails(el),
        ...sourceDiagnostics,
        window_role: options.windowRole,
        phase: "media_element",
        playback_id: playbackId,
      },
    }).then((failure) => {
      if (playbackId === options.getPlaybackId() && url === options.getSourceUrl()) {
        videoFailure.value = failure;
      }
    });
  }

  /** Aplica o estado do player; devolve se ele valia para o vídeo desta tela. */
  function handleVideoState(payload: unknown): boolean {
    if (!options.isVideoActive()) return false;
    const data = payload as VideoMediaState;
    if (!videoStateGate.accepts(data)) return false;
    latestVideoState = data;
    videoFirstFrame.acceptRevision(data.revision, data.playback_id);
    applyState(data);
    return true;
  }

  function dispose(): void {
    videoFrameConfirmation.dispose();
    videoFirstFrame.dispose();
  }

  return {
    videoFailed,
    videoFailure,
    beginPlayback,
    clearPlayback,
    prepareVideo,
    requestVideoState,
    onVideoReady,
    onVideoSeeked,
    onVideoPlaying,
    onVideoBuffering,
    onVideoError,
    handleVideoState,
    dispose,
  };
}
