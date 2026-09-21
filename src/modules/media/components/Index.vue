<template>
  <Window
    v-model="module_.show"
    :title="config?.title"
    :subtitle="
      config?.subtitle + (config?.track > 0 ? ' | ' + tm('general.track') + ' ' + config.track : '')
    "
    :image="config?.image ? pathFile(config.image) : ''"
    closable
    minimizable
    compact
    compact_footer
    size="large"
    dark
    @close="closeMedia()"
    @minimize="minimizeMedia()"
    @resize="resize"
  >
    <template #system_buttons>
      <LjPopover v-if="is_online" side="bottom" align="end">
        <template #trigger>
          <LjButton
            class="media-menu-trigger"
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.UI.MENU"
            :aria-label="$t('shell.appmenu_items.settings')"
          />
        </template>

        <div class="media-options">
          <LjTooltip :text="tm('inputs.lazy_load_tooltip')" side="bottom">
            <LjSwitch v-model="lazy_load" :label="tm('inputs.lazy_load')" />
          </LjTooltip>
          <LjTooltip :text="tm('inputs.fade_audio_tooltip')" side="bottom">
            <LjSwitch v-model="fade_audio" :label="tm('inputs.fade_audio')" />
          </LjTooltip>
        </div>
      </LjPopover>
    </template>

    <div
      class="media-body"
      :class="{ 'media-body--video': isLocalVideo }"
      :style="{ height: preview_height + 'px' }"
    >
      <div class="media-preview-col">
        <Fullscreen
          v-if="!isYouTube"
          v-model="fullscreen"
          class="media-preview"
          :style="{ height: preview_height + 'px' }"
        >
          <div v-if="isLocalVideo" class="media-video-stage">
            <video
              v-show="!videoPreviewFailed"
              ref="videoPreview"
              class="media-video-preview"
              :src="config?.video_src || config?.audio || ''"
              autoplay
              muted
              playsinline
              @error="onVideoPreviewError"
              @loadedmetadata="syncVideoPreview"
            />
            <div v-if="videoPreviewFailed" class="media-video-error">
              <span>{{ $t("projection.video_unavailable") }}</span>
              <small>{{ $t("projection.video_unavailable_hint") }}</small>
            </div>
          </div>
          <l-slide v-else-if="slide" :slide="slideForRenderer" :title="config?.title || ''" />
          <l-fullscreen-player v-if="fullscreen" />
        </Fullscreen>
        <div
          v-else
          class="media-preview media-preview--youtube"
          :style="{ height: preview_height + 'px' }"
        >
          <img v-if="youtubeThumbnail" :src="youtubeThumbnail" alt="" class="media-thumbnail" />
        </div>
      </div>
      <div v-if="width > 600 && !isLocalVideo" class="media-side">
        <div v-if="!isYouTube" class="media-side__header">
          <span class="media-side__title">{{ tm("general.slides") }}</span>
          <span class="media-side__count">
            {{
              slides.length ? `${Math.min(slide_index + 1, slides.length)}/${slides.length}` : "—"
            }}
          </span>
        </div>
        <!-- Slide list for music -->
        <div v-if="!isYouTube" ref="slides_list" class="media-slides">
          <button
            v-for="(item, index) in slides"
            :key="index"
            ref="slideItem"
            type="button"
            class="media-slide"
            :class="{ 'is-active': config.slide_index === index }"
            :aria-current="config.slide_index === index ? 'true' : undefined"
            @click="goToSlide(index)"
          >
            <LjChip class="media-slide__number">{{ index + 1 }}</LjChip>

            <span class="media-slide__content">
              <span v-if="item.cover" class="media-slide__title">
                {{ item.lyric }}
              </span>
              <span v-else class="media-slide__lyric" v-html="item.lyric" />
              <LjProgress
                v-if="config.audio != '' && config.slide_index == index"
                class="media-slide__progress"
                :class="{ 'media-slide__progress--paused': config.is_paused }"
                :value="config.slide_progress"
                :indeterminate="loading"
                :height="5"
              />
            </span>

            <img
              v-if="item.url_image"
              :src="pathFile(item.url_image)"
              alt=""
              class="media-preload"
            />
          </button>
        </div>
        <!-- YouTube info panel -->
        <div v-else class="media-youtube">
          <div class="media-youtube__label">{{ tm("general.channel") }}</div>
          <div class="media-youtube__value">
            <a v-if="ytChannelUrl" :href="ytChannelUrl" target="_blank" class="media-youtube__link">
              {{ ytChannel || "—" }}
            </a>
            <span v-else>{{ ytChannel || "—" }}</span>
          </div>
          <LjDivider class="media-youtube__divider" />
          <div class="media-youtube__label">
            {{ tm("general.video_link") }}
          </div>
          <a
            v-if="youtubeWatchUrl"
            :href="youtubeWatchUrl"
            target="_blank"
            class="media-youtube__link media-youtube__link--url"
          >
            {{ youtubeWatchUrl }}
          </a>
        </div>
      </div>
    </div>

    <template #footer>
      <l-player location="window" />
    </template>
  </Window>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useViewport } from "@/composables/useViewport";
