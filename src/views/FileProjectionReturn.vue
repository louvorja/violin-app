<template>
  <OverlayRenderer />
  <div class="fp-wallpaper" :style="fallbackStyle"></div>
  <div class="return-root" :class="{ 'return-root--ready': ready }">
    <div v-if="fileProjection.active" class="return-file-projection">
      <img
        v-if="fileProjection.type === 'image'"
        :src="fileProjection.url"
        class="return-file-projection__media"
        alt=""
      />
      <template v-else-if="fileProjection.type === 'video'">
        <video
          v-show="!videoFailed"
          ref="videoRef"
          :src="fileProjection.url"
          class="return-file-projection__media"
          :style="{ backgroundColor: wpColor }"
          autoplay
          muted
          playsinline
          preload="auto"
          @loadedmetadata="onVideoReady"
          @canplay="onVideoReady"
          @seeked="onVideoSeeked"
          @playing="onVideoPlaying"
          @waiting="onVideoBuffering"
          @stalled="onVideoBuffering"
          @error="onVideoError"
        />
        <div v-if="videoFailed" class="video-unavailable">
          <span class="video-unavailable__title">{{ $t("projection.video_unavailable") }}</span>
          <span class="video-unavailable__hint">{{ $t("projection.video_unavailable_hint") }}</span>
        </div>
      </template>
      <template v-else-if="fileProjection.type === 'youtube'">
        <div v-show="!ytFailed" ref="ytContainer" class="return-file-projection__youtube" />
        <div v-if="ytFailed" class="video-unavailable">
          <span class="video-unavailable__title">{{ $t("projection.video_unavailable") }}</span>
          <span class="video-unavailable__hint">{{ $t("projection.video_unavailable_hint") }}</span>
        </div>
      </template>
      <canvas
        v-else-if="fileProjection.type === 'pdf'"
        ref="pdfCanvas"
        class="return-file-projection__pdf"
      />
    </div>

    <div v-else class="return-empty"></div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import {
  FileProjectionState,
  VideoMediaState,
  YouTubeControlPayload,
  YTAPI,
  YTPlayer,
} from "@/types/Media";
import { loadYtApi } from "@/composables/useYouTubeApi";
import { KEYS } from "@/constants/UserDataKeys";
import $userdata from "@/helpers/UserData";
import { getSetting } from "@/helpers/SettingsStorage";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import { Settings } from "@/types/Settings";
import { DB_TABLE, SETTINGS_TABLE } from "@/constants/DbTables";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import { normalizeYouTubeError } from "@/helpers/YouTubeError";
import { applyVideoState } from "@/helpers/VideoSync";
import $idb from "@/helpers/IndexedDB";
import { VideoStateGate } from "@/helpers/VideoStateVersion";
import { FileProjectionActivationGate } from "@/presentation/FileProjectionActivation";
import { VideoFrameConfirmation } from "@/helpers/VideoFrameConfirmation";
import { VideoFirstFrame } from "@/helpers/VideoFirstFrame";
import { fileProjectionPageFor } from "@/helpers/FileProjectionPage";
import { PdfPageRenderQueue } from "@/helpers/PdfPageRenderQueue";

function getYT(): YTAPI | null {
  return (window as unknown as { YT?: YTAPI }).YT ?? null;
}

const fileProjection = reactive<FileProjectionState>({
  active: false,
  type: "",
  url: "",
  title: "",
  page: 1,
  totalPages: 0,
});

const videoRef = ref<HTMLVideoElement | null>(null);
const videoFailed = ref(false);
const videoStateGate = new VideoStateGate();
const activationGate = new FileProjectionActivationGate();
const videoFrameConfirmation = new VideoFrameConfirmation(
  "file_projection_return_video",
  (event, properties) => Telemetry.track(event, properties)
);
const videoFirstFrame = new VideoFirstFrame("return", (event, properties) =>
  Telemetry.track(event, properties)
);
let latestVideoState: VideoMediaState | null = null;
let activationGeneration = 0;
const ytContainer = ref<HTMLDivElement | null>(null);
const pdfCanvas = ref<HTMLCanvasElement | null>(null);
const ready = ref<boolean>(false);

