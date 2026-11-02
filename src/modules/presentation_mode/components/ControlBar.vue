<template>
  <footer class="pm-ctl" data-testid="pm-control-bar">
    <!-- 1 · Partes + reproduzir: sempre nos mesmos lugares; sem partes, apagados. -->
    <div class="pm-ctl__group">
      <LjButton
        icon-only
        :icon="ICONS.PLAYER.PAGE_FIRST"
        :title="tm('control.first')"
        :disabled="!canNavigate || atStart"
        data-testid="pm-ctl-first"
        @click="emit('navigate', 'first')"
      />
      <LjButton
        icon-only
        :icon="ICONS.ACTIONS.PREVIOUS"
        :title="tm('control.previous')"
        :disabled="!canNavigate || atStart"
        data-testid="pm-ctl-prev"
        @click="emit('navigate', 'prev')"
      />
      <LjButton
        variant="primary"
        icon-only
        :icon="transport.playing.value ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
        :title="playTitle"
        :aria-pressed="transport.playing.value"
        :disabled="!transport.canPlay.value"
        data-testid="pm-ctl-play"
        @click="transport.togglePlay()"
      />
      <LjButton
        icon-only
        :icon="ICONS.ACTIONS.NEXT"
        :title="tm('control.next')"
        :disabled="!canNavigate || atEnd"
        data-testid="pm-ctl-next"
        @click="emit('navigate', 'next')"
      />
      <LjButton
        icon-only
        :icon="ICONS.PLAYER.PAGE_LAST"
        :title="tm('control.last')"
        :disabled="!canNavigate || atEnd"
        data-testid="pm-ctl-last"
        @click="emit('navigate', 'last')"
      />
    </div>

    <!-- 2 · Posição -->
    <div class="pm-ctl__pos">
      <span class="pm-ctl__cap">{{ posCap }}</span>
      <span class="pm-ctl__mono pm-ctl__big" data-testid="pm-ctl-position">{{ posValue }}</span>
    </div>

    <!-- 3 · Linha: as partes, ou o tempo com −10s/+10s -->
    <div class="pm-ctl__line">
      <div v-if="position" class="pm-ctl__segs" data-testid="pm-ctl-segments">
        <span
          v-for="i in segmentCount"
          :key="i"
          class="pm-ctl__seg"
          :class="{
            'pm-ctl__seg--done': i - 1 < segmentIndex,
            'pm-ctl__seg--cur': i - 1 === segmentIndex,
          }"
        />
      </div>
      <div v-else-if="transport.timed.value" class="pm-ctl__time">
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.PLAYER.REWIND_10"
          :title="tm('video.back_10')"
          :disabled="locked"
          data-testid="pm-ctl-back"
          @click="transport.seekBy(-10)"
        />
        <div
          class="pm-ctl__track"
          :class="{ 'pm-ctl__track--disabled': locked || !transport.duration.value }"
          role="slider"
          tabindex="0"
          :aria-label="tm('video.timeline')"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(transport.duration.value)"
          :aria-valuenow="Math.round(shownTime)"
          :aria-valuetext="DateTime.shortTime(shownTime)"
          data-testid="pm-ctl-timeline"
          @pointerdown="startSeek"
          @keydown.left.prevent.stop="transport.seekBy(-5)"
          @keydown.right.prevent.stop="transport.seekBy(5)"
        >
          <span class="pm-ctl__fill" :style="{ width: `${timePercent}%` }" />
        </div>
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.PLAYER.FORWARD_10"
          :title="tm('video.forward_10')"
          :disabled="locked"
          data-testid="pm-ctl-forward"
          @click="transport.seekBy(10)"
        />
      </div>
      <div v-else class="pm-ctl__segs pm-ctl__segs--empty" />
      <span
        class="pm-ctl__note"
        :class="{ 'pm-ctl__note--end': endNote }"
        data-testid="pm-ctl-note"
      >
        {{ endNote || note }}
      </span>
    </div>

    <!-- 4 · Restante (com tempo) ou há quanto está no ar -->
    <div class="pm-ctl__rem">
      <template v-if="transport.timed.value && transport.duration.value">
        <span class="pm-ctl__mono pm-ctl__big" data-testid="pm-ctl-remaining">
          −{{ DateTime.shortTime(remaining) }}
        </span>
        <span class="pm-ctl__sub">{{ tm("video.ends_at", { time: endsAt }) }}</span>
      </template>
      <template v-else-if="onAir">
        <span class="pm-ctl__mono pm-ctl__big" data-testid="pm-ctl-elapsed">
          {{ DateTime.shortTime(elapsed) }}
        </span>
        <span class="pm-ctl__sub">{{ tm("control.on_air_for") }}</span>
      </template>
    </div>

    <!-- 5 · Áudio -->
    <div class="pm-ctl__audio">
      <LjButton
        icon-only
        :variant="transport.muted.value ? 'danger' : 'default'"
        :icon="volumeIcon"
        :title="transport.muted.value ? tm('video.unmute') : tm('video.mute')"
        :aria-pressed="transport.muted.value"
        :disabled="!transport.hasAudio.value"
        data-testid="pm-ctl-mute"
        @click="transport.toggleMute()"
      />
      <LjSlider
        class="pm-ctl__volume"
        :model-value="transport.muted.value ? 0 : transport.volume.value"
        :min="0"
        :max="100"
        :aria-label="tm('video.volume')"
        :disabled="!transport.hasAudio.value || transport.muted.value"
        @update:model-value="(v: number) => transport.setVolume(v)"
      />
    </div>

    <!-- 6 · Tirar do ar -->
    <LjButton
      class="pm-ctl__off"
      variant="danger"
      :icon="ICONS.PLAYER.STOP_CIRCLE"
      :title="tm('outputs.take_off_title')"
      :disabled="!canTakeOff"
      data-testid="pm-ctl-take-off"
      @click="emit('take-off')"
    >
      {{ tm("control.take_off") }}
    </LjButton>
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import DateTime from "@/helpers/DateTime";
import { LjButton, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { LiveKind } from "../composables/useLiveContent";
import type { PartPosition, Step } from "../composables/useLiveNavigation";
import { AUTO_ADVANCE_MS, type useLiveTransport } from "../composables/useLiveTransport";

/**
 * A barra única do centro: cada controle sempre no mesmo lugar, para toda
 * mídia. O que muda por tipo é só o que está aceso e o texto da posição. Ela
 * controla sempre o que está NO AR, nunca a prévia.
 */

const props = defineProps<{
  transport: ReturnType<typeof useLiveTransport>;
  liveKind: LiveKind | null;
  audioLive: boolean;
  /** Título do que está no ar (para a nota da linha). */
  liveTitle: string;
  position: PartPosition | null;
  canNavigate: boolean;
  locked: boolean;
  canTakeOff: boolean;
  /** O próximo item do programa: na última parte, a barra lembra que o Enter o envia. */
  upNextTitle: string | null;
}>();

const emit = defineEmits<{ navigate: [to: Step]; "take-off": [] }>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const onAir = computed(() => !!props.liveKind || props.audioLive);
const atStart = computed(() => !!props.position && props.position.index <= 0);
const atEnd = computed(() => !!props.position && props.position.index >= props.position.total - 1);

/** Muitas partes viram uma linha contínua: os segmentos deixariam de ser legíveis. */
const MAX_SEGMENTS = 60;
const segmentCount = computed(() => Math.min(props.position?.total ?? 0, MAX_SEGMENTS));
const segmentIndex = computed(() => {
  const p = props.position;
  if (!p) return -1;
  return p.total > MAX_SEGMENTS ? Math.floor((p.index / p.total) * MAX_SEGMENTS) : p.index;
});

const posCap = computed(() => {
  if (props.position) return tm(`control.unit.${props.position.unit}`);
  // Só a música no ar; com uma foto por cima, a barra é da foto.
  if (props.audioLive && !props.liveKind) return tm("control.unit.audio");
  switch (props.liveKind) {
    case "music":
      return tm("control.unit.slide");
    case "bible":
      return tm("control.unit.verse");
    case "online_video":
      return tm("control.unit.video");
    case "announcements":
      return tm("control.unit.announcement");
    case "file":
      return props.transport.isVideo.value ? tm("control.unit.video") : tm("control.unit.image");
    default:
      // Nada no ar: a nota da linha já diz; a posição fica vazia.
      return "";
  }
});

const posValue = computed(() => {
  const p = props.position;
  if (p) return `${p.index + 1} / ${p.total}`;
  if (props.transport.timed.value) return DateTime.shortTime(props.transport.currentTime.value);
  if (props.liveKind === "file") return "1 / 1";
  return onAir.value ? "—" : "";
});

/* Arrastar na linha mostra o ponto sob o dedo; o player só busca ao soltar. */
const scrubTime = ref<number | null>(null);
const shownTime = computed(() => scrubTime.value ?? props.transport.currentTime.value);
const timePercent = computed(() => {
  const d = props.transport.duration.value;
  return d ? Math.min(100, (shownTime.value / d) * 100) : 0;
});

function timeAt(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * props.transport.duration.value;
}

function startSeek(event: PointerEvent): void {
  if (props.locked || !props.transport.duration.value) return;
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture(event.pointerId);
  scrubTime.value = timeAt(el, event.clientX);
  const move = (e: PointerEvent) => (scrubTime.value = timeAt(el, e.clientX));
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    if (scrubTime.value !== null) props.transport.seekTo(scrubTime.value);
    scrubTime.value = null;
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/* O relógio anda mesmo com a mídia pausada: "acaba às" e "no ar há". */
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));

