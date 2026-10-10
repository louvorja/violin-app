<template>
  <OverlayRenderer />
  <ReturnOverride />
  <ProjectionClearScreen />
  <div class="fp-wallpaper" :style="fallbackStyle"></div>
  <div class="return-root" :class="{ 'return-root--ready': ready }">
    <div v-if="fileProjection.active" class="return-file-projection">
      <!-- Cena da transição: mídia anterior e nova se sobrepõem durante a animação -->
      <div class="lj-tstage" :style="stageStyle">
        <Transition :name="transitionName">
          <div :key="mediaKey" class="lj-tslide">
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
                :autoplay="!playerClock"
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
                <span class="video-unavailable__title">
                  {{ $t("projection.video_unavailable") }}
                </span>
                <span class="video-unavailable__hint">
                  {{ $t("projection.video_unavailable_hint") }}
                </span>
              </div>
            </template>
            <template v-else-if="fileProjection.type === 'youtube'">
              <div v-show="!ytFailed" ref="ytContainer" class="return-file-projection__youtube" />
              <div v-if="ytFailed" class="video-unavailable">
                <span class="video-unavailable__title">
                  {{ $t("projection.video_unavailable") }}
                </span>
                <span class="video-unavailable__hint">
                  {{ $t("projection.video_unavailable_hint") }}
                </span>
              </div>
            </template>
            <canvas
              v-else-if="fileProjection.type === 'pdf'"
              ref="pdfCanvas"
              class="return-file-projection__pdf"
            />
          </div>
        </Transition>
      </div>
    </div>

    <div v-else class="return-empty"></div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import "@/assets/styles/transitions.css";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { pdfPageFit } from "@/helpers/PdfPageFit";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useTransitionStage } from "@/composables/useTransitionStage";
import { createTransitionContext } from "@/config/Transitions";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import ProjectionClearScreen from "@/components/ProjectionClearScreen.vue";
import ReturnOverride from "@/components/ReturnOverride.vue";
import {
  FileProjectionState,
  VideoMediaState,
  YouTubeControlPayload,
  YTAPI,
  YTPlayer,
} from "@/types/Media";
import { loadYtApi } from "@/composables/useYouTubeApi";
import { outranks } from "@/composables/useYouTubeEmbed";
import { KEYS } from "@/constants/UserDataKeys";
import $userdata from "@/helpers/UserData";
import { getSetting } from "@/helpers/SettingsStorage";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import { DEFAULT_BACKGROUND_COLOR, Settings } from "@/types/Settings";
import { DB_TABLE, SETTINGS_TABLE } from "@/constants/DbTables";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { heicToJpeg, isHeic } from "@/helpers/ImageConvert";
import Telemetry from "@/helpers/Telemetry";
import { useScreenVideoReport } from "@/composables/useScreenVideoReport";
import { useSlaveVideoClock } from "@/composables/useSlaveVideoClock";
import {
  mediaElementDetails,
  mediaSourceDetails,
  mediaDiagnosticMessage,
  mediaDiagnosticVideoId,
  mediaBlobDetails,
  mediaLibraryDetails,
  mediaDiagnosticLog,
} from "@/helpers/MediaDiagnostics";
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

/** Identidade da mídia na cena — a página do PDF fica de fora para re-render
 * no mesmo canvas; playback_id novo conta como mídia nova. */
const mediaKey = computed(
  () => `${fileProjection.type}:${fileProjection.url}:${fileProjection.playback_id ?? ""}`
);

/** Nome da classe + variáveis da stage — configuração própria da Biblioteca de
 * Mídia; `backward` (próximo/anterior) inverte o modo automático de direção. */
const { transitionName, stageStyle } = useTransitionStage(
  createTransitionContext(KEYS.MODULES.MEDIA_LIBRARY),
  { isBackward: () => fileProjection.backward === true }
);