let pdfDoc: PDFDocumentProxy | null = null;
let pdfLoadGeneration = 0;
const pdfRenderQueue = new PdfPageRenderQueue();

let ytPlayer: YTPlayer | null = null;
let ytSyncTimer: ReturnType<typeof setInterval> | null = null;
let _ytInitializing = false;
let ytGeneration = 0;
let ytAwaitingSync = false;
let ytSyncFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const ytFailed = ref(false);

const _YT_SYNC_INTERVAL = 500;

/* ── Wallpaper global (fallback) ── */

/* ── Wallpaper via IndexedDB ── */

const wpColor = ref("#000033");
const wpImageUrl = ref("");
const wpPosition = ref("cover");
let wpBlobUrl: string | null = null;

const fallbackStyle = computed(() =>
  estiloDeFundo({
    color: wpColor.value,
    imageUrl: wpImageUrl.value,
    position: wpPosition.value,
  })
);

async function renderPdfPage(pageNum: number): Promise<boolean> {
  const canvas = pdfCanvas.value;
  const doc = pdfDoc;
  if (!doc || !canvas) return false;
  let committed = false;
  try {
    await pdfRenderQueue.run(async (isCurrent) => {
      if (pdfDoc !== doc) return;
      const page = await doc.getPage(pageNum);
      if (!isCurrent() || pdfDoc !== doc) return;
      const parent = canvas.parentElement as HTMLElement;
      if (!parent) return;
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        parent.clientWidth / viewport.width,
        parent.clientHeight / viewport.height
      );
      const scaled = page.getViewport({ scale });
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      if (!canvas.getContext("2d")) return;
      await page.render({ canvas, viewport: scaled }).promise;
      if (isCurrent() && pdfDoc === doc) {
        fileProjection.page = pageNum;
        committed = true;
      }
    });
  } catch (e) {
    console.error("[FileProjectionReturn] Erro render página:", e);
  }
  return committed;
}

async function loadPdf(
  url: string,
  pageNum = 1,
  expectedPlaybackId = fileProjection.playback_id
): Promise<void> {
  if (
    expectedPlaybackId !== fileProjection.playback_id ||
    url !== fileProjection.url ||
    !fileProjection.active ||
    fileProjection.type !== "pdf"
  )
    return;
  const generation = ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  try {
    const previousDoc = pdfDoc;
    pdfDoc = null;
    if (previousDoc) {
      try {
        await (previousDoc as unknown as { destroy: () => Promise<void> }).destroy();
      } catch {
        /* ignore */
      }
    }
    if (generation !== pdfLoadGeneration || expectedPlaybackId !== fileProjection.playback_id)
      return;
    const data = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "file" }).then(
      (r) => r.arrayBuffer()
    );
    if (generation !== pdfLoadGeneration || expectedPlaybackId !== fileProjection.playback_id)
      return;
    const doc = await loadPdfDocument({ data });
    if (
      generation !== pdfLoadGeneration ||
      expectedPlaybackId !== fileProjection.playback_id ||
      !fileProjection.active
    ) {
      await (doc as unknown as { destroy: () => Promise<void> }).destroy();
      return;
    }
    pdfDoc = doc;
    fileProjection.totalPages = pdfDoc.numPages;
    try {
      const stored = JSON.parse(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION) || "null");
      const pending = fileProjectionPageFor(stored, expectedPlaybackId);
      if (pending) pageNum = pending.page;
    } catch {
      /* resume from the original page */
    }
    if (!(await renderPdfPage(Math.max(1, Math.min(pageNum, doc.numPages))))) return;
    if (generation !== pdfLoadGeneration || expectedPlaybackId !== fileProjection.playback_id)
      return;
    Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
      playback_id: fileProjection.playback_id,
      page: fileProjection.page,
      totalPages: pdfDoc.numPages,
      source: "projection",
    });
  } catch (e) {
    console.error("[FileProjectionReturn] Erro carregar PDF:", e);
  }
}

