<template>
  <!-- Layer 0: Fundo preto permanente -->
  <div class="return-root-bg"></div>

  <!-- Layer: Fundo customizado (wallpaper) -->
  <div class="return-wallpaper" :style="fallbackStyle"></div>

  <!-- MODO FILE PROJECTION -->
  <template v-if="fileState.active">
    <div class="file-projection">
      <img v-if="fileState.type === 'image'" :src="fileState.url" class="return-file" alt="" />
      <video
        v-else-if="fileState.type === 'video'"
        ref="projVideoRef"
        :src="fileState.url"
        class="return-file"
        autoplay
        muted
        loop
      ></video>
      <template v-else-if="fileState.type === 'youtube'">
        <div v-show="!ytFailed" ref="ytContainer" class="return-file"></div>
        <div v-if="ytFailed" class="return-file video-unavailable">
          <span class="video-unavailable__title">{{ $t("projection.video_unavailable") }}</span>
          <span class="video-unavailable__hint">{{ $t("projection.video_unavailable_hint") }}</span>
        </div>
      </template>
      <canvas
        v-else-if="fileState.type === 'pdf'"
        ref="pdfCanvas"
        class="return-file return-file--pdf"
      ></canvas>
    </div>
  </template>

  <!-- MODO BACKGROUND PROJECTION -->
  <template v-else>
    <Transition name="fade">
      <img
        v-if="curBg.type === 'image'"
        :key="'img-' + curBg.url"
        :src="curBg.url"
        class="return-bg"
        :style="{ '--fade-ms': fadeDurationMs + 'ms' }"
        alt=""
      />
      <video
        v-else-if="curBg.type === 'video'"
        :key="'vid-' + curBg.url"
        ref="bgVideoRef"
        :src="curBg.url"
        class="return-bg"
        :style="{ '--fade-ms': fadeDurationMs + 'ms' }"
        autoplay
        muted
        loop
      ></video>
    </Transition>
    <Transition name="fade">
      <div
        v-if="!curBg.active"
        class="return-bg return-bg--fallback"
        :style="{ ...fallbackStyle, '--fade-ms': fadeDurationMs + 'ms' }"
      ></div>
    </Transition>
    <div v-if="projActive" class="return-projection">
      <Slide
        v-if="projType === 'music' || projType === 'bible'"
        :slide="slide!!"
        :title="title"
        :progress="progress"
        show-progress
        class="return-slide"
      />
    </div>
  </template>

  <!-- Layer 2: Overlays -->
  <OverlayRenderer />
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useProjectionState } from "@/composables/useProjectionState";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $userdata from "@/helpers/UserData";
import $modules from "@/helpers/Modules";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { getSetting } from "@/helpers/SettingsStorage";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import Slide from "@/components/Slide.vue";
import { MAIN_BACKGROUND_ID, Settings } from "@/types/Settings";
import { KEYS } from "@/constants/UserDataKeys";
import { SETTINGS_TABLE } from "@/constants/DbTables";
import type { YTAPI, YTPlayer, VideoMediaState } from "@/types/Media";
import { VideoStateGate } from "@/helpers/VideoStateVersion";
import {
  FileProjectionActivationGate,
  readFileActivation,
} from "@/presentation/FileProjectionActivation";
import {
  BackgroundPresentationGate,
  readStoredBackgroundState,
} from "@/presentation/BackgroundPresentationState";
import { loadYtApi } from "@/composables/useYouTubeApi";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import Telemetry from "@/helpers/Telemetry";
import { normalizeYouTubeError } from "@/helpers/YouTubeError";
import { fileProjectionPageFor } from "@/helpers/FileProjectionPage";
import { PdfPageRenderQueue } from "@/helpers/PdfPageRenderQueue";

/* ── Background state ── */

interface BgState {
  active: boolean;
  type: string;
  url: string;
  title: string;
}

const curBg = reactive<BgState>({ active: false, type: "", url: "", title: "" });
const bgVideoRef = ref<HTMLVideoElement | null>(null);
const backgroundGate = new BackgroundPresentationGate();

