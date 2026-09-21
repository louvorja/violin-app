<template>
  <div
    ref="root"
    class="op-root"
    :class="{ 'op-root--video': videoActive }"
    role="application"
    :aria-label="t('shell.operator_label')"
    tabindex="0"
  >
    <div class="op-header">
      <span class="op-title">{{ title || "—" }}</span>
      <span class="op-hint">
        {{ videoActive ? t("shell.operator_video_hint") : t("shell.operator_hint") }}
      </span>
    </div>

    <!-- Vídeo de arquivo: substitui os slides antigos enquanto a mídia está no ar. -->
    <div v-if="videoActive" class="op-video">
      <div class="op-video-frame">
        <video
          v-show="!videoFailed"
          ref="videoRef"
          :src="videoUrl"
          class="op-video-media"
          autoplay
          muted
          playsinline
          preload="auto"
          @loadedmetadata="onVideoReady"
          @canplay="onVideoReady"
          @playing="onVideoPlaying"
          @waiting="onVideoBuffering"
          @stalled="onVideoBuffering"
          @error="onVideoError"
        />
        <div v-if="videoFailed" class="op-video-error">
          <span>{{ t("shell.operator_video_error") }}</span>
          <small>{{ videoTitle || "—" }}</small>
        </div>
      </div>
      <div class="op-video-caption">
        <span class="op-video-badge">{{ t("shell.operator_video") }}</span>
        <span class="op-video-title">{{ videoTitle || "—" }}</span>
      </div>
    </div>

    <div v-else-if="slides.length === 0" class="op-empty">
      {{ t("shell.operator_waiting") }}
    </div>

    <div v-else class="op-grid" role="grid">
      <div
        v-for="(slide, i) in slides"
        :key="i"
        class="op-card"
        role="gridcell"
        :aria-label="t('shell.operator_slide_label', { n: i + 1, total: slides.length })"
        :aria-selected="i === currentIndex"
        :class="{
          'op-card--active': i === currentIndex,
          'op-card--cover': slide.cover,
        }"
        :style="{ backgroundImage: slide.url_image ? `url(${imageUrl(slide.url_image)})` : 'none' }"
        @click="goTo(i)"
      >
        <div class="op-card-num">{{ i + 1 }}</div>
        <div class="op-card-text" v-html="slide.lyric || slide.name || '—'" />
      </div>
    </div>

    <div v-if="!videoActive" class="op-progress-bar">
      <div class="op-progress-fill" :style="{ width: progress + '%' }" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import $broadcast from "@/helpers/Broadcast";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import Telemetry from "@/helpers/Telemetry";
import Path from "@/helpers/Path";
import { syncVideoElement } from "@/helpers/VideoSync";

const { t } = useI18n();
const root = ref(null);
const slides = ref([]);

function imageUrl(value) {
  if (!value) return "";
  try {
    return Path.file(value);
  } catch {
    return value;
  }
}
const currentIndex = ref(0);
const title = ref("");
const progress = ref(0);
const videoActive = ref(false);
const videoUrl = ref("");
const videoTitle = ref("");
const videoFailed = ref(false);
const videoRef = ref(null);
let videoActivation = 0;
let videoObjectUrl = "";

function revokeVideoObjectUrl() {
  if (!videoObjectUrl) return;
  URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = "";
}

async function activateVideo(payload) {
  const activation = ++videoActivation;
  videoActive.value = false;
  videoFailed.value = false;
  slides.value = [];
  progress.value = 0;
  revokeVideoObjectUrl();

  let url = typeof payload?.url === "string" ? payload.url : "";
  if (payload?.libRef?.id && url.startsWith("blob:")) {
    try {
      const rec = await $idb.get(payload.libRef.table || DB_TABLE.MEDIA_LIBRARY, payload.libRef.id);
      if (activation !== videoActivation) return;
      if (rec?.data && rec.mime) {
        url = URL.createObjectURL(new Blob([rec.data], { type: rec.mime }));
        videoObjectUrl = url;
      } else {
        console.warn("[Operator] dados do vídeo do acervo ausentes:", payload.libRef.id);
      }
    } catch (error) {
      console.warn("[Operator] não foi possível resolver vídeo do acervo:", error);
    }
  }
  if (activation !== videoActivation) return;
  videoUrl.value = url;
  videoTitle.value = payload?.title || "";
  title.value = videoTitle.value;
  videoFailed.value = false;
  videoActive.value = payload?.type === "video" && !!url;
  await nextTick();
  if (videoActive.value) prepareVideo();
}

