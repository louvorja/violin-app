<template>
  <div class="player-progress">
    <span class="lj-u-caption">
      {{ shortTime(currentTime) }}
    </span>
    <div
      class="player-progress__bar"
      :class="barClass"
      :style="{ '--player-progress-buffer': `${buffered}%` }"
      @click="onClick"
    >
      <LjProgress :value="progress" :indeterminate="loading" :height="10" />
    </div>
    <span class="lj-u-caption">
      {{ shortTime(duration) }}
    </span>
    <span v-if="lastSlide > 0" class="player-progress__slides lj-u-caption lj-u-muted">
      {{ slideIndex + 1 }}/{{ lastSlide }}
    </span>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { LjProgress } from "@/components/ui";
import DateTime from "@/helpers/DateTime";

const props = defineProps({
  progress: { type: Number, default: 0 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  buffered: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  isPaused: { type: Boolean, default: false },
  volume: { type: Number, default: 100 },
  slideIndex: { type: Number, default: 0 },
  lastSlide: { type: Number, default: 0 },
});

const emit = defineEmits(["seek"]);

function onClick(e) {
  const el = e.currentTarget;
  if (!el) return; // Quando o áudio é de alguma música do programa
  // Quando é de algum arquivo externo segue a lógica
  const { left, width } = el.getBoundingClientRect();
  const pct = Math.round(((e.clientX - left) / width) * 100);
  emit("seek", Math.max(0, Math.min(pct, 100)));
}

// Pausa vence volume zero: uma música pausada e sem som mostra que está pausada.
const barClass = computed(() => {
  if (props.isPaused) return "player-progress__bar--paused";
  if (props.volume <= 0) return "player-progress__bar--mute";
  return "player-progress__bar--playing";
});

const shortTime = (t) => DateTime.shortTime(t);
</script>

<style scoped>
.player-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-2) var(--lj-space-5);
}

.player-progress__bar {
  flex-grow: 1;
  cursor: pointer;
}

.player-progress__slides {
  white-space: nowrap;
}

/* Cor por estado, lida tanto pela barra quanto pelo trecho carregado. */
.player-progress__bar--playing {
  --player-progress-color: var(--lj-ui-accent);
}

.player-progress__bar--paused {
  --player-progress-color: var(--lj-warning);
}

.player-progress__bar--mute {
  --player-progress-color: var(--lj-danger);
}

.player-progress__bar :deep(.lj-progress__bar) {
  background: var(--player-progress-color);
}

/* O trecho já baixado entra como parada de gradiente na trilha: o primitivo não
   tem camada de buffer, e o operador precisa enxergar quanto do áudio chegou
   antes de arrastar a reprodução para frente. A mistura com a própria trilha
   mantém o trecho sempre entre ela e a barra — com uma cor translúcida ele
   ficaria mais escuro que a trilha nos temas escuros, e leria como buraco. */
.player-progress__bar :deep(.lj-progress__track) {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--player-progress-color) 30%, var(--lj-surface-bg-active))
      var(--player-progress-buffer, 0%),
    var(--lj-surface-bg-active) var(--player-progress-buffer, 0%)
  );
}
</style>
