<template>
  <div class="lj-color-picker" :class="{ 'lj-color-picker--disabled': disabled }">
    <ColorSwatchPickerRoot
      class="lj-color-picker__presets"
      :model-value="presetSelecionado"
      :disabled="disabled"
      orientation="horizontal"
      :aria-label="ariaLabel"
      @update:model-value="atualizar"
    >
      <ColorSwatchPickerItem
        v-for="cor in presetsNormalizados"
        :key="cor"
        :value="cor"
        class="lj-color-picker__item"
        :class="{ 'is-active': cor === corNormalizada }"
      >
        <ColorSwatchPickerItemSwatch class="lj-color-picker__swatch" />
        <ColorSwatchPickerItemIndicator class="lj-color-picker__check">
          <LjIcon :icon="ICONS.UI.CHECK" :size="12" />
        </ColorSwatchPickerItemIndicator>
      </ColorSwatchPickerItem>
    </ColorSwatchPickerRoot>

    <button
      type="button"
      class="lj-color-picker__custom"
      :class="{ 'is-active': personalizada || aberto }"
      :aria-expanded="aberto"
      :aria-controls="painelId"
      :disabled="disabled"
      :style="{ '--lj-color-atual': corAtual }"
      @click="aberto = !aberto"
    >
      <LjIcon :icon="ICONS.FORMAT.PALETTE" :size="16" />
      <span>{{ t("components.color_picker.custom") }}</span>
      <span class="lj-color-picker__dot" aria-hidden="true" />
    </button>

    <div v-if="aberto" :id="painelId" class="lj-color-picker__panel">
      <ColorAreaRoot
        :model-value="corAtual"
        color-space="hsb"
        x-channel="saturation"
        y-channel="brightness"
        :disabled="disabled"
        @update:model-value="atualizar"
      >
        <template #default="{ style }">
          <ColorAreaArea class="lj-color-picker__area" :style="style">
            <ColorAreaThumb class="lj-color-picker__area-thumb" />
          </ColorAreaArea>
        </template>
      </ColorAreaRoot>

      <ColorSliderRoot
        class="lj-color-picker__slider"
        :model-value="corAtual"
        channel="hue"
        :disabled="disabled"
        @update:model-value="atualizar"
      >
        <ColorSliderTrack class="lj-color-picker__hue">
          <ColorSliderThumb class="lj-color-picker__hue-thumb" />
        </ColorSliderTrack>
      </ColorSliderRoot>

      <div class="lj-color-picker__hex-row">
        <ColorFieldRoot
          :model-value="corAtual"
          :disabled="disabled"
          @update:model-value="atualizar"
        >
          <ColorFieldInput
            class="lj-color-picker__hex"
            :aria-label="t('components.color_picker.hex')"
            spellcheck="false"
            autocomplete="off"
          />
        </ColorFieldRoot>
        <span
          class="lj-color-picker__preview"
          :style="{ background: corAtual }"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ColorAreaArea,
  ColorAreaRoot,
  ColorAreaThumb,
  ColorFieldInput,
  ColorFieldRoot,
  ColorSliderRoot,
  ColorSliderThumb,
  ColorSliderTrack,
  ColorSwatchPickerItem,
  ColorSwatchPickerItemIndicator,
  ColorSwatchPickerItemSwatch,
  ColorSwatchPickerRoot,
  colorToString,
  isValidColor,
  normalizeColor,
} from "reka-ui";
import LjIcon from "./LjIcon.vue";
import { ICONS } from "@/config/Icons";

interface ColorPickerProps {
  /** Cor atual em hex (`#rrggbb` ou `#rgb`). */
  modelValue?: string;
  /** Cores rápidas exibidas antes do seletor personalizado. */
  presets?: string[];
  disabled?: boolean;
  /** Nome acessível da lista de cores (padrão: "Cores"). */
  label?: string;
}

const props = withDefaults(defineProps<ColorPickerProps>(), {
  modelValue: "",
  presets: () => [],
  disabled: false,
  label: "",
});

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();
const painelId = useId();
const aberto = ref(false);

