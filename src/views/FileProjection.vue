<template>
  <OverlayRenderer />
  <div class="fp-wallpaper" :style="fallbackStyle"></div>
  <div v-if="fileProjection.active" class="file-projection" @click="fileProjection.active = false">
    <img
      v-if="fileProjection.type === 'image'"
      :src="fileProjection.url"
      class="file-projection__media"
      alt=""
    />
    <template v-else-if="fileProjection.type === 'video'">
      <video
        v-show="!videoFailed"
        ref="videoRef"
        :src="fileProjection.url"
        class="file-projection__media"
        autoplay
        muted
        playsinline
        @loadedmetadata="onVideoReady"
        @canplay="onVideoReady"
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
      <div v-show="!ytFailed" ref="ytContainer" class="file-projection__youtube" />
      <div v-if="ytFailed" class="video-unavailable">
        <span class="video-unavailable__title">{{ $t("projection.video_unavailable") }}</span>
        <span class="video-unavailable__hint">{{ $t("projection.video_unavailable_hint") }}</span>
      </div>
    </template>
    <canvas
      v-else-if="fileProjection.type === 'pdf'"
      ref="pdfCanvas"
      class="file-projection__pdf"
    />
  </div>
  <div v-else class="file-projection__empty"></div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useProjectionCloseNotice } from "@/composables/useProjectionCloseNotice";
import { PROJECTION_TYPE } from "@/constants/Projection";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import Media from "@/composables/useMedia";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import {
  FileProjectionState,
  VideoMediaState,
  YouTubeControlPayload,
  YTAPI,
  YTPlayer,
} from "@/types/Media";
import { loadYtApi } from "@/composables/useYouTubeApi";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import $userdata from "@/helpers/UserData";
import { getSetting } from "@/helpers/SettingsStorage";
import { Settings } from "@/types/Settings";
import { KEYS } from "@/constants/UserDataKeys";
import { SETTINGS_TABLE } from "@/constants/DbTables";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

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
const ytContainer = ref<HTMLDivElement | null>(null);
const pdfCanvas = ref<HTMLCanvasElement | null>(null);

let pdfDoc: import("pdfjs-dist").PDFDocumentProxy | null = null;

let ytPlayer: YTPlayer | null = null;
let ytSyncTimer: ReturnType<typeof setInterval> | null = null;
let _ytInitializing = false;
const ytFailed = ref(false);

const _YT_SYNC_INTERVAL = 500;

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

async function renderPdfPage(pageNum: number): Promise<void> {
  const canvas = pdfCanvas.value;
  if (!pdfDoc || !canvas) return;
  try {
    const page = await pdfDoc.getPage(pageNum);
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await page.render({ canvas, viewport: scaled }).promise;
    fileProjection.page = pageNum;
  } catch (e) {
    console.error("[FileProjection] Erro render página:", e);
  }
}

async function loadPdf(url: string, pageNum = 1): Promise<void> {
  try {
    if (pdfDoc) {
      try {
        await (pdfDoc as any).destroy();
      } catch {
        /* ignore */
      }
    }
    pdfDoc = null;
    const data = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "file" }).then(
      (r) => r.arrayBuffer()
    );
    pdfDoc = await getDocument({ data }).promise;
    fileProjection.totalPages = pdfDoc.numPages;
    await renderPdfPage(pageNum);
    Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
      page: fileProjection.page,
      totalPages: pdfDoc.numPages,
    });
  } catch (e) {
    console.error("[FileProjection] Erro carregar PDF:", e);
  }
}

async function _activateProjection(p: FileProjectionState): Promise<void> {
  // URLs blob só existem no documento que as criou — quando o payload traz
  // a referência da biblioteca, recria o objeto localmente lendo o IDB.
  if (p.libRef?.id && p.url?.startsWith("blob:")) {
    try {
      const rec = await $idb.get<{ data?: ArrayBuffer; mime?: string }>(
        p.libRef.table || DB_TABLE.MEDIA_LIBRARY,
        p.libRef.id
      );
      if (rec?.data && rec.mime) {
        p = { ...p, url: URL.createObjectURL(new Blob([rec.data], { type: rec.mime })) };
      }
    } catch (e) {
      console.warn("[FileProjection] libRef resolve falhou:", e);
    }
  }
  fileProjection.active = true;
  fileProjection.type = p.type || "image";
  fileProjection.url = p.url || "";
  fileProjection.title = p.title || "";
  fileProjection.playback_id = p.playback_id;
  console.log("[FileProjection] Ativado:", p.type, p.url?.substring(0, 60));
  if (p.type === "video") {
    videoFailed.value = false;
    await nextTick();
    _prepareVideo();
  }
  if (p.type === "youtube") nextTick(() => _initYoutube());
  if (p.type === "pdf") nextTick(() => loadPdf(p.url, p.page || 1));
}

