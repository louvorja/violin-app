<template>
  <span class="lj-chip" :class="[`lj-chip--${variant}`, `lj-chip--${size}`]">
    <Icon v-if="icon" :icon="icon" :size="size === 'sm' ? 11 : 13" />
    <slot />
    <button
      v-if="removable"
      type="button"
      class="lj-chip__remove"
      aria-label="Remover"
      @click="$emit('remove')"
    >
      <Icon :icon="ICONS.ACTIONS.CLOSE" :size="11" />
    </button>
  </span>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

withDefaults(
  defineProps<{
    variant?: "neutral" | "primary" | "success" | "warning" | "danger";
    size?: "sm" | "md";
    icon?: string;
    removable?: boolean;
  }>(),
  { variant: "neutral", size: "md" }
);

defineEmits<{ remove: [] }>();
</script>

<style scoped>
.lj-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  font-weight: var(--lj-weight-medium);
  white-space: nowrap;
}

.lj-chip--sm {
  height: 16px;
  padding-inline: var(--lj-space-3);
  font-size: var(--lj-text-xs);
}

.lj-chip--md {
  height: 20px;
  padding-inline: var(--lj-space-4);
  font-size: var(--lj-text-sm);
}

.lj-chip--neutral {
  background: var(--lj-surface-bg-active);
  border-color: var(--lj-surface-border);
  color: var(--lj-text-muted);
}

.lj-chip--primary {
  background: var(--lj-ui-accent-soft);
  border-color: transparent;
  color: var(--lj-ui-accent-text);
}

.lj-chip--success {
  background: var(--lj-success-soft);
  color: var(--lj-success);
}

.lj-chip--warning {
  background: var(--lj-orange-alpha-12);
  color: var(--lj-warning);
}

.lj-chip--danger {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger-border);
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.lj-chip__remove {
  display: inline-flex;
  padding: 0;
  margin-right: -2px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}
.lj-chip__remove:hover {
  opacity: 1;
}
</style>