/** Toda cor que entra ou sai daqui é hex de 6 dígitos, minúsculo. */
function normalizar(valor: string | null | undefined): string {
  const texto = String(valor ?? "").trim();
  if (!texto || !isValidColor(texto)) return "";
  try {
    return colorToString(normalizeColor(texto), "hex");
  } catch {
    return "";
  }
}

const corNormalizada = computed(() => normalizar(props.modelValue));
const presetsNormalizados = computed(() => [
  ...new Set(props.presets.map((cor) => normalizar(cor)).filter(Boolean)),
]);
/** A cor de exibição: a do item ou, sem valor válido, a primeira opção. */
const corAtual = computed(() => corNormalizada.value || presetsNormalizados.value[0] || "#4caf50");
const presetSelecionado = computed(() =>
  presetsNormalizados.value.includes(corNormalizada.value) ? corNormalizada.value : ""
);
const personalizada = computed(
  () => !corNormalizada.value || !presetsNormalizados.value.includes(corNormalizada.value)
);
const ariaLabel = computed(() => props.label || t("components.color_picker.presets"));

function atualizar(valor: unknown): void {
  if (props.disabled) return;
  const hex = normalizar(typeof valor === "string" ? valor : "");
  if (!hex || hex === corNormalizada.value) return;
  emit("update:modelValue", hex);
}

/* Um campo desabilitado não pode continuar com o painel aberto. */
watch(
  () => props.disabled,
  (desabilitado) => {
    if (desabilitado) aberto.value = false;
  }
);
</script>

<style scoped>
.lj-color-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-3);
  min-width: 0;
}

.lj-color-picker--disabled {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

.lj-color-picker__presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

/* O item é o ListboxItem do Reka: recebe foco e clique como opção. */
.lj-color-picker__item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--lj-space-8);
  height: var(--lj-space-8);
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  outline: none;
  transition:
    transform var(--lj-transition-fast),
    border-color var(--lj-transition-fast);
}

.lj-color-picker__item:hover {
  transform: scale(1.12);
}

.lj-color-picker__item.is-active {
  border-color: var(--lj-ui-accent);
  transform: scale(1.12);
}

.lj-color-picker__item:focus-visible {
  box-shadow: var(--lj-ui-focus);
}

.lj-color-picker__swatch {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--reka-color-swatch-color);
}

.lj-color-picker__check {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lj-white);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.65));
  pointer-events: none;
}

.lj-color-picker__custom {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-height: var(--lj-ui-h-md);
  padding: 0 var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
  outline: none;
  transition:
    border-color var(--lj-transition-fast),
    color var(--lj-transition-fast);
}

.lj-color-picker__custom:hover {
  border-color: var(--lj-surface-border-strong);
}

.lj-color-picker__custom.is-active {
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
}

.lj-color-picker__custom:focus-visible {
  box-shadow: var(--lj-ui-focus);
}

.lj-color-picker__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--lj-color-atual);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}

.lj-color-picker__panel {
  display: grid;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
}

.lj-color-picker__area {
  position: relative;
  width: 100%;
  height: 140px;
  border-radius: var(--lj-radius-sm);
  cursor: crosshair;
  touch-action: none;
}

.lj-color-picker__area-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid var(--lj-white);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

/*
 * O thumb do Slider do Reka é `position: absolute` e recebe só o `left`
 * inline; sem um ancestral posicionado ele se referencia à caixa errada e
 * vaza para fora da faixa. O root do slider é a âncora.
 */
.lj-color-picker__slider {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 20px;
}

.lj-color-picker__hue {
  display: block;
  width: 100%;
  height: 12px;
  border-radius: 999px;
}

/* Caixa de 16px (border-box); sobe metade para centrar na faixa de 12px. */
.lj-color-picker__hue-thumb {
  top: 50%;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border: 2px solid var(--lj-white);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.lj-color-picker__hex-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.lj-color-picker__hex {
  width: 100%;
  height: var(--lj-ui-h-md);
  padding: 0 var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  text-transform: uppercase;
}

.lj-color-picker__hex:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.lj-color-picker__preview {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-sm);
}
</style>