const remaining = computed(() =>
  Math.max(0, props.transport.duration.value - props.transport.currentTime.value)
);
const endsAt = computed(() =>
  new Date(now.value + remaining.value * 1000).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
  })
);

/** Quando o que está no ar entrou: troca de conteúdo zera; trocar de parte, não. */
const since = ref<number | null>(null);
watch(
  () => (onAir.value ? `${props.liveKind}|${props.liveTitle}` : null),
  (key) => (since.value = key ? Date.now() : null),
  { immediate: true }
);
const elapsed = computed(() => (since.value ? Math.max(0, (now.value - since.value) / 1000) : 0));

const playTitle = computed(() => {
  const t = props.transport;
  if (t.timed.value) return t.playing.value ? tm("stage.pause") : tm("stage.play");
  if (t.canAutoAdvance.value)
    return t.playing.value ? tm("control.auto_stop") : tm("control.auto_start");
  return tm("control.no_play");
});

const note = computed(() => {
  const t = props.transport;
  const time = `${DateTime.shortTime(t.currentTime.value)} / ${DateTime.shortTime(t.duration.value)}`;
  if (!onAir.value) return tm("control.nothing");
  if (props.audioLive && !props.liveKind) return tm("control.audio_note", { time });
  if (t.timed.value && props.position) return `${props.liveTitle} · ${time}`;
  if (t.autoAdvancing.value)
    return `${props.liveTitle} · ${tm("control.auto_on", { s: AUTO_ADVANCE_MS / 1000 })}`;
  return props.liveTitle;
});

