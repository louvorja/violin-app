<template>
  <footer
    id="footer-bar"
    class="footer"
    :class="{
      'footer--active': hasPlayer || hasBgSound || hasProjection,
      'footer--bg-sound': hasBgSound,
      'footer--bg-only': hasBgSound && !hasPlayer && !hasProjection,
      'footer--fp-only': hasProjection && !hasPlayer && !hasBgSound,
      'footer--playlist': playlist.isActive.value,
    }"
  >
    <BackgroundSoundPlayer v-if="hasBgSound" />
    <FileProjectionBar v-if="hasProjection" />
    <div v-if="playlist.isActive.value" class="playlist-bar">
      <Icon :icon="ICONS.PLAYER.PLAYLIST" :size="14" class="playlist-bar-icon" />
      <span class="playlist-bar-name">{{ playlist.currentPlaylist.value?.name }}</span>
      <span class="playlist-bar-meta">
        {{ playlist.playedCount.value }}/{{ playlist.totalSongs.value }} ·
        {{ formatDuration(playlist.playedDuration.value) }} /
        {{ formatDuration(playlist.totalDuration.value) }}
      </span>
      <div class="playlist-bar-controls">
        <LjTooltip :text="$t('shell.player.prev')">
          <button
            type="button"
            class="player-btn"
            :disabled="playlist.currentIndex.value <= 0"
            :aria-label="$t('shell.player.prev')"
            @click="playlist.playPrev()"
          >
            <Icon :icon="ICONS.PLAYER.PREV" :size="18" />
          </button>
        </LjTooltip>
        <LjTooltip :text="$t('shell.player.next')">
          <button
            type="button"
            class="player-btn"
            :disabled="playlist.currentIndex.value >= playlist.totalSongs.value - 1"
            :aria-label="$t('shell.player.next')"
            @click="playlist.playNext()"
          >
            <Icon :icon="ICONS.PLAYER.NEXT" :size="18" />
          </button>
        </LjTooltip>
        <LjTooltip :text="$t('shell.player.close')">
          <button
            type="button"
            class="player-btn player-btn--danger"
            :aria-label="$t('shell.player.close')"
            @click="playlist.stopPlaylist()"
          >
            <Icon :icon="ICONS.ACTIONS.CLOSE" :size="16" />
          </button>
        </LjTooltip>
      </div>
    </div>
    <div v-if="hasPlayer" class="player">
      <div class="player-title" :class="{ 'player-title--youtube': isYouTube }">
        <Icon
          :icon="isYouTube ? ICONS.MEDIA.YOUTUBE : ICONS.MEDIA.AUDIO"
          :size="14"
          class="player-title-icon"
        />
        <span class="player-title-text lj-u-truncate">
          <template v-if="isYouTube">{{ $t("shell.playing_youtube") }}:</template>
          <template v-else>{{ $t("shell.playing") }}:</template>
          {{ playerTitle }}
        </span>
      </div>

      <div class="player-row">
        <div class="player-controls">
          <LjTooltip v-if="hasSlides" :text="$t('shell.player.first')">
            <button
              type="button"
              class="player-btn"
              :disabled="!canPrev"
              :aria-label="$t('shell.player.first')"
              @click="firstSlide()"
            >
              <Icon :icon="ICONS.PLAYER.PREV" :size="22" />
            </button>
          </LjTooltip>
          <LjTooltip v-if="hasSlides" :text="$t('shell.player.prev')">
            <button
              type="button"
              class="player-btn"
              :disabled="!canPrev"
              :aria-label="$t('shell.player.prev')"
              @click="prevSlide()"
            >
              <Icon :icon="ICONS.ACTIONS.PREVIOUS" :size="22" />
            </button>
          </LjTooltip>
          <LjTooltip v-if="hasAudio" :text="$t('shell.player.rewind')">
            <button
              type="button"
              class="player-btn"
              :aria-label="$t('shell.player.rewind')"
              @click="rewind()"
            >
              <Icon :icon="ICONS.PLAYER.REWIND_10" :size="20" />
            </button>
          </LjTooltip>
          <LjTooltip
            v-if="hasAudio"
            :text="isPaused ? $t('shell.player.play') : $t('shell.player.pause')"
          >
            <button
              type="button"
              class="player-btn player-btn--primary"
              :aria-label="isPaused ? $t('shell.player.play') : $t('shell.player.pause')"
              @click="togglePlay"
            >
              <Icon :icon="isPaused ? ICONS.PLAYER.PLAYER : ICONS.PLAYER.PAUSE_PLAIN" :size="24" />
            </button>
          </LjTooltip>
          <LjTooltip v-if="hasAudio" :text="$t('shell.player.forward')">
            <button
              type="button"
              class="player-btn"
              :aria-label="$t('shell.player.forward')"
              @click="forward()"
            >
              <Icon :icon="ICONS.PLAYER.FORWARD_10" :size="20" />
            </button>
          </LjTooltip>
          <LjTooltip v-if="hasSlides" :text="$t('shell.player.next')">
            <button
              type="button"
              class="player-btn"
              :disabled="!canNext"
              :aria-label="$t('shell.player.next')"
              @click="nextSlide()"
            >
              <Icon :icon="ICONS.ACTIONS.NEXT" :size="22" />
            </button>
          </LjTooltip>
          <LjTooltip v-if="hasSlides" :text="$t('shell.player.last')">
            <button
              type="button"
              class="player-btn"
              :disabled="!canNext"
              :aria-label="$t('shell.player.last')"
              @click="lastSlide()"
            >
              <Icon :icon="ICONS.PLAYER.NEXT" :size="22" />
            </button>
          </LjTooltip>
          <LjDivider vertical />
          <LjTooltip :text="$t('shell.player.close')">
            <button
              type="button"
              class="player-btn player-btn--close"
              :aria-label="$t('shell.player.close')"
              @click="closeMedia()"
            >
              <Icon :icon="ICONS.ACTIONS.CLOSE" :size="20" />
            </button>
          </LjTooltip>
        </div>

        <div v-if="!hasAudio" class="player-slide-text" v-html="slideText" />

        <div class="player-meta">
          <span v-if="hasAudio" class="player-time">
            {{ shortTime(currentTime) }}
            <span class="player-time-sep">/</span>
            {{ shortTime(duration) }}
          </span>
          <LjChip v-if="hasSlides" class="player-counter">
            {{ slideIndex + 1 }} / {{ totalSlides }}
          </LjChip>
          <LjTooltip :text="$t('shell.player.maximize')">
            <button
              type="button"
              class="player-btn player-btn--small"
              :aria-label="$t('shell.player.maximize')"
              @click="maximizeMedia()"
            >
              <Icon :icon="ICONS.UI.OPEN_IN_APP" :size="16" />
            </button>
          </LjTooltip>
          <LjTooltip :text="$t('shell.player.fullscreen')">
            <button
              type="button"
              class="player-btn player-btn--small"
              :aria-label="$t('shell.player.fullscreen')"
              @click="fullscreenMedia()"
            >
              <Icon :icon="ICONS.PLAYER.FULLSCREEN" :size="16" />
            </button>
          </LjTooltip>
        </div>
      </div>

      <div
        class="player-gauge"
        :class="{ 'player-gauge--audio': hasAudio }"
        @click="onTimelineClick"
      >
        <div class="player-gauge-buffer" :style="{ width: bufferPct + '%' }" />
        <div
          class="player-gauge-fill"
          :class="{
            'player-gauge-fill--paused': isPaused,
            'player-gauge-fill--mute': isMute,
          }"
          :style="{ width: progress + '%' }"
        />
      </div>
    </div>
  </footer>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import packageJson from "@root/package.json";