import { component as Fullscreen } from "vue-fullscreen";
import { module as manifest } from "../manifest";
import Window from "@/components/Window.vue";
import LSlide from "@/components/Slide.vue";
import LPlayer from "@/components/Player.vue";
import LFullscreenPlayer from "@/components/FullscreenPlayer.vue";
import {
  LjButton,
  LjChip,
  LjDivider,
  LjPopover,
  LjProgress,
  LjSwitch,
  LjTooltip,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Modules from "@/helpers/Modules";
import UserData from "@/helpers/UserData";
import AppData from "@/helpers/AppData";
import Media from "@/composables/useMedia";
import { useFileProjection } from "@/composables/useFileProjection";
import Path from "@/helpers/Path";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import Telemetry from "@/helpers/Telemetry";

const { t: i18nT } = useI18n();
const { width } = useViewport();
const moduleId = manifest.id;
const module_ = computed(() => Modules.get(moduleId));

const preview_height = ref(0);
const slideItem = ref(null);
const slides_list = ref(null);

const tm = (text) => i18nT(`modules.${moduleId}.${text}`);

const is_online = computed(() => AppData.get("is_online"));
const loading = computed(() => module_.value.loading);
const config = computed(() => Media.config());
const slide_index = computed(() => config.value?.slide_index);
const slides = computed(() => Media.slides());
const slide = computed(() => Media.slide());
const playback = useAudioPlayback();
const videoPreview = ref(null);
const videoPreviewFailed = ref(false);
let videoSyncTimer = null;
let mediaMounted = false;

// O Slide.vue já resolve url_image relativo via Path.file internamente, então
// repassamos o slide bruto. (Ainda mantemos pathFile() em Path.file via
// computed para o image do <Window>.)
const slideForRenderer = computed(() => slide.value);
const isLocalVideo = computed(
  () => !!config.value?.video_file && !!config.value?.audio && !config.value?.is_youtube
);

const isYouTube = computed(() => !!config.value?.is_youtube);
const youtubeId = computed(() => {
  if (!isYouTube.value) return null;
  const url = config.value?.youtube_url;
  if (!url) return null;
  const m = String(url).match(/\/embed\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
});
const youtubeThumbnail = computed(() => {
  return youtubeId.value ? `https://img.youtube.com/vi/${youtubeId.value}/maxresdefault.jpg` : "";
});
const youtubeWatchUrl = computed(() => {
  return youtubeId.value ? `https://www.youtube.com/watch?v=${youtubeId.value}` : "";
});

const ytChannel = ref("");
const ytChannelUrl = ref("");
let ytChannelReq = 0;

function fetchYouTubeChannel(id) {
  ytChannelReq++;
  const req = ytChannelReq;
  if (!id) {
    ytChannel.value = "";
    ytChannelUrl.value = "";
    return;
  }
  fetchWithTimeout(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
    { timeout: NET_TIMEOUT.QUICK, source: "youtube-oembed", thirdParty: true }
  )
    .then((r) => r.json())
    .then((data) => {
      if (req !== ytChannelReq) return;
      ytChannel.value = data.author_name || "";
      ytChannelUrl.value = data.author_url || "";
    })
    .catch(() => {});
}

function onVideoPreviewError(event) {
  videoPreviewFailed.value = true;
  const video = event?.currentTarget;
  Telemetry.log("error", "media local video preview error", {
    code: video?.error?.code,
    message: video?.error?.message,
    source_type: "local_video_preview",
    title: config.value?.title || "",
  });
}

function syncVideoPreview() {
  const video = videoPreview.value;
  if (!video || !isLocalVideo.value) return;
  const source = playback.getElement();
  if (
    Number.isFinite(source.currentTime) &&
    Math.abs(video.currentTime - source.currentTime) > 0.35
  ) {
    try {
      video.currentTime = source.currentTime;
    } catch {
      /* ainda sem metadata */
    }
  }
  if (source.paused) {
    if (!video.paused) video.pause();
  } else if (video.paused) {
    video.play().catch(() => {});
  }
}

function stopVideoSyncTimer() {
  if (videoSyncTimer) {
    window.clearInterval(videoSyncTimer);
    videoSyncTimer = null;
  }
}

function updateVideoSyncTimer() {
  if (!mediaMounted || !isLocalVideo.value) {
    stopVideoSyncTimer();
    return;
  }
  if (!videoSyncTimer) videoSyncTimer = window.setInterval(syncVideoPreview, 250);
}

watch(
  () => [isLocalVideo.value, config.value?.audio],
  async () => {
    videoPreviewFailed.value = false;
    await nextTick();
    const video = videoPreview.value;
    if (video) {
      video.load();
      video.play().catch(() => {});
      syncVideoPreview();
    }
    updateVideoSyncTimer();
  },
  { immediate: true }
);
watch(
  youtubeId,
  (id) => {
    fetchYouTubeChannel(id);
  },
  { immediate: true }
);

const fullscreen = computed({
  get: () => module_.value.config?.fullscreen,
  set: (value) => Media.fullscreen(value),
});

const lazy_load = computed({
  get: () => UserData.get("modules.media.lazy_load"),
  set: (value) => UserData.set("modules.media.lazy_load", value),
});

const fade_audio = computed({
  get: () => UserData.get("modules.media.fade_audio"),
  set: (value) => UserData.set("modules.media.fade_audio", value),
});

watch(slide_index, async () => {
  if (!module_.value.show) return;
  await nextTick();
  const list = slides_list.value;
  const items = slideItem.value;
  // Os itens da lista são elementos nativos desde a migração; `$el` fica como
  // salvaguarda caso voltem a ser componentes.
  const item = items && (items[slide_index.value]?.$el ?? items[slide_index.value]);
  if (!list || !item) return;
  // Centraliza em vez de medir por altura fixa: um slide com várias linhas de
  // letra é mais alto que os outros, e a aritmética por índice desalinhava.
  const top = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
  list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
});

function pathFile(img) {
  return Path.file(img);
}

function closeMedia() {
  Media.close();
}

function minimizeMedia() {
  Media.minimize();
}

function goToSlide(index) {
  Media.goToSlide(index);
}

function resize(data) {
  preview_height.value = data.container_height;
}

// ---------------------------------------------------------------------------
// Atalhos de teclado para navegação de slides — listener direto na janela.
// Substitui (na prática) a registração via Hotkeys.js para esta janela: garante
// que ←/→/↑/↓/PageUp/PageDown SEMPRE naveguem slides quando o media está aberto,
// sem depender de prioridade de registro de outros módulos (Bíblia etc.) e sem
// que o focus trap do v-dialog ou listeners internos do Vuetify "comam" o evento.
// stopImmediatePropagation evita disparo duplo do handler global do Hotkeys.
// ---------------------------------------------------------------------------
function _isInTextField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

function _onKeyNav(e) {
  if (!module_.value?.show && !module_.value?.minimized) return;
  // Não intercepta quando anúncios/projeção de arquivos está ativa.
  if (useFileProjection().isProjecting.value) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // deixa Ctrl+arrow etc passar
  if (_isInTextField()) return;

  let handled = false;
  switch (e.key) {
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      Media.prevSlide();
      handled = true;
      break;
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      Media.nextSlide();
      handled = true;
      break;
    case "Home":
      Media.firstSlide();
      handled = true;
      break;
    case "End":
      Media.lastSlide();
      handled = true;
      break;
  }
  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

// Mantém o flag config.fullscreen sincronizado com o estado REAL do browser.
// Sem isso, quando o requestFullscreen() não entrava de fato (ex.: chamado fora
// de um gesto do usuário) o flag ficava true e o <l-fullscreen-player> aparecia
// como overlay duplicado sobre o player do rodapé.
function _syncFullscreenFlag() {
  const real = !!document.fullscreenElement;
  if (module_.value?.config?.fullscreen && !real) {
    Media.fullscreen(false);
  }
}

onMounted(() => {
  mediaMounted = true;
  // capture:true → o listener fica antes de qualquer handler interno do v-dialog
  // ou v-list. Com stopImmediatePropagation neutraliza o handler global Hotkeys.
  window.addEventListener("keydown", _onKeyNav, { capture: true });
  document.addEventListener("fullscreenchange", _syncFullscreenFlag);
  // Não manter polling quando a mídia aberta é apenas áudio ou YouTube.
  updateVideoSyncTimer();
  // Sync inicial — corrige flag herdado de sessão anterior se já estiver torto.
  _syncFullscreenFlag();
});

onBeforeUnmount(() => {
  mediaMounted = false;
  window.removeEventListener("keydown", _onKeyNav, { capture: true });
  document.removeEventListener("fullscreenchange", _syncFullscreenFlag);
  stopVideoSyncTimer();
});
</script>

<style scoped>
.media-menu-trigger {
  margin-inline-start: var(--lj-space-4);
}

.media-body {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  justify-content: space-between;
  overflow: hidden;
}

.media-preview-col {
  flex: 1;
  min-width: 0;
}

/* Vídeo local não possui slides. Remover a coluna lateral deixa a prévia usar
   toda a largura disponível, em vez de reservar 250px de uma lista vazia. */
.media-body--video .media-preview-col {
  flex: 1 1 100%;
  width: 100%;
}

.media-preview {
  width: 100%;
  overflow: hidden;
}

.media-video-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.media-body--video .media-video-stage {
  border-radius: var(--lj-radius-sm);
}

.media-video-preview {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.media-video-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-white);
  text-align: center;
}

.media-video-error small {
  color: var(--lj-white-alpha-70);
}

.media-side {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 270px;
  min-height: 0;
  border-left: 1px solid var(--lj-white-alpha-12);
  background: var(--lj-color-projection-bg);
}

.media-side__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 46px;
  padding: 0 var(--lj-space-5);
  border-bottom: 1px solid var(--lj-white-alpha-12);
  color: var(--lj-white-alpha-70);
}

.media-side__title {
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.03em;
}

.media-side__count {
  color: var(--lj-white-alpha-50);
  font-size: var(--lj-text-sm);
  font-variant-numeric: tabular-nums;
}

.media-preview--youtube {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lj-color-projection-bg);
}

