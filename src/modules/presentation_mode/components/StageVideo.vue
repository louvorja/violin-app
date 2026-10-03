<template>
  <div class="pm-video" data-testid="pm-stage-video">
    <div class="pm-video__stage">
      <!-- Áudio não vai para as saídas: o palco mostra só o que está tocando. -->
      <div
        v-if="audioTitle !== undefined"
        class="pm-video__frame pm-video__audio"
        data-testid="pm-stage-audio"
      >
        <LjIcon :icon="ICONS.MUSIC.AUDIO" :size="48" />
        <span class="pm-video__audio-title">{{ audioTitle }}</span>
        <span class="pm-video__audio-hint">{{ tm("video.audio_only") }}</span>
      </div>
      <div v-else class="pm-video__frame"><LiveMirror :cleared="false" /></div>
    </div>

    <footer class="pm-video__bar">
      <LjButton
        variant="primary"
        icon-only
        class="pm-video__play"
        :icon="audio.isPaused.value ? ICONS.PLAYER.PLAY : ICONS.PLAYER.PAUSE"
        :title="audio.isPaused.value ? tm('stage.play') : tm('stage.pause')"
        :disabled="locked"
        data-testid="pm-video-play"
        @click="togglePlay"
      />
      <LjButton
        icon-only
        :icon="ICONS.PLAYER.REWIND_10"
        :title="tm('video.back_10')"
        :disabled="locked"
        data-testid="pm-video-back"
        @click="Media.advanceTime(-10)"
      />
      <LjButton
        icon-only
        :icon="ICONS.PLAYER.FORWARD_10"
        :title="tm('video.forward_10')"
        :disabled="locked"
        data-testid="pm-video-forward"
        @click="Media.advanceTime(10)"
      />
      <span class="pm-video__time" data-testid="pm-video-current">
        {{ DateTime.shortTime(shownTime) }}
      </span>

      <div
        class="pm-video__timeline"
        :class="{ 'pm-video__timeline--disabled': locked || !duration }"
        role="slider"
        tabindex="0"
        :aria-label="tm('video.timeline')"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(duration)"
        :aria-valuenow="Math.round(shownTime)"
        :aria-valuetext="DateTime.shortTime(shownTime)"
        data-testid="pm-video-timeline"
        @pointerdown="startSeek"
        @keydown.left.prevent="!locked && Media.advanceTime(-5)"
        @keydown.right.prevent="!locked && Media.advanceTime(5)"
      >
        <span class="pm-video__buffer" :style="{ width: `${audio.buffered.value}%` }" />
        <span class="pm-video__progress" :style="{ width: `${shownPercent}%` }" />
        <span class="pm-video__thumb" :style="{ left: `${shownPercent}%` }" />
      </div>

      <span class="pm-video__time">{{ DateTime.shortTime(duration) }}</span>
      <span
        v-if="duration"
        class="pm-video__remaining"
        :title="tm('video.remaining_title')"
        data-testid="pm-video-remaining"
      >
        −{{ DateTime.shortTime(remaining) }}
        <span class="pm-video__ends">{{ tm("video.ends_at", { time: endsAt }) }}</span>
      </span>

      <div class="pm-video__volume">
        <LjIcon :icon="volumeIcon" :size="16" class="pm-video__volume-icon" />
        <LjSlider
          :model-value="muted ? 0 : audio.volume.value"
          :min="0"
          :max="100"
          :aria-label="tm('video.volume')"
          :disabled="muted"
          @update:model-value="(v: number) => Media.setVolume(v)"
        />
      </div>
      <LjButton
        icon-only
        :variant="muted ? 'danger' : 'default'"
        :icon="ICONS.PLAYER.VOLUME_MUTE"
        :title="muted ? tm('video.unmute') : tm('video.mute')"
        :aria-pressed="muted"
        data-testid="pm-video-mute"
        @click="toggleMute"
      />
      <LjButton
        icon-only
        variant="danger"
        :icon="ICONS.PLAYER.STOP"
        :title="tm('video.stop')"
        :disabled="locked"
        data-testid="pm-video-stop"
        @click="stop"
      />
    </footer>
  </div>
</template>