/** Na última parte o passador não pula de item: a barra só avisa. */
const endNote = computed(() =>
  atEnd.value && props.position && props.position.total > 1 && props.upNextTitle
    ? tm("control.end_note", { title: props.upNextTitle })
    : ""
);

const volumeIcon = computed(() => {
  const t = props.transport;
  const v = t.muted.value ? 0 : t.volume.value;
  if (v === 0) return ICONS.PLAYER.VOLUME_MUTE;
  return v < 50 ? ICONS.PLAYER.VOLUME_LOW : ICONS.PLAYER.VOLUME_HIGH;
});
</script>

<style scoped>
.pm-ctl {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 10px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 1px solid var(--lj-surface-border);
  color: var(--lj-text);
}

.pm-ctl__group {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.pm-ctl__pos {
  display: flex;
  flex-direction: column;
  width: 76px;
  flex-shrink: 0;
  line-height: 1.1;
}

.pm-ctl__cap {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
}

.pm-ctl__mono {
  font-family: var(--lj-font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pm-ctl__big {
  font-size: 15px;
  font-weight: 700;
}

/* A linha é o que encolhe primeiro quando o palco estreita. */
.pm-ctl__line {
  flex: 1;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pm-ctl__segs {
  display: flex;
  gap: 2px;
  height: 8px;
}

.pm-ctl__seg {
  flex: 1;
  border-radius: 2px;
  background: var(--lj-white-alpha-10);
}

.pm-ctl__seg--done {
  background: var(--lj-live-select);
}

.pm-ctl__seg--cur {
  background: var(--lj-orange);
}

.pm-ctl__time {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  margin: -7px 0;
}

.pm-ctl__track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--lj-white-alpha-10);
  cursor: pointer;
  touch-action: none;
}

.pm-ctl__track:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-ctl__track--disabled {
  cursor: default;
  opacity: 0.6;
}

.pm-ctl__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
  background: var(--lj-orange);
}

.pm-ctl__note {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-ctl__note--end {
  color: var(--lj-orange);
  font-weight: 600;
}

.pm-ctl__rem {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  width: 84px;
  flex-shrink: 0;
  line-height: 1.15;
}

.pm-ctl__sub {
  font-size: 10px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
}

.pm-ctl__audio {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 130px;
  min-width: 34px;
}

.pm-ctl__volume {
  flex: 1;
  min-width: 0;
}

.pm-ctl__off {
  flex-shrink: 0;
}
</style>
