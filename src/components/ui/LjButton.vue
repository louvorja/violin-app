<template>
  <button
    class="lj-ui-control lj-btn"
    :class="[
      `lj-ui-size-${size}`,
      `lj-btn--${variant}`,
      { 'lj-btn--icon': iconOnly, 'lj-btn--block': block },
    ]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <LjSpinner v-if="loading" :size="iconSize" />
    <Icon v-else-if="icon" :icon="icon" :size="iconSize" />
    <span v-if="!iconOnly" class="lj-btn__label"><slot /></span>
    <Icon v-if="iconEnd && !iconOnly" :icon="iconEnd" :size="iconSize" />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "@/components/Icon.vue";
import LjSpinner from "./LjSpinner.vue";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "primary" | "ghost" | "danger" | "subtle";
    size?: UiSize;
    icon?: string;
    iconEnd?: string;
    iconOnly?: boolean;
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "default", size: "md", type: "button" }
);

const iconSize = computed(() => ICON_SIZE[props.size]);
</script>

<style scoped>
.lj-btn {
  justify-content: center;
  cursor: pointer;
  font-weight: var(--lj-weight-medium);
  white-space: nowrap;
  user-select: none;
}

.lj-btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.lj-btn--block {
  display: flex;
  width: 100%;
}

/* Botão só-ícone é quadrado: largura = altura, sem padding lateral */
.lj-btn--icon {
  padding-inline: 0;
  aspect-ratio: 1;
}

.lj-btn--default:hover {
  background: var(--lj-surface-bg-hover);
}
.lj-btn--default:active {
  background: var(--lj-surface-bg-active);
}

.lj-btn--primary {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}
.lj-btn--primary:hover {
  background: var(--lj-ui-accent-hover);
  border-color: var(--lj-ui-accent-hover);
}
.lj-btn--primary:active {
  background: var(--lj-ui-accent-press);
  border-color: var(--lj-ui-accent-press);
}

.lj-btn--danger {
  border-color: var(--lj-danger-border);
  color: var(--lj-danger);
}
.lj-btn--danger:hover {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger);
}

/* Ghost some até o hover — para barras de ferramenta densas */
.lj-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--lj-text-muted);
}
.lj-btn--ghost:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}

/* Subtle mantém a superfície, mas sem traço — para agrupamentos */
.lj-btn--subtle {
  background: var(--lj-surface-bg-soft);
  border-color: transparent;
}
.lj-btn--subtle:hover {
  background: var(--lj-surface-bg-hover);
}
</style>