function _prepareVideo(): void {
  const el = videoRef.value;
  if (!el || !fileProjection.active || fileProjection.type !== "video") return;
  videoFailed.value = false;
  el.muted = true;
  el.playsInline = true;
  el.load();
  el.play().catch((error) => {
    // O erro de codec chega também pelo evento `error`; este log captura o
    // caso em que o Windows bloqueia autoplay ou o arquivo ainda não tem
    // metadata sem deixar a projeção totalmente preta e sem explicação.
    console.warn("[FileProjection] vídeo não iniciou:", error?.name || error);
    Telemetry.log("warn", "file projection video play rejected", {
      name: error?.name,
      message: error?.message,
      ready_state: el.readyState,
      network_state: el.networkState,
      source_type: "file_projection_video",
    });
  });
}

function onVideoReady(): void {
  const el = videoRef.value;
  if (!el) return;
  videoFailed.value = false;
  console.info("[FileProjection] vídeo pronto:", {
    playback_id: fileProjection.playback_id,
    duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : 0,
    width: el.videoWidth,
    height: el.videoHeight,
    ready_state: el.readyState,
    network_state: el.networkState,
  });
  Telemetry.track("file_projection_video_ready", {
    playback_id: fileProjection.playback_id,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    width: el.videoWidth,
    height: el.videoHeight,
  });
  if (el.paused) el.play().catch(() => {});
}

function onVideoPlaying(): void {
  const el = videoRef.value;
  console.info("[FileProjection] vídeo reproduzindo:", {
    playback_id: fileProjection.playback_id,
    current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
  });
  Telemetry.track("file_projection_video_playing", {
    playback_id: fileProjection.playback_id,
  });
}

function onVideoBuffering(event: Event): void {
  const el = event.currentTarget as HTMLVideoElement | null;
  console.warn("[FileProjection] vídeo aguardando dados:", {
    playback_id: fileProjection.playback_id,
    trigger: event.type,
    current_time: el && Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
  Telemetry.log("warn", "file projection video buffering", {
    playback_id: fileProjection.playback_id,
    trigger: event.type,
    current_time: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
    ready_state: el?.readyState,
  });
}

function onVideoError(event: Event): void {
  const el = event.currentTarget as HTMLVideoElement | null;
  videoFailed.value = true;
  const code = el?.error?.code;
  const reason = code === 3 ? "decode" : code === 4 ? "source_not_supported" : "unknown";
  console.error("[FileProjection] vídeo local falhou:", {
    code,
    message: el?.error?.message,
    src: fileProjection.url?.substring(0, 100),
  });
  Telemetry.track("file_projection_video_failed", {
    playback_id: fileProjection.playback_id,
    reason,
    code,
    message: el?.error?.message,
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
  Telemetry.captureException(new Error(`File projection video ${reason}`), {
    playback_id: fileProjection.playback_id,
    operation: "file_projection_video",
    reason,
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

useProjectionCloseNotice(PROJECTION_TYPE.FILE);

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION, (payload: unknown) => {
  _activateProjection((payload || {}) as FileProjectionState);
});

useBroadcastListener(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, (payload: unknown) => {
  _activateProjection((payload || {}) as FileProjectionState);
});

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_PAGE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "pdf") return;
  const data = payload as { page?: number };
  if (typeof data.page === "number" && pdfDoc) {
    const clamped = Math.max(1, Math.min(data.page, pdfDoc.numPages));
    if (clamped !== data.page) {
      Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
        page: clamped,
        totalPages: pdfDoc.numPages,
      });
    }
    renderPdfPage(clamped);
  }
});

useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, async () => {
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
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
  } catch {
    /* ignore */
  }
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "video") return;
  const el = videoRef.value;
  if (!el) return;
  const data = payload as VideoMediaState;

  if (typeof data.isPaused === "boolean") {
    if (data.isPaused && !el.paused) {
      el.pause();
    } else if (!data.isPaused && el.paused) {
      el.play().catch((error) => {
        Telemetry.log("warn", "file projection video sync play rejected", {
          playback_id: fileProjection.playback_id,
          name: error?.name,
          message: error?.message,
        });
      });
    }
  }

  if (typeof data.currentTime === "number") {
    const drift = Math.abs(el.currentTime - data.currentTime);
    if (drift > 1.5 && el.readyState >= 1) {
      try {
        el.currentTime = Math.max(0, data.currentTime);
      } catch {
        /* metadata ainda não chegou */
      }
    }
  }
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "youtube") return;
  if (!ytPlayer || !ytPlayer.getCurrentTime) return;
  const data = payload as VideoMediaState;
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
  }
});

