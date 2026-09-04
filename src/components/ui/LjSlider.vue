<template>
  <div class="lj-slider-wrap">
    <SliderRoot
      v-model="model"
      class="lj-slider"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
    >
      <SliderTrack class="lj-slider__track">
        <SliderRange class="lj-slider__range" />
      </SliderTrack>
      <SliderThumb
        :id="resolvedId"
        class="lj-slider__thumb"
        :aria-label="ariaLabel"
        :aria-describedby="describedBy"
      />
    </SliderRoot>
    <span v-if="showValue" class="lj-slider__value">{{ clamped }}{{ unit }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useFieldContext } from "./fieldContext";
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";

const props = withDefaults(
  defineProps<{
    modelValue?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    showValue?: boolean;
    unit?: string;
    ariaLabel?: string;
    id?: string;
  }>(),
  { modelValue: 0, min: 0, max: 100, step: 1, unit: "" }
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const field = useFieldContext();
const resolvedId = computed(() => props.id ?? field?.inputId.value);
const describedBy = computed(() => field?.describedById.value);

// Reka trabalha com array (suporta múltiplos thumbs); aqui só há um.
//
// O valor é limitado à faixa na leitura: uma preferência gravada quando o
// máximo era outro faria o thumb anunciar aria-valuenow fora de aria-valuemax,
// e a tela mostraria um número que o controle não aceita.
const clamped = computed(() => Math.min(props.max, Math.max(props.min, props.modelValue)));

const model = computed({
  get: () => [clamped.value],
  set: (value: number[]) => emit("update:modelValue", value[0]),
});
</script>

<style scoped>
.lj-slider-wrap {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  width: 100%;
}

.lj-slider {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  height: var(--lj-ui-h-md);
  touch-action: none;
  user-select: none;
}

.lj-slider[data-disabled] {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

.lj-slider__track {
  position: relative;
  flex: 1;
  height: 4px;
  background: var(--lj-surface-bg-active);
  border-radius: 999px;
}

.lj-slider__range {
  position: absolute;
  height: 100%;
  background: var(--lj-ui-accent);
  border-radius: inherit;
}

.lj-slider__thumb {
  display: block;
  width: 13px;
  height: 13px;
  background: var(--lj-surface-bg);
  border: 2px solid var(--lj-ui-accent);
  border-radius: 50%;
  box-shadow: var(--lj-shadow-1);
  outline: none;
  cursor: grab;
}

.lj-slider__thumb:focus-visible {
  box-shadow: var(--lj-ui-focus);
}

.lj-slider__thumb:active {
  cursor: grabbing;
}

.lj-slider__value {
  min-width: 40px;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