function prepareVideo() {
  const el = videoRef.value;
  if (!el || !videoActive.value) return;
  el.muted = true;
  el.playsInline = true;
  el.load();
  el.play().catch((error) => {
    console.warn("[Operator] vídeo não iniciou sozinho:", error?.name || error);
    Telemetry.log("warn", "operator video play rejected", {
      name: error?.name,
      message: error?.message,
      ready_state: el.readyState,
      network_state: el.networkState,
    });
  });
}

function onVideoReady() {
  const el = videoRef.value;
  if (!el) return;
  videoFailed.value = false;
  console.info("[Operator] vídeo pronto:", {
    title: videoTitle.value,
    duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : 0,
    width: el.videoWidth,
    height: el.videoHeight,
  });
  if (el.paused) el.play().catch(() => {});
}

function onVideoPlaying() {
  console.info("[Operator] vídeo reproduzindo:", {
    title: videoTitle.value,
    current_time: Number.isFinite(videoRef.value?.currentTime)
      ? Number(videoRef.value.currentTime.toFixed(3))
      : 0,
  });
}

function onVideoBuffering(event) {
  const el = event.currentTarget;
  console.warn("[Operator] vídeo aguardando dados:", {
    trigger: event.type,
    current_time: Number.isFinite(el?.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
    ready_state: el?.readyState,
    network_state: el?.networkState,
  });
}

function onVideoError(event) {
  const el = event.currentTarget;
  videoFailed.value = true;
  const code = el?.error?.code;
  const reason = code === 3 ? "decode" : code === 4 ? "source_not_supported" : "unknown";
  const error = new Error(`Operator video ${reason}`);
  Telemetry.captureException(error, { operation: "operator_video", reason });
  console.error("[Operator] vídeo local falhou:", error, {
    code,
    message: el?.error?.message,
    src: videoUrl.value.substring(0, 100),
  });
  Telemetry.track("operator_video_failed", {
    code: el?.error?.code,
    message: el?.error?.message,
  });
}

useBroadcastListener(BROADCAST_TYPE.SLIDES_DATA, (payload) => {
  videoActivation++;
  revokeVideoObjectUrl();
  videoActive.value = false;
  videoFailed.value = false;
  slides.value = payload.slides || [];
  title.value = payload.title || "";
  currentIndex.value = payload.slide_index ?? 0;
});

useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION, (payload) => {
  if (payload?.type === "video" && payload?.url) {
    void activateVideo(payload);
  } else {
    videoActivation++;
    revokeVideoObjectUrl();
    videoActive.value = false;
    videoFailed.value = false;
    slides.value = [];
    progress.value = 0;
    title.value = payload?.title || "";
  }
});

useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload) => {
  if (!videoActive.value) return;
  const el = videoRef.value;
  if (!el) return;
  if (typeof payload?.isPaused === "boolean") {
    if (payload.isPaused && !el.paused) el.pause();
    else if (!payload.isPaused && el.paused) {
      el.play().catch((error) => {
        console.warn("[Operator] vídeo não iniciou na sincronia:", error?.name || error);
      });
    }
  }
  syncVideoElement(el, payload || {});
});

useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, () => {
  videoActivation++;
  revokeVideoObjectUrl();
  videoActive.value = false;
  videoFailed.value = false;
  videoUrl.value = "";
  videoTitle.value = "";
});

useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload) => {
  currentIndex.value = payload.slide_index ?? 0;
  progress.value = payload.progress ?? 0;
  if (payload.title) title.value = payload.title;
});

// Scroll para o card ativo após qualquer mudança de currentIndex originada
// por slide_change (navegação externa) ou por goTo() (teclado/clique).
watch(currentIndex, () => scrollToActive(), { flush: "post" });

function goTo(index) {
  currentIndex.value = index;
  $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index });
}