useBroadcastListener(BROADCAST_TYPE.YOUTUBE_CONTROL, (payload: unknown) => {
  if (!fileProjection.active || fileProjection.type !== "youtube") return;
  if (!ytPlayer) return;
  const data = payload as YouTubeControlPayload;
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

function _loadYtApi(cb: (YT: YTAPI) => void): void {
  ytFailed.value = false;
  loadYtApi()
    .then(cb)
    .catch((e: Error) => {
      _ytInitializing = false;
      ytFailed.value = true;
      console.warn("[FileProjection] YouTube indisponível:", e?.message || e);
    });
}

function _initYoutube(): void {
  if (_ytInitializing) return;
  _ytInitializing = true;
  _destroyYoutube();
  const id = _embedUrlToId(fileProjection.url);
  console.log(
    "[FileProjection] _initYoutube - videoId:",
    id,
    "url:",
    fileProjection.url?.substring(0, 60)
  );
  if (!id) {
    console.warn("[FileProjection] ID do YouTube não extraído da URL");
    return;
  }
  if (!ytContainer.value) {
    console.warn("[FileProjection] Container YouTube não encontrado no DOM");
    return;
  }

  _loadYtApi((YT: YTAPI) => {
    if (!ytContainer.value) return;
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
          _ytInitializing = false;
          console.log("[FileProjection] YouTube player ready");
          Telemetry.track("music_youtube_player_ready", {
            playback_id: fileProjection.playback_id,
            source_type: "youtube",
            window_role: "auxiliary",
          });
          if (ytPlayer) ytPlayer.playVideo();
          setTimeout(() => {
            if (ytPlayer && typeof ytPlayer.unMute === "function") {
              ytPlayer.unMute();
            }
          }, 500);
          _broadcastYtState();
          _startYtSync();
        },
        onApiChange: () => {
          try {
            if (typeof (ytPlayer as any)?.setOption === "function")
              (ytPlayer as any).setOption("captions", "track", {});
          } catch {
            console.error("Erro ao desativar o captions do Youtube");
          }
        },
        onStateChange: (e: { data: number }) => {
          Telemetry.track("music_youtube_state_changed", {
            playback_id: fileProjection.playback_id,
            state: e.data,
            window_role: "auxiliary",
          });
          _broadcastYtState();
          const yt = getYT();
          if (e.data === yt?.PlayerState.ENDED) {
            Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
            Media.close(true);
          }
        },
        onError: (e: number) => {
          console.error("[FileProjection] YouTube player error:", e);
          Telemetry.track("music_playback_failed", {
            playback_id: fileProjection.playback_id,
            stage: "youtube_player",
            reason: `youtube_${e}`,
            provider_code: e,
            window_role: "auxiliary",
          });
          Telemetry.captureException(new Error(`YouTube player error ${e}`), {
            playback_id: fileProjection.playback_id,
            operation: "youtube_player",
          });
        },
      },
    });
  });
}

function _destroyYoutube(): void {
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

function _broadcastYtState(): void {
  if (!ytPlayer || !ytPlayer.getCurrentTime || !fileProjection.active) return;
  const yt = getYT();
  if (!yt) return;
  try {
    Broadcast.send(BROADCAST_TYPE.YOUTUBE_STATE, {
      currentTime: ytPlayer.getCurrentTime(),
      isPaused: ytPlayer.getPlayerState() !== yt.PlayerState.PLAYING,
      duration: ytPlayer.getDuration() || 0,
      state: ytPlayer.getPlayerState(),
      playback_id: fileProjection.playback_id,
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
  window.addEventListener("keydown", _onKey);
  await reloadWallpaper();
});

onBeforeUnmount(async () => {
  if (wpBlobUrl) URL.revokeObjectURL(wpBlobUrl);
  if (pdfDoc) {
    try {
      await (pdfDoc as any).destroy();
    } catch {
      /* ignore */
    }
  }
  pdfDoc = null;
  _destroyYoutube();
  window.removeEventListener("keydown", _onKey);
});
</script>

<style scoped>
.fp-wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
}
.file-projection {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  overflow: hidden;
}
.file-projection__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.file-projection__media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.file-projection video.file-projection__media {
  width: 100%;
  height: 100%;
}
.file-projection__youtube {
  width: 100vw;
  height: 100vh;
}
.file-projection__pdf {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
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