<script setup lang="ts">
import DateTime from "@/helpers/DateTime";
import { computed, onBeforeUnmount, ref } from "vue";
import { LjButton, LjIcon, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Media from "@/composables/useMedia";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import { useModuleI18n } from "@/composables/useModuleI18n";
import LiveMirror from "./LiveMirror.vue";
import { usePlayerMute } from "../composables/usePlayerMute";

/**
 * Palco do vídeo no ar: a imagem é o espelho mudo da tela principal, e a
 * barra comanda o player da janela do operador — de onde sai o som. O mesmo
 * player serve ao áudio, que não tem imagem nem vai para as saídas.
 */

const props = defineProps<{
  locked: boolean;
  /** Com título, o player toca áudio: sem imagem, nada nas saídas. */
  audioTitle?: string;
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const audio = useAudioPlayback();

const duration = computed(() =>
  Number.isFinite(audio.duration.value) && audio.duration.value > 0 ? audio.duration.value : 0
);

/* Arrastar na linha do tempo mostra o ponto sob o dedo; o player só busca ao soltar. */
const scrubTime = ref<number | null>(null);
const shownTime = computed(() => scrubTime.value ?? audio.currentTime.value);
/* Quanto falta e a que horas acaba — o relógio anda mesmo com o vídeo pausado. */
const remaining = computed(() => Math.max(0, duration.value - shownTime.value));
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));
const endsAt = computed(() =>
  new Date(now.value + remaining.value * 1000).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
  })
);
const shownPercent = computed(() =>
  duration.value ? Math.min(100, (shownTime.value / duration.value) * 100) : 0
);

function timeAt(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration.value;
}

function startSeek(event: PointerEvent): void {
  if (props.locked || !duration.value) return;
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture(event.pointerId);
  scrubTime.value = timeAt(el, event.clientX);
  const move = (e: PointerEvent) => (scrubTime.value = timeAt(el, e.clientX));
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    if (scrubTime.value !== null) Media.goToTime(scrubTime.value);
    scrubTime.value = null;
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function togglePlay(): void {
  if (audio.isPaused.value) Media.play();
  else Media.pause(true);
}

/* O mudo é do módulo: o "Reproduzir sem áudio" liga o mesmo. */
const playerMute = usePlayerMute();
const muted = playerMute.muted;
const toggleMute = playerMute.toggle;

const volumeIcon = computed(() => {
  const v = muted.value ? 0 : audio.volume.value;
  if (v === 0) return ICONS.PLAYER.VOLUME_MUTE;
  return v < 50 ? ICONS.PLAYER.VOLUME_LOW : ICONS.PLAYER.VOLUME_HIGH;
});

/** Parar encerra o vídeo, mas as janelas de projeção seguem abertas para o próximo item. */
function stop(): void {
  playerMute.unmute();
  Media.close(true, false, true);
}
</script>

<style scoped>
.pm-video {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-video__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  container-type: size;
}

.pm-video__frame {
  width: min(100cqw, calc(100cqh * 16 / 9));
}

.pm-video__audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  aspect-ratio: 16 / 9;
  border: 1px dashed var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  color: var(--lj-white-alpha-50);
  text-align: center;
}

.pm-video__audio-title {
  max-width: 90%;
  font-size: 18px;
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-white);
  overflow-wrap: anywhere;
}

.pm-video__audio-hint {
  font-size: 11px;
}

.pm-video__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 52px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 1px solid var(--lj-surface-border);
  color: var(--lj-text);
}

.pm-video__bar > * {
  flex-shrink: 0;
}

.pm-video__play {
  width: var(--lj-player-btn-primary-width);
}

.pm-video__time {
  min-width: 30px;
  font-family: var(--lj-font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text-muted);
  text-align: center;
}

.pm-video__remaining {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.15;
  font-family: var(--lj-font-mono);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text);
  white-space: nowrap;
}

.pm-video__ends {
  font-size: 10px;
  font-weight: 400;
  color: var(--lj-text-muted);
}

/* A linha do tempo é o que encolhe primeiro quando o palco estreita. */
.pm-video__timeline {
  position: relative;
  flex: 1 1 auto;
  flex-shrink: 1;
  min-width: 40px;
  height: 8px;
  border-radius: 4px;
  background: var(--lj-surface-border);
  cursor: pointer;
  touch-action: none;
}

.pm-video__timeline:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-video__timeline--disabled {
  cursor: default;
  opacity: 0.6;
}

.pm-video__buffer,
.pm-video__progress {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
}

.pm-video__buffer {
  background: var(--lj-surface-border-strong);
}

.pm-video__progress {
  background: var(--lj-navy-active);
}

.pm-video__thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--lj-white);
  box-shadow: 0 0 0 1px var(--lj-black-alpha-30);
  transform: translate(-50%, -50%);
}

.pm-video__volume {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 1 110px;
  flex-shrink: 1;
  min-width: 22px;
  overflow: hidden;
}

.pm-video__volume-icon {
  flex-shrink: 0;
  color: var(--lj-text-muted);
}

.pm-video__volume :deep(.lj-slider) {
  flex: 1;
  min-width: 0;
}
</style>
