<template>
  <label class="lj-check" :class="{ 'is-disabled': disabled }">
    <input
      type="checkbox"
      class="lj-check__input"
      :checked="modelValue"
      :disabled="disabled"
      :indeterminate="indeterminate"
      @change="onChange"
    />
    <span class="lj-check__box" aria-hidden="true">
      <Icon v-if="indeterminate" :icon="ICONS.ACTIONS.MINUS" :size="11" />
      <Icon v-else-if="modelValue" :icon="ICONS.UI.CHECK" :size="11" />
    </span>
    <span v-if="label || $slots.default" class="lj-check__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

defineProps<{
  modelValue?: boolean;
  label?: string;
  disabled?: boolean;
  indeterminate?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

function onChange(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}
</script>

<style scoped>
.lj-check {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  cursor: pointer;
  user-select: none;
  font-size: var(--lj-text-base);
  color: var(--lj-text);
}

.lj-check.is-disabled {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

/* Input real fica invisível mas focável — o :focus-visible dele estiliza a caixa */
.lj-check__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.lj-check__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-ui-accent-fg);
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-check__input:checked + .lj-check__box,
.lj-check__input:indeterminate + .lj-check__box {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
}

.lj-check__input:focus-visible + .lj-check__box {
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.lj-check:hover .lj-check__box {
  border-color: var(--lj-ui-accent);
}
</style>
