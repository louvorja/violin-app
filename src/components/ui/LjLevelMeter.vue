<template>
  <div
    class="lj-level-meter"
    :class="`lj-level-meter--${orientation}`"
    role="meter"
    :aria-label="ariaLabel"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="loudest"
    :aria-orientation="orientation"
    :style="{ '--lj-level-meter-t': `${thickness}px` }"
  >
    <div
      v-for="(level, i) in clampedLevels"
      :key="i"
      class="lj-level-meter__channel"
      :class="{ 'lj-level-meter__channel--off': disabled }"
    >
      <div class="lj-level-meter__cover" :style="{ [extent]: `${100 - level}%` }" />
      <div
        v-if="clampedPeaks[i] > 0 && !disabled"
        class="lj-level-meter__peak"
        :style="{ [edge]: `${clampedPeaks[i]}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

/**
 * Medidor de nível de áudio, como o de uma mesa de som: uma barra por canal,
 * verde até o volume confortável, amarela perto do limite e vermelha no
 * topo, com o pico recente marcado. Só desenha — quem mede é quem o usa,
 * com valores de 0 a 1 já na escala que quer mostrar (tipicamente dB).
 *
 * Na vertical, os canais ficam lado a lado e enchem de baixo para cima: é o
 * jeito de encostar o medidor numa prévia de tela, como no FreeShow.
 */

const props = withDefaults(
  defineProps<{
    /** Um valor por canal, de 0 a 1. */
    levels?: number[];
    /** Pico recente de cada canal, de 0 a 1 (opcional). */
    peaks?: number[];
    /** Sem fonte de som: as barras ficam apagadas. */
    disabled?: boolean;
    orientation?: "horizontal" | "vertical";
    /** Espessura de cada canal, em px. */
    thickness?: number;
    ariaLabel?: string;
  }>(),
  { levels: () => [0], peaks: () => [], orientation: "horizontal", thickness: 4 }
);

const pct = (v: number | undefined): number =>
  Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? (v as number) : 0)) * 100);

const clampedLevels = computed(() => props.levels.map((v) => (props.disabled ? 0 : pct(v))));
const clampedPeaks = computed(() => props.levels.map((_, i) => pct(props.peaks[i])));
const loudest = computed(() => Math.max(0, ...clampedLevels.value));

const vertical = computed(() => props.orientation === "vertical");
/** A medida da parte apagada e o lado de onde o pico é medido. */
const extent = computed(() => (vertical.value ? "height" : "width"));
const edge = computed(() => (vertical.value ? "bottom" : "left"));
</script>

<style scoped>
.lj-level-meter {
  display: flex;
  gap: 2px;
}

.lj-level-meter--horizontal {
  flex-direction: column;
  width: 100%;
}

.lj-level-meter--vertical {
  flex-direction: row;
  height: 100%;
}

.lj-level-meter__channel {
  position: relative;
  overflow: hidden;
  border-radius: var(--lj-radius-pill);
  --lj-level-meter-scale:
    var(--lj-success) 0%, var(--lj-success) 70%, var(--lj-warning) 85%, var(--lj-danger) 100%;
}

.lj-level-meter--horizontal .lj-level-meter__channel {
  height: var(--lj-level-meter-t);
  background: linear-gradient(to right, var(--lj-level-meter-scale));
}

.lj-level-meter--vertical .lj-level-meter__channel {
  width: var(--lj-level-meter-t);
  height: 100%;
  background: linear-gradient(to top, var(--lj-level-meter-scale));
}

.lj-level-meter__channel--off {
  opacity: 0.35;
}

/* Cobre a parte apagada da escala, do topo dela para o começo. */
.lj-level-meter__cover {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--lj-surface-bg-active);
}

.lj-level-meter--horizontal .lj-level-meter__cover {
  bottom: 0;
}

.lj-level-meter--vertical .lj-level-meter__cover {
  left: 0;
}

.lj-level-meter__peak {
  position: absolute;
  background: var(--lj-text);
}

.lj-level-meter--horizontal .lj-level-meter__peak {
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -2px;
}

.lj-level-meter--vertical .lj-level-meter__peak {
  left: 0;
  right: 0;
  height: 2px;
  margin-bottom: -2px;
}
</style>