import Modules from "@/helpers/Modules";
import Media from "@/composables/useMedia";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import Database from "@/helpers/Database";
import DateTime from "@/helpers/DateTime";
import BackgroundSoundPlayer from "@/components/BackgroundSoundPlayer.vue";
import FileProjectionBar from "@/components/FileProjectionBar.vue";
import Icon from "@/components/Icon.vue";
import { LjChip, LjDivider, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { useFileProjection } from "@/composables/useFileProjection";
import { usePlaylistPlayback } from "@/modules/musics/composables/usePlaylistPlayback";

const dbVersion = ref(0);

const version = computed(() => `${packageJson.version}.${dbVersion.value}`);
const media = computed(() => Modules.get("media"));

const bg = useBackgroundSound();
const fp = useFileProjection();
const playlist = usePlaylistPlayback();

const hasPlayer = computed(() => {
  try {
    return !!Media.isMinimized();
  } catch (_) {
    return false;
  }
});

const hasBgSound = computed(() => !!bg.currentFile.value);
const hasProjection = computed(() => fp.isProjecting.value);

const hasAudio = computed(() => {
  const url = media.value?.config?.audio;
  const isYT = media.value?.config?.is_youtube;
  const isVF = media.value?.config?.video_file;
  return (typeof url === "string" && url !== "") || !!isYT || !!isVF;
});

const hasSlides = computed(() => {
  if (
    media.value?.config?.is_youtube ||
    media.value?.config?.video_file ||
    media.value?.config?.audio_only
  )
    return false;
  return (Number(media.value?.config?.last_slide) || 0) > 0;
});

const isYouTube = computed(() => !!media.value?.config?.is_youtube);

const isPaused = computed(() => media.value?.config?.is_paused !== false);
const isMute = computed(() => Number(media.value?.config?.volume) <= 0);
const progress = computed(() => Number(media.value?.config?.progress) || 0);
const bufferPct = computed(() => Number(media.value?.config?.buffered) || 0);
const currentTime = computed(() => media.value?.config?.current_time || 0);
const duration = computed(() => media.value?.config?.duration || 0);
const slideIndex = computed(() => media.value?.config?.slide_index ?? 0);
const totalSlides = computed(() => media.value?.config?.last_slide ?? 0);
const canPrev = computed(() => slideIndex.value > 0);
const canNext = computed(() => slideIndex.value < totalSlides.value - 1);

const playerTitle = computed(() => {
  const c = media.value?.config;
  if (!c) return "—";
  let s = c.title || "—";
  if (c.subtitle) s += " · " + c.subtitle;
  if (c.track > 0) s += "  ·  faixa " + c.track;
  return s;
});

const slideText = computed(() => {
  try {
    const slides = Media.slides();
    const slide = slides?.[slideIndex.value];
    if (!slide?.lyric) return "";
    return slide.lyric.replace(/<br>/gi, " / ").toUpperCase();
  } catch (_) {
    return "";
  }
});

const shortTime = (t) => DateTime.shortTime(t);
const formatDuration = (seconds) => DateTime.shortTime(seconds);
const firstSlide = () => Media.firstSlide();
const prevSlide = () => {
  if (playlist.isActive.value) {
    playlist.playPrev();
  } else {
    Media.prevSlide();
  }
};
const rewind = () => Media.advanceTime(-10);
const forward = () => Media.advanceTime(10);
const nextSlide = () => {
  if (playlist.isActive.value) {
    playlist.playNext();
  } else {
    Media.nextSlide();
  }
};
const lastSlide = () => Media.lastSlide();
const closeMedia = () => {
  if (playlist.isActive.value) {
    playlist.stopPlaylist();
  }
  Media.close();
};
const maximizeMedia = () => Media.maximize();
const fullscreenMedia = () => Media.fullscreen(true);

function togglePlay() {
  if (isPaused.value) Media.play();
  else Media.pause();
}

function onTimelineClick(e) {
  if (!duration.value) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const time = duration.value * Math.max(0, Math.min(1, ratio));
  Media.goToTime(time);
}

async function loadDBVersion() {
  try {
    const config = await Database.get("config");
    dbVersion.value = config?.version_number ?? "?";
  } catch (_) {
    dbVersion.value = "?";
  }
}

onMounted(loadDBVersion);
</script>

<style scoped>
.footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--lj-player-height);
  transform: translateY(100%);
  transition:
    transform 0.6s ease,
    height 0.4s ease;
  z-index: 10;
  background: var(--lj-footer-bg);
  border-top: 1px solid var(--lj-footer-border);
  user-select: none;
  font-family: var(--lj-font-shell);
  display: flex;
  flex-direction: column;
}