const videoRef = ref<HTMLVideoElement | null>(null);
/** O vídeo segue o player da janela principal: sem ele, não anda (ver useSlaveVideoClock). */
const playerClock = ref(false);
const slaveClock = useSlaveVideoClock(videoRef, {
  enabled: () => playerClock.value && fileProjection.active && fileProjection.type === "video",
  request: () => _requestVideoState(),
});
// O módulo confere se esta tela faz o que o player manda (pausado é pausado).
useScreenVideoReport(
  "return",
  videoRef,
  () => fileProjection.playback_id ?? null,
  () => fileProjection.active && fileProjection.type === "video"
);
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
let videoSourceDiagnostics: Record<string, unknown> = {};
let ytFirstStateLogged = false;
let ytStateFailureLogged = false;

const _YT_SYNC_INTERVAL = 500;

/* ── Wallpaper global (fallback) ── */

/* ── Wallpaper via IndexedDB ── */

const wpColor = ref(DEFAULT_BACKGROUND_COLOR);
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

async function renderPdfPage(pageNum: number): Promise<void> {
  const canvas = pdfCanvas.value;
  const doc = pdfDoc;
  if (!doc || !canvas) return;
  try {
    await pdfRenderQueue.run(async (isCurrent) => {
      if (pdfDoc !== doc) return;
      const page = await doc.getPage(pageNum);
      if (!isCurrent() || pdfDoc !== doc) return;
      const parent = canvas.parentElement as HTMLElement;
      if (!parent) return;
      const viewport = page.getViewport({ scale: 1 });
      const fit = pdfPageFit({
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        parentWidth: parent.clientWidth,
        parentHeight: parent.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
      });
      if (!fit) return;
      const scaled = page.getViewport({ scale: fit.scale });
      canvas.width = fit.pixelWidth;
      canvas.height = fit.pixelHeight;
      canvas.style.width = `${fit.cssWidth}px`;
      canvas.style.height = `${fit.cssHeight}px`;
      if (!canvas.getContext("2d")) return;
      await page.render({ canvas, viewport: scaled }).promise;
      if (isCurrent() && pdfDoc === doc) {
        fileProjection.page = pageNum;
        Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
          playback_id: fileProjection.playback_id,
          page: pageNum,
          totalPages: doc.numPages,
          source: "projection",
        });
      }
    });
  } catch (e) {
    console.error("[FileProjectionReturn] Erro render página:", e);
  }
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
    await renderPdfPage(Math.max(1, Math.min(pageNum, doc.numPages)));
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
  let sourceDiagnostics: Record<string, unknown> = {
    requested_source: {
      ...mediaSourceDetails(p.url),
      ...mediaLibraryDetails(p.libRef),
      blob_mime: "unknown",
      codec: "unknown",
    },
    blob_resolution: p.url?.startsWith("blob:") ? "no_library_reference" : "not_requested",
  };
  // Object URLs pertencem ao renderer que os criou. Para vídeos do acervo,
  // reconstroi o blob a partir do IndexedDB antes de montar o elemento — sem
  // isso a janela de retorno recebe uma URL blob morta e fica preta.
  if (p.libRef?.id && p.url?.startsWith("blob:")) {
    try {
      const rec = await $idb.get<{ data?: ArrayBuffer; mime?: string; name?: string }>(
        p.libRef.table || DB_TABLE.MEDIA_LIBRARY,
        p.libRef.id
      );
      sourceDiagnostics.blob_resolution = "library_record_missing";
      if (rec?.data && rec.mime) {
        let blob = new Blob([rec.data], { type: rec.mime });
        if (p.type === "image" && (p.heic || isHeic(rec.name, rec.mime))) {
          blob = await heicToJpeg(blob);
        }
        sourceDiagnostics = {
          ...sourceDiagnostics,
          blob_resolution: "resolved",
          requested_source: {
            ...(sourceDiagnostics.requested_source as Record<string, unknown>),
            ...mediaBlobDetails(blob),
          },
        };
        resolvedBlobUrl = URL.createObjectURL(blob);
        p = { ...p, url: resolvedBlobUrl };
      } else {
        console.warn("[FileProjectionReturn] dados do acervo ausentes para blob:", p.libRef.id);
      }
    } catch (error) {
      sourceDiagnostics.blob_resolution = "library_read_failed";
      console.warn(
        "[FileProjectionReturn] resolução do blob falhou:",
        mediaDiagnosticMessage(error instanceof Error ? error.message : String(error))
      );
    }
  }
  if (p.type === "image" && p.heic && !resolvedBlobUrl && !p.url?.startsWith("blob:")) {
    try {
      const response = await fetchWithTimeout(p.url, {
        timeout: NET_TIMEOUT.MEDIA,
        source: "file",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      resolvedBlobUrl = URL.createObjectURL(await heicToJpeg(await response.blob()));
      p = { ...p, url: resolvedBlobUrl };
    } catch (error) {
      sourceDiagnostics.blob_resolution = "heic_conversion_failed";
      console.warn("[FileProjectionReturn] conversão de HEIC falhou:", error);
      p = { ...p, url: "" };
    }
  }
  if (generation !== activationGeneration) {
    if (resolvedBlobUrl) URL.revokeObjectURL(resolvedBlobUrl);
    return;
  }
  if (p.type !== "video" || !p.playback_id || p.playback_id !== fileProjection.playback_id) {
    latestVideoState = null;
  }
  videoSourceDiagnostics = sourceDiagnostics;
  fileProjection.active = true;
  fileProjection.type = p.type || "image";
  fileProjection.url = p.url || "";
  fileProjection.title = p.title || "";
  fileProjection.playback_id = p.playback_id;
  playerClock.value = p.type === "video" && p.clock === "player";
  slaveClock.reset();
  fileProjection.backward = p.backward === true;
  videoStateGate.begin(p.playback_id);
  videoFirstFrame.begin(p.type === "video" ? p.playback_id : null);
  Telemetry.setRuntimeContext({ playback_id: p.playback_id ?? null });
  console.log("[FileProjectionReturn] Ativado:", p.type, mediaSourceDetails(p.url));
  if (p.type === "video") {
    videoFailed.value = false;
    await nextTick();
    _prepareVideo();
  }
  if (p.type === "youtube") nextTick(() => _initYoutube());
  if (p.type === "pdf") nextTick(() => loadPdf(p.url, p.page || 1, p.playback_id));
}

/** Capture identity before play(); the element may be reused before its promise rejects. */
function _captureVideoDiagnostics(el: HTMLVideoElement): () => Record<string, unknown> {
  const playbackId = fileProjection.playback_id;
  const sourceUrl = fileProjection.url;
  const generation = activationGeneration;
  const source = { ...videoSourceDiagnostics };
  return () => {
    const stale =
      generation !== activationGeneration ||
      playbackId !== fileProjection.playback_id ||
      sourceUrl !== fileProjection.url;
    return {
      ...source,
      playback_id: playbackId,
      stale_context: stale,
      ...(stale ? { snapshot_omitted: "source_replaced" } : mediaElementDetails(el)),
    };
  };
}

// Mesmo motivo de FileProjection.vue: ativação e watch chegam pela mesma mudança.
const preparedVideos = new WeakMap<HTMLVideoElement, string>();

function _prepareVideo(): void {
  const el = videoRef.value;
  if (!el || !fileProjection.active || fileProjection.type !== "video") return;
  const prepared = `${fileProjection.playback_id ?? ""}|${fileProjection.url}`;
  if (preparedVideos.get(el) === prepared) return;
  preparedVideos.set(el, prepared);
  videoFailed.value = false;
  el.muted = true;
  el.playsInline = true;
  videoFirstFrame.attach(el);
  el.load();
  const diagnosticContext = _captureVideoDiagnostics(el);
  // Com player, a tela espera o estado dele para andar; pede já.
  if (playerClock.value) {
    _requestVideoState();
    return;
  }
  el.play().catch((error) => {
    console.warn("[FileProjectionReturn] vídeo não iniciou sozinho:", error?.name || error);
    mediaDiagnosticLog("warn", "file projection return video play rejected", {
      ...diagnosticContext(),
      window_role: "auxiliary_return",
      phase: "initial_play",
      name: error?.name,
      message: mediaDiagnosticMessage(error?.message),
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
  const diagnosticContext = _captureVideoDiagnostics(el);
  const syncAction = applyVideoState(el, state, (error) => {
    console.warn(
      "[FileProjectionReturn] vídeo não iniciou na sincronia:",
      error instanceof Error ? error.name : error
    );
    mediaDiagnosticLog("warn", "file projection return video sync play rejected", {
      ...diagnosticContext(),
      phase: "sync_play",
      window_role: "auxiliary_return",
      name: error instanceof Error ? error.name : undefined,
      message: mediaDiagnosticMessage(error instanceof Error ? error.message : String(error)),
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
  mediaDiagnosticLog("warn", "file projection return video buffering", {
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
  const diagnostics = {
    ...mediaElementDetails(el),
    ...videoSourceDiagnostics,
    window_role: "auxiliary_return",
    phase: "media_element",
  };
  mediaDiagnosticLog("error", "file projection video failed", {
    ...diagnostics,
    playback_id: fileProjection.playback_id,
    reason,
  });
  Telemetry.captureException(error, {
    ...diagnostics,
    playback_id: fileProjection.playback_id,
    operation: "file_projection_return_video",
    reason,
  });
  console.error("[FileProjectionReturn] vídeo local falhou:", error, {
    playback_id: fileProjection.playback_id,
    code,
    message: mediaDiagnosticMessage(el?.error?.message),
    source: mediaSourceDetails(fileProjection.url),
  });
  Telemetry.track("file_projection_return_video_failed", {
    ...diagnostics,
    playback_id: fileProjection.playback_id,
    reason,
    code,
    message: mediaDiagnosticMessage(el?.error?.message),
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
}

watch(
  () => [
    fileProjection.active,
    fileProjection.type,
    fileProjection.url,
    fileProjection.playback_id,
  ],
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
    /* Já nesta página (fim/início do documento): re-renderizar só pisca o
       telão — é o que acontece quando o operador segura a seta no último
       slide. */
    if (clamped === fileProjection.page) return;
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
  slaveClock.heard();
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

// O retorno acompanha quem manda no relógio (a projeção ou, sem ela, a janela principal):
// só os comandos não bastam, porque cada player carrega e trava por conta própria.
useBroadcastListener(BROADCAST_TYPE.YOUTUBE_STATE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "youtube") return;
  const data = payload as VideoMediaState;
  if (!ytPlayer || !ytPlayer.getCurrentTime || ytAwaitingSync) return;
  if (!fileProjection.playback_id || data?.playback_id !== fileProjection.playback_id) return;
  if (!outranks(data.role, "return")) return;
  try {
    const playing = data.state === 1;
    const age =
      playing && typeof data.sampledAt === "number"
        ? Math.max(0, (Date.now() - data.sampledAt) / 1000)
        : 0;
    const target = data.currentTime + age;
    if (Math.abs(ytPlayer.getCurrentTime() - target) > 1) ytPlayer.seekTo(target, true);
    const mine = ytPlayer.getPlayerState();
    if (playing && mine === 2) ytPlayer.playVideo();
    else if (data.state === 2 && mine === 1) ytPlayer.pauseVideo();
  } catch {
    /* ignore */
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
  let phase = "iframe_api";
  loadYtApi()
    .then((YT) => {
      phase = "player_construct";
      if (isCurrent()) cb(YT);
    })
    .catch((e: Error) => {
      if (!isCurrent()) return;
      _ytInitializing = false;
      ytFailed.value = true;
      mediaDiagnosticLog("warn", "youtube iframe API failed", {
        playback_id: fileProjection.playback_id,
        video_id: mediaDiagnosticVideoId(fileProjection.url),
        window_role: "auxiliary_return",
        phase,
        reason: phase === "iframe_api" ? "api_load_failed" : "player_constructor_failed",
        message: mediaDiagnosticMessage(e?.message),
      });
      console.warn(
        "[FileProjectionReturn] YouTube indisponível:",
        mediaDiagnosticMessage(e?.message || String(e))
      );
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
  const diagnostics = {
    playback_id: playbackId,
    video_id: mediaDiagnosticVideoId(fileProjection.url),
    window_role: "auxiliary_return",
  };
  console.log(
    "[FileProjectionReturn] _initYoutube - videoId:",
    id,
    "url:",
    mediaSourceDetails(fileProjection.url)
  );
  if (!id) {
    _ytInitializing = false;
    console.warn("[FileProjectionReturn] ID do YouTube não extraído da URL");
    mediaDiagnosticLog("warn", "youtube initialization failed", {
      ...diagnostics,
      phase: "iframe_init",
      reason: "invalid_video_id",
    });
    return;
  }
  if (!ytContainer.value) {
    _ytInitializing = false;
    console.warn("[FileProjectionReturn] Container YouTube não encontrado no DOM");
    mediaDiagnosticLog("warn", "youtube initialization failed", {
      ...diagnostics,
      phase: "iframe_init",
      reason: "container_missing",
    });
    return;
  }

  _loadYtApi((YT: YTAPI) => {
    if (!isCurrent() || !ytContainer.value) return;
    mediaDiagnosticLog("debug", "youtube iframe API ready", {
      ...diagnostics,
      phase: "player_construct",
      container_present: true,
    });
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
            ...diagnostics,
            playback_id: fileProjection.playback_id,
            source_type: "youtube",
            window_role: "auxiliary_return",
          });
          mediaDiagnosticLog("debug", "youtube iframe player ready", {
            ...diagnostics,
            phase: "player_ready",
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
            ...diagnostics,
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
            ...diagnostics,
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
            ...diagnostics,
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
  const diagnostics = {
    playback_id: fileProjection.playback_id,
    video_id: mediaDiagnosticVideoId(fileProjection.url),
    window_role: "auxiliary_return",
    phase: "state_publish",
  };
  const yt = getYT();
  if (!yt) {
    if (!ytStateFailureLogged) {
      ytStateFailureLogged = true;
      mediaDiagnosticLog("warn", "youtube state publication failed", {
        ...diagnostics,
        reason: "api_runtime_missing",
      });
    }
    return;
  }
  try {
    const delivery = Broadcast.send(BROADCAST_TYPE.YOUTUBE_STATE, {
      currentTime: ytPlayer.getCurrentTime(),
      isPaused: ytPlayer.getPlayerState() !== yt.PlayerState.PLAYING,
      duration: ytPlayer.getDuration() || 0,
      state: ytPlayer.getPlayerState(),
      playback_id: fileProjection.playback_id,
      sampledAt: Date.now(),
      role: "return",
    } as VideoMediaState);
    if (delivery?.crossWindow === false && !ytStateFailureLogged) {
      ytStateFailureLogged = true;
      mediaDiagnosticLog("warn", "youtube state publication failed", {
        ...diagnostics,
        reason: "state_delivery_failed",
        cross_window_enqueued: false,
      });
    }
    if (delivery?.crossWindow !== false && !ytFirstStateLogged) {
      ytFirstStateLogged = true;
      mediaDiagnosticLog("debug", "youtube first state published", {
        ...diagnostics,
        cross_window_enqueued: delivery?.crossWindow ?? null,
      });
    }
  } catch (error) {
    if (!ytStateFailureLogged) {
      ytStateFailureLogged = true;
      mediaDiagnosticLog("warn", "youtube state publication failed", {
        ...diagnostics,
        reason: "state_read_or_send_failed",
        message: mediaDiagnosticMessage(error instanceof Error ? error.message : String(error)),
      });
    }
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
  ytFirstStateLogged = false;
  ytStateFailureLogged = false;
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
    wpColor.value = s.color || DEFAULT_BACKGROUND_COLOR;
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

/* Como na tela principal: preenche mantendo a proporção. */
.return-file-projection__media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.return-file-projection__youtube {
  width: 100%;
  height: 100%;
}
/* O vídeo do YouTube não recebe clique nem foco: um toque na projeção o pausaria na frente
   da igreja. Avançar, voltar e pausar é na barra do player. */
.return-file-projection :deep(iframe[src*="youtube"]) {
  pointer-events: none;
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