const MODULE_PATH = $modules.getPath(ModuleEnum.BACKGROUND_PROJECTION);
const fadeDurationMs = computed(
  () => $userdata.get<number>(`${MODULE_PATH}.fade_duration`, 500) ?? 500
);

function activateBg(value: unknown): void {
  const p = backgroundGate.accept(value);
  if (!p) return;
  if (p.active === false) {
    curBg.active = false;
    curBg.type = "";
    curBg.url = "";
    return;
  }
  Object.assign(curBg, {
    active: true,
    type: p.type || "image",
    url: p.url || "",
    title: p.title || "",
  });
}

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

/* ── Projection state (música, bíblia) ── */

const { slide, title, progress } = useProjectionState();

/* ── File projection state ── */

const fileState = reactive<{ active: boolean; type: string; url: string; playback_id?: string }>({
  active: false,
  type: "",
  url: "",
});
const projVideoRef = ref<HTMLVideoElement | null>(null);
const ytContainer = ref<HTMLDivElement | null>(null);
let ytPlayer: YTPlayer | null = null;

/* ── PDF state ── */
const pdfCanvas = ref<HTMLCanvasElement | null>(null);
let pdfDoc: PDFDocumentProxy | null = null;
let pdfLoadGeneration = 0;
const pdfRenderQueue = new PdfPageRenderQueue();
let currentPdfPage = ref(1);
let _ytInitializing = false;
let ytGeneration = 0;
let ytAwaitingSync = false;
let ytSyncFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const youtubeStateGate = new VideoStateGate();
const activationGate = new FileProjectionActivationGate();
const ytFailed = ref(false);
let _ytSyncTimer: ReturnType<typeof setInterval> | null = null;

const projActive = computed(() => !!slide.value);
const projType = computed(() => {
  if (slide.value && (slide.value as any).is_bible) return "bible";
  return "music";
});

/* ── Broadcast listeners ── */

function readPendingBg(): void {
  if (curBg.active) return;
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
    if (stored) {
      const p = JSON.parse(stored);
      activateBg(readStoredBackgroundState(p));
    }
  } catch {
    /* ignore */
  }
}

readPendingBg();
setTimeout(readPendingBg, 500);

useBroadcastListener(BROADCAST_TYPE.BACKGROUND_PROJECTION, (payload: unknown) => {
  activateBg(payload);
});

function applyFileActivation(payload: unknown): void {
  const p = activationGate.accept(payload);
  if (!p) return;
  ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  _destroyYoutube();
  if (pdfDoc) {
    void (pdfDoc as unknown as { destroy: () => Promise<void> }).destroy().catch(() => {});
    pdfDoc = null;
  }
  fileState.active = true;
  fileState.type = p.type;
  fileState.url = p.url;
  fileState.playback_id = p.playback_id;
  youtubeStateGate.begin(p.playback_id);
  reloadWallpaper();
  if (p.type === "pdf") nextTick(() => loadPdf(p.url, p.page || 1, p.playback_id));
  if (p.type === "youtube") nextTick(() => _initYoutube());
}

function readPendingFile(): void {
  try {
    const states = [
      localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION),
      localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION),
    ].flatMap((raw) => (raw ? [readFileActivation(JSON.parse(raw))] : []));
    const current = states
      .filter((state) => state !== null)
      .sort((a, b) => b.stage_epoch - a.stage_epoch)[0];
    if (current) applyFileActivation(current);
  } catch {
    /* transient recovery cache may be unavailable */
  }
}

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION, (payload: unknown) => {
  if ((payload as { action?: string } | null)?.action === "clear") {
    activationGate.retire();
    ++pdfLoadGeneration;
    pdfRenderQueue.invalidate();
    _destroyYoutube();
    if (pdfDoc) {
      void (pdfDoc as unknown as { destroy: () => Promise<void> }).destroy().catch(() => {});
      pdfDoc = null;
    }
    fileState.active = false;
    reloadWallpaper();
    return;
  }
  applyFileActivation(payload);
});

useBroadcastListener(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, applyFileActivation);

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_PAGE, (payload: unknown) => {
  const p = fileProjectionPageFor(payload, fileState.playback_id);
  if (!p || p.source !== "operator") return;
  if (fileState.active && fileState.type === "pdf" && pdfDoc) {
    currentPdfPage.value = p.page;
    renderPdfPage(p.page);
  }
});

useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, () => {
  activationGate.retire();
  ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  _destroyYoutube();
  if (pdfDoc) {
    try {
      (pdfDoc as any).destroy();
    } catch {
      /* ignore */
    }
    pdfDoc = null;
  }
  fileState.active = false;
  youtubeStateGate.clear();
  fileState.type = "";
  fileState.url = "";
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
  } catch {
    /* ignore */
  }
  reloadWallpaper();
});

useBroadcastListener(BROADCAST_TYPE.YOUTUBE_CONTROL, (payload: unknown) => {
  if (!ytPlayer || !fileState.active || fileState.type !== "youtube") return;
  const data = payload as { action?: string; value?: number; playback_id?: string };
  if (!fileState.playback_id || data?.playback_id !== fileState.playback_id) return;
  switch (data.action) {
    case "pause":
      ytPlayer.pauseVideo();
      break;
    case "play":
      ytPlayer.playVideo();
      break;
    case "seekTo":
      if (typeof data.value === "number") ytPlayer.seekTo(data.value, true);
      break;
  }
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
  if (!fileState.active || fileState.type !== "youtube" || !ytPlayer) return;
  const data = payload as VideoMediaState;
  if (!youtubeStateGate.accepts(data)) return;
  if (ytSyncFallbackTimer) clearTimeout(ytSyncFallbackTimer);
  ytSyncFallbackTimer = null;
  try {
    if (Math.abs(ytPlayer.getCurrentTime() - data.currentTime) > 1)
      ytPlayer.seekTo(data.currentTime, true);
    if (data.isPaused) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
  } catch {
    /* player was disposed */
  } finally {
    ytAwaitingSync = false;
    _startYtSync();
  }
});

function getYT(): YTAPI | null {
  return (window as unknown as { YT?: YTAPI }).YT ?? null;
}

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
      console.warn("[BackgroundProjectionReturn] YouTube indisponível:", e?.message || e);
    });
}

function _initYoutube(): void {
  if (_ytInitializing) return;
  _destroyYoutube();
  _ytInitializing = true;
  const generation = ytGeneration;
  const playbackId = fileState.playback_id;
  const isCurrent = () =>
    generation === ytGeneration &&
    fileState.active &&
    fileState.type === "youtube" &&
    fileState.playback_id === playbackId;
  const id = _embedUrlToId(fileState.url);
  if (!id || !ytContainer.value) {
    _ytInitializing = false;
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
            playback_id: fileState.playback_id,
            source_type: "youtube",
            window_role: "background_projection_return",
          });
          if (ytPlayer) ytPlayer.playVideo();
          ytAwaitingSync = true;
          $broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: playbackId });
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
            playback_id: fileState.playback_id,
            state: e.data,
            window_role: "background_projection_return",
          });
          _broadcastYtState();
        },
        onError: (e: unknown) => {
          if (!isCurrent()) return;
          const normalized = normalizeYouTubeError(e);
          const error = new Error(normalized.message);
          error.name = normalized.name;
          Telemetry.track("music_playback_failed", {
            playback_id: fileState.playback_id,
            stage: "youtube_player",
            reason: normalized.kind,
            error_name: normalized.name,
            ...normalized.properties,
            source_kind: "youtube",
            is_desktop: false,
            platform: "web",
            window_role: "background_projection_return",
          });
          Telemetry.captureException(error, {
            playback_id: fileState.playback_id,
            operation: "youtube_player",
            stage: "youtube_player",
            ...normalized.properties,
          });
        },
      },
    });
  }, isCurrent);
}

function _destroyYoutube(): void {
  ++ytGeneration;
  ytAwaitingSync = false;
  if (ytSyncFallbackTimer) clearTimeout(ytSyncFallbackTimer);
  ytSyncFallbackTimer = null;
  if (_ytSyncTimer) {
    clearInterval(_ytSyncTimer);
    _ytSyncTimer = null;
  }
  if (ytPlayer) {
    try {
      ytPlayer.destroy();
    } catch {
      /* ignore */
    }
    ytPlayer = null;
  }
  _ytInitializing = false;
  ytFailed.value = false;
}