.footer--bg-sound {
  height: calc(var(--lj-player-height) + 30px);
}

.footer--playlist {
  height: calc(var(--lj-player-height) + 28px);
}

.footer--playlist.footer--bg-sound {
  height: calc(var(--lj-player-height) + 58px);
}

.footer--bg-only {
  height: 30px;
}
.footer--fp-only {
  height: 36px;
}

.footer--active {
  transform: translateY(0);
  transition: transform 0.3s ease; /* entrada: 0.3s (rápida) */
}

/* Playlist bar */
.playlist-bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: 28px;
  padding: 0 var(--lj-space-4);
  background: var(--lj-tabs-bg);
  border-bottom: 1px solid var(--lj-footer-border);
  font-size: var(--lj-text-xs);
  color: var(--lj-text-on-navy);
  flex-shrink: 0;
}

.playlist-bar-icon {
  opacity: 0.85;
  flex-shrink: 0;
}

.playlist-bar-name {
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.playlist-bar-meta {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  margin-left: auto;
}

.playlist-bar-controls {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  margin-left: var(--lj-space-2);
}

/* Player */
.player {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.player-title {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: var(--lj-player-title-height);
  padding: 0 var(--lj-space-5);
  background: var(--lj-tabs-bg);
  color: var(--lj-text-on-navy);
  border-bottom: 1px solid var(--lj-footer-border);
  font-size: var(--lj-text-sm);
  flex-shrink: 0;
  font-weight: var(--lj-weight-medium);
}

.player-title-icon {
  opacity: 0.85;
  flex-shrink: 0;
}

.player-title-text {
  letter-spacing: 0.02em;
}

/* O vermelho do YouTube é identidade externa: não varia com o tema, por isso
   tem token próprio em vez de sair da paleta funcional. O ícone herda a cor
   do container (currentColor), sem prop de cor no Icon. */
.player-title--youtube {
  background: var(--lj-player-youtube-bg);
  color: var(--lj-white);
}

.player-title--youtube .player-title-icon {
  opacity: 1;
}

.player-row {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 var(--lj-space-4);
  gap: var(--lj-space-5);
  overflow: hidden;
}

.player-controls {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  flex-shrink: 0;
}

/* Botão de transporte: dimensão fixa herdada do Delphi (36x38), fora da escala
   sm/md/lg dos primitivos — por isso segue markup próprio. Traço, raio, foco e
   opacidade de desabilitado vêm dos contratos de `ui.css`. */
.player-btn {
  width: var(--lj-player-btn-width);
  height: var(--lj-player-btn-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--lj-text);
  cursor: pointer;
  border-radius: var(--lj-ui-radius);
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
  outline: none;
  font-family: inherit;
}

.player-btn:hover:not(:disabled) {
  background: var(--lj-hover-bg);
  border-color: var(--lj-surface-border-strong);
}

.player-btn:focus-visible {
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.player-btn:disabled {
  opacity: var(--lj-ui-disabled-opacity);
  cursor: not-allowed;
}

.player-btn--primary {
  width: var(--lj-player-btn-primary-width);
  background: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
  border-color: var(--lj-ui-accent-press);
}

.player-btn--primary:hover:not(:disabled) {
  background: var(--lj-ui-accent-hover);
  border-color: var(--lj-ui-accent-hover);
}

.player-btn--close {
  color: var(--lj-danger-dark);
}
.player-btn--close:hover {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger-border);
  color: var(--lj-danger);
}

.player-btn--small {
  width: 28px;
  height: 28px;
}

/* LjDivider vertical estica por padrão; aqui ele é um traço curto entre os
   grupos de botões, com a altura original de 24px. */
.player-controls :deep(.lj-divider--vertical) {
  align-self: center;
  height: 24px;
  min-height: 0;
  margin: 0 var(--lj-space-3);
}

.player-slide-text {
  flex: 1;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.04em;
  color: var(--lj-player-slide-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  font-family: var(--lj-font-projection);
  text-transform: uppercase;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
}

.player-time {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
  font-weight: var(--lj-weight-medium);
}

.player-time-sep {
  margin: 0 var(--lj-space-2);
  opacity: 0.5;
}

/* Contador de slides: o LjChip dá a superfície e o traço; o tamanho de fonte e
   a largura mínima são mantidos para o número não encolher durante o culto. */
.player-meta :deep(.player-counter) {
  min-width: 50px;
  justify-content: center;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
  font-variant-numeric: tabular-nums;
}

/* Timeline gauge */
.player-gauge {
  height: var(--lj-player-gauge-height);
  position: relative;
  background: var(--lj-player-gauge-bg);
  border-top: 1px solid var(--lj-footer-border);
  cursor: default;
  overflow: hidden;
  flex-shrink: 0;
}

.player-gauge--audio {
  cursor: pointer;
}

.player-gauge-buffer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: var(--lj-player-gauge-buffer-bg);
  transition: width 0.3s linear;
}

.player-gauge-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(180deg, var(--lj-ui-accent), var(--lj-ui-accent-press));
  transition: width 0.1s linear;
  box-shadow: 0 0 8px var(--lj-gold-alpha-60);
}

.player-gauge-fill--paused {
  background: linear-gradient(180deg, var(--lj-ui-accent-hover), var(--lj-ui-accent));
  box-shadow: none;
  transition: width 0.1s linear;
}

.player-gauge-fill--mute {
  background: linear-gradient(180deg, var(--lj-danger), var(--lj-danger-dark));
  box-shadow: none;
}
</style>