async function _activateProjection(p: FileProjectionState): Promise<void> {
  const accepted = activationGate.accept(p);
  if (!accepted) return;
  p = accepted;
  const generation = ++activationGeneration;
  ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  if (
    fileProjection.type === "youtube" &&
    (p.type !== "youtube" ||
      p.playback_id !== fileProjection.playback_id ||
      p.url !== fileProjection.url)
  ) {
    _destroyYoutube();
  }
  let resolvedBlobUrl: string | null = null;
  // Object URLs pertencem ao renderer que os criou. Para vídeos do acervo,
  // reconstroi o blob a partir do IndexedDB antes de montar o elemento — sem
  // isso a janela de retorno recebe uma URL blob morta e fica preta.
  if (p.libRef?.id && p.url?.startsWith("blob:")) {
    try {
      const rec = await $idb.get<{ data?: ArrayBuffer; mime?: string }>(
        p.libRef.table || DB_TABLE.MEDIA_LIBRARY,
        p.libRef.id
      );
      if (rec?.data && rec.mime) {
        resolvedBlobUrl = URL.createObjectURL(new Blob([rec.data], { type: rec.mime }));
        p = { ...p, url: resolvedBlobUrl };
      } else {
        console.warn("[FileProjectionReturn] dados do acervo ausentes para blob:", p.libRef.id);
      }
    } catch (error) {
      console.warn("[FileProjectionReturn] resolução do blob falhou:", error);
    }
  }
  if (generation !== activationGeneration) {
    if (resolvedBlobUrl) URL.revokeObjectURL(resolvedBlobUrl);
    return;
  }
  if (p.type !== "video" || !p.playback_id || p.playback_id !== fileProjection.playback_id) {
    latestVideoState = null;
  }
  fileProjection.active = true;
  fileProjection.type = p.type || "image";
  fileProjection.url = p.url || "";
  fileProjection.title = p.title || "";
  fileProjection.playback_id = p.playback_id;
  videoStateGate.begin(p.playback_id);
  videoFirstFrame.begin(p.type === "video" ? p.playback_id : null);
  Telemetry.setRuntimeContext({ playback_id: p.playback_id ?? null });
  console.log("[FileProjectionReturn] Ativado:", p.type, p.url?.substring(0, 60));
  if (p.type === "video") {
    videoFailed.value = false;
    await nextTick();
    _prepareVideo();
  }
  if (p.type === "youtube") nextTick(() => _initYoutube());
  if (p.type === "pdf") nextTick(() => loadPdf(p.url, p.page || 1, p.playback_id));
}

function _prepareVideo(): void {
  const el = videoRef.value;
  if (!el || !fileProjection.active || fileProjection.type !== "video") return;
  videoFailed.value = false;
  el.muted = true;
  el.playsInline = true;
  videoFirstFrame.attach(el);
  el.load();
  el.play().catch((error) => {
    console.warn("[FileProjectionReturn] vídeo não iniciou sozinho:", error?.name || error);
    Telemetry.log("warn", "file projection return video play rejected", {
      playback_id: fileProjection.playback_id,
      name: error?.name,
      message: error?.message,
      ready_state: el.readyState,
      network_state: el.networkState,
    });
  });
}

function _requestVideoState(): void {
  if (document.hidden || !fileProjection.active || fileProjection.type !== "video") return;
  if (!fileProjection.playback_id) return;
  if (!videoRef.value || videoRef.value.readyState < 1) return;
  Broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: fileProjection.playback_id });
}