function _broadcastYtState(): void {
  if (ytAwaitingSync || !ytPlayer || !ytPlayer.getCurrentTime || !fileState.active) return;
  const yt = getYT();
  if (!yt) return;
  try {
    $broadcast.send(BROADCAST_TYPE.YOUTUBE_STATE, {
      currentTime: ytPlayer.getCurrentTime(),
      isPaused: ytPlayer.getPlayerState() !== yt.PlayerState.PLAYING,
      duration: ytPlayer.getDuration() || 0,
      state: ytPlayer.getPlayerState(),
      playback_id: fileState.playback_id,
      sampledAt: Date.now(),
    });
  } catch {
    /* ignore */
  }
}

function _startYtSync(): void {
  _stopYtSync();
  _ytSyncTimer = setInterval(() => {
    _broadcastYtState();
  }, 2000);
}

function _stopYtSync(): void {
  if (_ytSyncTimer) {
    clearInterval(_ytSyncTimer);
    _ytSyncTimer = null;
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    setTimeout(() => window.close(), 200);
  }
}

/* ── PDF helpers ── */

async function loadPdf(url: string, pageNum: number, expectedPlaybackId?: string): Promise<void> {
  if (fileState.playback_id !== expectedPlaybackId || fileState.url !== url || !fileState.active)
    return;
  const generation = ++pdfLoadGeneration;
  pdfRenderQueue.invalidate();
  try {
    const doc = await loadPdfDocument({ url });
    if (
      generation !== pdfLoadGeneration ||
      fileState.playback_id !== expectedPlaybackId ||
      !fileState.active
    ) {
      await (doc as unknown as { destroy: () => Promise<void> }).destroy();
      return;
    }
    pdfDoc = doc;
    currentPdfPage.value = pageNum;
    await renderPdfPage(pageNum);
  } catch (err) {
    console.error("BackgroundProjectionReturn: PDF load error", err);
  }
}

async function renderPdfPage(pageNum: number): Promise<void> {
  const canvas = pdfCanvas.value;
  const doc = pdfDoc;
  if (!canvas || !doc) return;
  try {
    await pdfRenderQueue.run(async (isCurrent) => {
      if (pdfDoc !== doc) return;
      const page = await doc.getPage(pageNum);
      if (!isCurrent() || pdfDoc !== doc) return;
      const vp = page.getViewport({ scale: 1.5 });
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvas, viewport: vp }).promise;
    });
  } catch (err) {
    console.error("BackgroundProjectionReturn: PDF render error", err);
  }
}

async function reloadWallpaper(): Promise<void> {
  const useCustom =
    fileState.active &&
    $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED, false) === true;
  const id = useCustom ? SETTINGS_TABLE.FILE_PROJECTION_BACKGROUND : MAIN_BACKGROUND_ID;
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

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_BG_UPDATE, () => {
  reloadWallpaper();
});

useBroadcastListener(BROADCAST_TYPE.WALLPAPER_UPDATE, () => {
  reloadWallpaper();
});

onMounted(async () => {
  readPendingFile();
  setTimeout(readPendingFile, 500);
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000";
  window.addEventListener("keydown", onKey);
  await reloadWallpaper();
});

onBeforeUnmount(() => {
  pdfRenderQueue.invalidate();
  if (pdfDoc) {
    void (pdfDoc as unknown as { destroy: () => Promise<void> }).destroy().catch(() => {});
    pdfDoc = null;
  }
  _destroyYoutube();
  if (wpBlobUrl) URL.revokeObjectURL(wpBlobUrl);
});
</script>

<style scoped>
.return-wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
}
.return-root-bg {
  position: fixed;
  inset: 0;
  background: #000;
}
.return-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}
.return-bg--fallback {
  z-index: 0;
}

/* Vue Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--fade-ms, 500ms) linear;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.return-projection {
  position: fixed;
  inset: 0;
  z-index: 1;
}
.return-slide {
  width: 100%;
  height: 100%;
}
.return-file {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.return-file--pdf {
  object-fit: unset;
  display: block;
  margin: 0 auto;
}
.file-projection {
  position: fixed;
  inset: 0;
  z-index: 1;
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