function onKey(e) {
  if (videoActive.value) {
    if (e.key === "Escape") {
      e.preventDefault();
      window.close();
    }
    return;
  }
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    if (currentIndex.value < slides.value.length - 1) goTo(currentIndex.value + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    if (currentIndex.value > 0) goTo(currentIndex.value - 1);
  } else if (e.key === "Home") {
    e.preventDefault();
    goTo(0);
  } else if (e.key === "End") {
    e.preventDefault();
    goTo(slides.value.length - 1);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    goTo(currentIndex.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
}

function scrollToActive() {
  nextTick(() => {
    const active = root.value?.querySelector(".op-card--active");
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

onMounted(() => {
  document.body.style.margin = "0";
  root.value?.focus();
  // Captura setas globalmente — sem depender do foco do root
  window.addEventListener("keydown", onKey);
  // Uma janela de operador recém-criada pode perder o broadcast transitório
  // que abriu o vídeo. Reaproveitar o payload persistido evita a tela vazia
  // ao fechar/reabrir a janela durante a mesma reprodução.
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    if (stored) {
      const pending = JSON.parse(stored);
      if (pending?.type === "video" && pending?.url) {
        console.info("[Operator] reidratando vídeo pendente");
        void activateVideo(pending);
      }
    }
  } catch (error) {
    console.warn("[Operator] não foi possível reidratar vídeo pendente:", error);
  }
  // Solicita estado atual (caso a música já tenha aberto antes desta janela)
  $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  revokeVideoObjectUrl();
});
</script>

<style>
/* Cores Delphi do fmMusicaOperador: panel #353535, grid lines #524752.
   O fundo cinza é do .op-root: no corpo, ele pintava a janela inteira entre o
   carregamento do CSS e a montagem da tela, uma piscada cinza antes do vídeo. */
body {
  margin: 0;
  color: #fff;
  font-family: var(--lj-font-projection);
}
</style>
<style scoped>
.op-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #232323;
  outline: none;
  font-family: var(--lj-font-projection);
}
.op-root--video {
  background: #111;
}
.op-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #353535;
  border-bottom: 1px solid #524752;
  flex-shrink: 0;
}
.op-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #efb400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.op-hint {
  font-size: 0.75rem;
  color: #888;
  white-space: nowrap;
  letter-spacing: 0.05em;
}
.op-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 1.2rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.op-video {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #111;
}
.op-video-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
  border: 1px solid #3e3e3e;
}
.op-video-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.op-video-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.8);
  text-align: center;
}
.op-video-error small {
  max-width: 80%;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.5);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.op-video-caption {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  color: rgba(255, 255, 255, 0.72);
}
.op-video-badge {
  flex-shrink: 0;
  padding: 3px 8px;
  border: 1px solid rgba(239, 180, 0, 0.6);
  border-radius: 999px;
  color: #efb400;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.op-video-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.op-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 6px;
  padding: 10px;
  overflow-y: auto;
  align-content: start;
  background: #232323;
}
.op-card {
  position: relative;
  aspect-ratio: 16/9;
  background: #1a1a1a;
  border: 2px solid #524752;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background-size: cover;
  background-position: center;
  transition:
    border-color 0.12s,
    transform 0.08s;
}
.op-card:hover {
  border-color: #efb400;
  transform: scale(1.015);
}
.op-card--active {
  border-color: #efb400;
  box-shadow:
    0 0 0 2px rgba(239, 180, 0, 0.4),
    inset 0 0 0 1px rgba(239, 180, 0, 0.2);
}
.op-card--cover {
  background: #1a1a1a;
}
.op-card-num {
  position: absolute;
  top: 3px;
  left: 5px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
.op-card-text {
  font-size: 0.85rem;
  color: #fff;
  text-align: center;
  line-height: 1.25;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  max-height: 100%;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.op-card--active .op-card-text {
  color: #efb400;
}
.op-card--active.op-card--cover .op-card-text {
  color: #efb400;
}
.op-card--cover:not(.op-card--active) .op-card-text {
  color: #efb400;
}
.op-progress-bar {
  height: 3px;
  background: #353535;
  flex-shrink: 0;
}
.op-progress-fill {
  height: 100%;
  background: #efb400;
  transition: width 0.5s linear;
}
</style>