function onVideoReady(event: Event): void {
  const el = videoRef.value;
  if (!el) return;
  videoFailed.value = false;
  videoFirstFrame.mediaReady(el);
  if (event.type === "loadedmetadata") _requestVideoState();
  console.info("[FileProjectionReturn] vídeo pronto:", {
    playback_id: fileProjection.playback_id,
    duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : 0,
    width: el.videoWidth,
    height: el.videoHeight,
    ready_state: el.readyState,
  });
  Telemetry.track("file_projection_return_video_ready", {
    playback_id: fileProjection.playback_id,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    width: el.videoWidth,
    height: el.videoHeight,
  });
  if (latestVideoState) {
    _applyVideoState(latestVideoState);
  } else if (el.paused) {
    el.play().catch(() => {});
  }
}

function _applyVideoState(state: VideoMediaState): void {
  const el = videoRef.value;
  if (!el) return;
  const syncAction = applyVideoState(el, state, (error) => {
    console.warn(
      "[FileProjectionReturn] vídeo não iniciou na sincronia:",
      error instanceof Error ? error.name : error
    );
    Telemetry.log("warn", "file projection return video sync play rejected", {
      playback_id: fileProjection.playback_id,
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  videoFrameConfirmation.observe(el, state, syncAction);
}

function onVideoSeeked(): void {
  if (latestVideoState) _applyVideoState(latestVideoState);
}

function onVideoPlaying(): void {
  const el = videoRef.value;
  console.info("[FileProjectionReturn] vídeo reproduzindo:", {
    playback_id: fileProjection.playback_id,
    current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
  });
  Telemetry.track("file_projection_return_video_playing", {
    playback_id: fileProjection.playback_id,
  });
}

function onVideoBuffering(event: Event): void {
  const el = event.currentTarget as HTMLVideoElement | null;
  console.warn("[FileProjectionReturn] vídeo aguardando dados:", {
    playback_id: fileProjection.playback_id,
    trigger: event.type,
    current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
  Telemetry.log("warn", "file projection return video buffering", {
    playback_id: fileProjection.playback_id,
    trigger: event.type,
    ready_state: el?.readyState,
  });
}

function onVideoError(event: Event): void {
  const el = event.currentTarget as HTMLVideoElement | null;
  videoFailed.value = true;
  videoFrameConfirmation.cancel();
  videoFirstFrame.cancel();
  const code = el?.error?.code;
  const reason = code === 3 ? "decode" : code === 4 ? "source_not_supported" : "unknown";
  const error = new Error(`File projection return video ${reason}`);
  Telemetry.captureException(error, {
    playback_id: fileProjection.playback_id,
    operation: "file_projection_return_video",
    reason,
  });
  console.error("[FileProjectionReturn] vídeo local falhou:", error, {
    playback_id: fileProjection.playback_id,
    code,
    message: el?.error?.message,
    src: fileProjection.url?.substring(0, 100),
  });
  Telemetry.track("file_projection_return_video_failed", {
    playback_id: fileProjection.playback_id,
    reason,
    code,
    message: el?.error?.message,
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
}

watch(
  () => [fileProjection.active, fileProjection.type, fileProjection.url],
  async ([active, type]) => {
    if (active && type === "video") {
      await nextTick();
      _prepareVideo();
    }
  }
);

function _readPendingProjection(): void {
  if (fileProjection.active) return;

  // Tenta ler projeção de arquivo primeiro
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    if (stored) {
      const p: FileProjectionState = JSON.parse(stored);
      if (p?.url) _activateProjection(p);
      // Não remova aqui: a janela principal e a projeção principal podem
      // montar em ordem diferente. O payload é o cache de reidratação para
      // reabrir a tela durante uma reprodução e só deve sair em MEDIA_CLOSE.
      return;
    }
  } catch {
    /* ignore */
  }

  // Tenta ler projeção de YouTube
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
    if (stored) {
      const p: FileProjectionState = JSON.parse(stored);
      if (p?.url) _activateProjection(p);
    }
  } catch {
    /* ignore */
  }
}
_readPendingProjection();
setTimeout(_readPendingProjection, 500);

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION, (payload: unknown) => {
  if ((payload as { action?: string } | null)?.action === "clear") {
    activationGate.retire();
    ++activationGeneration;
    ++pdfLoadGeneration;
    pdfRenderQueue.invalidate();
    _destroyYoutube();
    fileProjection.active = false;
    videoStateGate.clear();
    latestVideoState = null;
    return;
  }
  _activateProjection((payload || {}) as FileProjectionState);
});

useBroadcastListener(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, (payload: unknown) => {
  _activateProjection((payload || {}) as FileProjectionState);
});

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_PAGE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "pdf") return;
  const data = fileProjectionPageFor(payload, fileProjection.playback_id);
  if (data?.source === "operator" && pdfDoc) {
    const clamped = Math.max(1, Math.min(data.page, pdfDoc.numPages));
    if (clamped !== data.page) {
      Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
        playback_id: fileProjection.playback_id,
        page: clamped,
        totalPages: pdfDoc.numPages,
        source: "projection",
      });
    }
    renderPdfPage(clamped);
  }
});

useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, async () => {
  activationGate.retire();
  ++activationGeneration;
  ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  _destroyYoutube();
  if (pdfDoc) {
    try {
      await (pdfDoc as any).destroy();
    } catch {
      /* ignore */
    }
  }
  pdfDoc = null;
  fileProjection.active = false;
  videoStateGate.clear();
  latestVideoState = null;
  videoFirstFrame.cancel();
  Telemetry.setRuntimeContext({ playback_id: null, presentation_revision: null });
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
  } catch {
    /* ignore */
  }
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "video") return;
  const data = payload as VideoMediaState;
  if (!videoStateGate.accepts(data)) return;
  latestVideoState = data;
  videoFirstFrame.acceptRevision(data.revision, data.playback_id);
  _applyVideoState(data);
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "youtube") return;
  const data = payload as VideoMediaState;
  if (!videoStateGate.accepts(data)) return;
  if (!ytPlayer || !ytPlayer.getCurrentTime) return;
  if (ytSyncFallbackTimer) clearTimeout(ytSyncFallbackTimer);
  ytSyncFallbackTimer = null;
  try {
    const diff = Math.abs(
      ytPlayer.getCurrentTime() - (typeof data.currentTime === "number" ? data.currentTime : 0)
    );
    if (diff > 1) ytPlayer.seekTo(data.currentTime as number, true);
    if (typeof data.isPaused === "boolean") {
      if (data.isPaused) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    }
  } catch {
    /* ignore */
  } finally {
    ytAwaitingSync = false;
    _startYtSync();
  }
});

useBroadcastListener(BROADCAST_TYPE.YOUTUBE_CONTROL, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "youtube") return;
  if (!ytPlayer) return;
  const data = payload as YouTubeControlPayload;
  if (!fileProjection.playback_id || data?.playback_id !== fileProjection.playback_id) return;
  try {
    if (data.action === "play") ytPlayer.playVideo();
    else if (data.action === "pause") ytPlayer.pauseVideo();
    else if (data.action === "seekTo" && typeof data.value === "number")
      ytPlayer.seekTo(data.value, true);
    else if (data.action === "setVolume" && typeof data.value === "number")
      ytPlayer.setVolume(data.value);
  } catch {
    /* ignore */
  }
});