.media-thumbnail {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* A faixa de slides é sempre preta, independente do tema do shell. Os
   primitivos usados aqui dentro leem tokens de superfície, então eles são
   redefinidos no escopo da faixa para render claro sobre fundo escuro. */
.media-slides {
  /* offsetParent dos itens: sem isso, o offsetTop usado para centralizar o
     slide corrente é medido contra o card do diálogo e desalinha o scroll. */
  position: relative;
  flex-shrink: 0;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--lj-color-projection-bg);
  color: var(--lj-white);

  --lj-surface-bg-active: var(--lj-white-alpha-18);
  --lj-surface-border: var(--lj-white-alpha-20);
  --lj-text-muted: var(--lj-white-alpha-50);
}

.media-slide {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  width: 100%;
  min-height: 60px;
  padding: var(--lj-space-3) var(--lj-space-6);
  background: transparent;
  border: none;
  color: inherit;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
  transition: background var(--lj-transition-fast);
}

.media-slide:hover {
  background: var(--lj-white-alpha-08);
}

.media-slide:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.media-slide.is-active {
  background: var(--lj-white-alpha-18);
  box-shadow: inset 3px 0 0 var(--lj-orange);
}

.media-slide__number {
  flex-shrink: 0;
}

.media-slide__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.media-slide__title {
  font-size: var(--lj-text-xl);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-slide__lyric {
  font-size: var(--lj-text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A barra do slide corrente é branca; laranja enquanto pausado. */
.media-slide__progress :deep(.lj-progress__bar) {
  background: var(--lj-white);
}

.media-slide__progress--paused :deep(.lj-progress__bar) {
  background: var(--lj-orange);
}

/* Pré-carrega a imagem do slide sem exibi-la. */
.media-preload {
  display: none;
}

.media-youtube {
  flex-shrink: 0;
  width: 100%;
  padding: var(--lj-space-6);
  overflow-y: auto;
  color: var(--lj-white);

  --lj-surface-divider: var(--lj-white-alpha-18);
}

.media-youtube__label {
  margin-bottom: var(--lj-space-2);
  color: var(--lj-white-alpha-50);
  font-size: var(--lj-text-base);
}

.media-youtube__value {
  margin-bottom: var(--lj-space-4);
  font-size: var(--lj-text-lg);
}

.media-youtube__divider {
  margin-bottom: var(--lj-space-5);
}

.media-youtube__link {
  color: var(--lj-info-light);
  text-decoration: none;
}

.media-youtube__link--url {
  font-size: var(--lj-text-lg);
  word-break: break-all;
}
</style>

<!-- Sem `scoped`: o conteúdo do popover vai para um portal no <body> e não
     recebe o atributo de escopo. O isolamento vem do prefixo `media-`. -->
<style>
.media-options {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
  min-width: 220px;
}
</style>
