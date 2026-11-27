<template>
  <LjPopover :side="side" :align="align">
    <template #trigger>
      <button
        v-bind="$attrs"
        :id="id"
        type="button"
        class="lj-color-field"
        :class="[
          `lj-color-field--${size}`,
          { 'lj-color-field--full': fullWidth, 'lj-color-field--hex': showHex },
        ]"
        :disabled="disabled"
        :aria-label="resolvedAriaLabel"
      >
        <span class="lj-color-field__swatch" :style="{ backgroundColor: normalizedHex }" />
        <span v-if="showHex" class="lj-color-field__hex">{{ normalizedHex }}</span>
      </button>
    </template>
    <LjColorPicker
      :model-value="normalizedHex"
      :presets="presets ? [...presets] : undefined"
      :disabled="disabled"
      :label="resolvedAriaLabel"
      @update:model-value="onPick"
    />
  </LjPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import LjColorPicker from "@/components/ui/LjColorPicker.vue";
import LjPopover from "@/components/ui/LjPopover.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
    presets?: readonly string[];
    size?: "sm" | "md";
    showHex?: boolean;
    fullWidth?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  }>(),
  {
    modelValue: "#000000",
    disabled: false,
    size: "md",
    showHex: false,
    fullWidth: false,
    side: "bottom",
    align: "start",
  }
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

function normalizeHex(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const full = /^#([0-9a-f]{6})$/i.exec(s);
  if (full) return `#${full[1].toLowerCase()}`;
  const short = /^#([0-9a-f]{3})$/i.exec(s);
  if (short) {
    const [r, g, b] = short[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
}

const normalizedHex = computed(() => normalizeHex(props.modelValue));
const resolvedAriaLabel = computed(() => props.ariaLabel || normalizedHex.value);

function onPick(hex: string): void {
  emit("update:modelValue", normalizeHex(hex));
}
</script>

<style scoped>
.lj-color-field {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  box-sizing: border-box;
  padding: 3px;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font-family: inherit;
  cursor: pointer;
  outline: none;
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-color-field--sm {
  height: var(--lj-ui-h-sm);
  min-width: 34px;
}

.lj-color-field--md {
  height: var(--lj-ui-h-md);
  min-width: 40px;
}

.lj-color-field--hex {
  padding-inline: 4px var(--lj-space-3);
}

.lj-color-field--full {
  width: 100%;
}

.lj-color-field:hover:not(:disabled) {
  border-color: var(--lj-ui-accent);
}

.lj-color-field:focus-visible,
.lj-color-field[data-state="open"] {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-color-field:disabled {
  opacity: var(--lj-ui-disabled-opacity);
  cursor: not-allowed;
}

.lj-color-field__swatch {
  display: block;
  flex: 1 0 auto;
  min-width: 24px;
  height: 100%;
  border-radius: calc(var(--lj-ui-radius) - 2px);
  box-shadow: inset 0 0 0 1px var(--lj-black-alpha-18);
}

.lj-color-field--hex .lj-color-field__swatch {
  flex: 0 0 22px;
  min-width: 22px;
}

.lj-color-field__hex {
  font-family: var(--lj-font-mono, monospace);
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