function _embedUrlToId(url: string): string | null {
  const m = url.match(/\/embed\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function _loadYtApi(cb: (YT: YTAPI) => void, isCurrent: () => boolean): void {
  ytFailed.value = false;
  loadYtApi()
    .then((YT) => {
      if (isCurrent()) cb(YT);
    })
    .catch((e: Error) => {
      if (!isCurrent()) return;
      _ytInitializing = false;
      ytFailed.value = true;
      console.warn("[FileProjectionReturn] YouTube indisponível:", e?.message || e);
    });
}

function _initYoutube(): void {
  if (_ytInitializing) return;
  _destroyYoutube();
  _ytInitializing = true;
  const generation = ytGeneration;
  const playbackId = fileProjection.playback_id;
  const isCurrent = () =>
    generation === ytGeneration &&
    fileProjection.active &&
    fileProjection.type === "youtube" &&
    fileProjection.playback_id === playbackId;
  const id = _embedUrlToId(fileProjection.url);
  console.log(
    "[FileProjectionReturn] _initYoutube - videoId:",
    id,
    "url:",
    fileProjection.url?.substring(0, 60)
  );
  if (!id) {
    _ytInitializing = false;
    console.warn("[FileProjectionReturn] ID do YouTube não extraído da URL");
    return;
  }
  if (!ytContainer.value) {
    _ytInitializing = false;
    console.warn("[FileProjectionReturn] Container YouTube não encontrado no DOM");
    return;
  }

  _loadYtApi((YT: YTAPI) => {
    if (!isCurrent() || !ytContainer.value) return;
    ytPlayer = new YT.Player(ytContainer.value, {
      height: "100%",
      width: "100%",
      videoId: id,
      origin: window.location.origin,
      playerVars: {
        autoplay: 1,
        mute: 1,
        rel: 0,
        controls: 0,
        modestbranding: 1,
        cc_load_policy: 0,
      },
      events: {
        onReady: () => {
          if (!isCurrent()) return;
          _ytInitializing = false;
          Telemetry.track("music_youtube_player_ready", {
            playback_id: fileProjection.playback_id,
            source_type: "youtube",
            window_role: "auxiliary_return",
          });
          if (ytPlayer) ytPlayer.playVideo();
          setTimeout(() => {
            if (isCurrent() && ytPlayer) ytPlayer.playVideo();
          }, 700);
          ytAwaitingSync = true;
          Broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: playbackId });
          ytSyncFallbackTimer = setTimeout(() => {
            if (!isCurrent() || !ytAwaitingSync) return;
            ytAwaitingSync = false;
            _broadcastYtState();
            _startYtSync();
          }, 800);
        },
        onApiChange: () => {
          if (!isCurrent()) return;
          try {
            if (typeof (ytPlayer as any)?.setOption === "function")
              (ytPlayer as any).setOption("captions", "track", {});
          } catch {
            console.error("Erro ao desativar o captions do Youtube");
          }
        },
        onStateChange: (e: { data: number }) => {
          if (!isCurrent()) return;
          Telemetry.track("music_youtube_state_changed", {
            playback_id: fileProjection.playback_id,
            state: e.data,
            window_role: "auxiliary_return",
          });
          _broadcastYtState();
        },
        onError: (e: unknown) => {
          if (!isCurrent()) return;
          const normalized = normalizeYouTubeError(e);
          const error = new Error(normalized.message);
          error.name = normalized.name;
          Telemetry.captureException(error, {
            playback_id: fileProjection.playback_id,
            operation: "youtube_player",
            stage: "youtube_player",
            ...normalized.properties,
          });
          console.error(
            "[FileProjectionReturn] YouTube player error:",
            normalized.message,
            normalized.code
          );
          Telemetry.track("music_playback_failed", {
            playback_id: fileProjection.playback_id,
            stage: "youtube_player",
            reason: normalized.kind,
            error_name: normalized.name,
            ...normalized.properties,
            source_kind: "youtube",
            is_desktop: false,
            platform: "web",
            window_role: "auxiliary_return",
          });
        },
      },
    });
  }, isCurrent);
}

function _broadcastYtState(): void {
  if (ytAwaitingSync || !ytPlayer || !ytPlayer.getCurrentTime || !fileProjection.active) return;
  const yt = getYT();
  if (!yt) return;
  try {
    Broadcast.send(BROADCAST_TYPE.YOUTUBE_STATE, {
      currentTime: ytPlayer.getCurrentTime(),
      isPaused: ytPlayer.getPlayerState() !== yt.PlayerState.PLAYING,
      duration: ytPlayer.getDuration() || 0,
      state: ytPlayer.getPlayerState(),
      playback_id: fileProjection.playback_id,
      sampledAt: Date.now(),
    } as VideoMediaState);
  } catch {
    /* ignore */
  }
}

function _startYtSync(): void {
  if (ytSyncTimer) clearInterval(ytSyncTimer);
  ytSyncTimer = setInterval(() => {
    _broadcastYtState();
  }, _YT_SYNC_INTERVAL);
}

function _destroyYoutube(): void {
  ++ytGeneration;
  ytAwaitingSync = false;
  if (ytSyncFallbackTimer) clearTimeout(ytSyncFallbackTimer);
  ytSyncFallbackTimer = null;
  _ytInitializing = false;
  ytFailed.value = false;
  if (ytSyncTimer) {
    clearInterval(ytSyncTimer);
    ytSyncTimer = null;
  }
  if (ytPlayer) {
    try {
      ytPlayer.destroy();
    } catch {
      /* ignore */
    }
    ytPlayer = null;
  }
}

function _onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    if (fileProjection.active) {
      _destroyYoutube();
      fileProjection.active = false;
      return;
    }
    setTimeout(() => window.close(), 200);
  }
}

async function reloadWallpaper(): Promise<void> {
  const useCustom =
    $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED, false) === true;
  const id = useCustom ? SETTINGS_TABLE.FILE_PROJECTION_BACKGROUND : SETTINGS_TABLE.MAIN_BACKGROUND;
  const s = await getSetting<Settings>(id).catch(() => null);
  if (s) {
    wpColor.value = s.color || "#000033";
    wpPosition.value = s.position || "cover";
    if (s.image) {
      if (wpBlobUrl) URL.revokeObjectURL(wpBlobUrl);
      const blob = new Blob([s.image], { type: s.mime || "image/png" });
      wpBlobUrl = URL.createObjectURL(blob);
      wpImageUrl.value = wpBlobUrl;
    } else {
      if (wpBlobUrl) {
        URL.revokeObjectURL(wpBlobUrl);
        wpBlobUrl = null;
      }
      wpImageUrl.value = "";
    }
  }
}

useBroadcastListener(BROADCAST_TYPE.WALLPAPER_UPDATE, () => {
  reloadWallpaper();
});

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_BG_UPDATE, () => {
  reloadWallpaper();
});

onMounted(async () => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000";

  await reloadWallpaper();
  document.body.style.background = wpColor.value;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ready.value = true;
    });
  });

  window.addEventListener("keydown", _onKey);
  window.addEventListener("focus", _requestVideoState);
  window.addEventListener("pageshow", _requestVideoState);
  document.addEventListener("visibilitychange", _requestVideoState);
  document.addEventListener("resume", _requestVideoState);
});

onBeforeUnmount(() => {
  pdfRenderQueue.invalidate();
  videoFrameConfirmation.dispose();
  videoFirstFrame.dispose();
  if (wpBlobUrl) URL.revokeObjectURL(wpBlobUrl);
  if (pdfDoc) {
    try {
      (pdfDoc as any).destroy();
    } catch {
      /* ignore */
    }
  }
  pdfDoc = null;
  _destroyYoutube();
  window.removeEventListener("keydown", _onKey);
  window.removeEventListener("focus", _requestVideoState);
  window.removeEventListener("pageshow", _requestVideoState);
  document.removeEventListener("visibilitychange", _requestVideoState);
  document.removeEventListener("resume", _requestVideoState);
});
</script>

<style scoped>
.fp-wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
}
.return-root {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  opacity: 0;
  transition: opacity 120ms linear;
}
.return-root--ready {
  opacity: 1;
}

.return-file-projection {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.return-file-projection__media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.return-file-projection video.return-file-projection__media {
  width: 100%;
  height: 100%;
}
.return-file-projection__youtube {
  width: 100%;
  height: 100%;
}
.return-file-projection__pdf {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.return-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* Um vídeo que não carrega deixava a tela em branco na frente da igreja. */
.video-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  width: 100%;
  height: 100%;
  color: rgb(255 255 255 / 62%);
  text-align: center;
}

.video-unavailable__title {
  font-size: 1.5rem;
}

.video-unavailable__hint {
  font-size: 0.95rem;
  color: rgb(255 255 255 / 42%);
}
</style>
