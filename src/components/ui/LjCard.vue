<template>
  <section class="lj-card" :class="{ 'lj-card--soft': soft, 'lj-card--flush': flush }">
    <header v-if="title || $slots.header" class="lj-card__header">
      <slot name="header">
        <Icon v-if="icon" :icon="icon" :size="15" class="lj-card__icon" />
        <h3 class="lj-card__title">{{ title }}</h3>
      </slot>
      <div v-if="$slots.actions" class="lj-card__actions"><slot name="actions" /></div>
    </header>
    <div class="lj-card__body"><slot /></div>
    <footer v-if="$slots.footer" class="lj-card__footer"><slot name="footer" /></footer>
  </section>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";

defineProps<{ title?: string; icon?: string; soft?: boolean; flush?: boolean }>();
</script>

<style scoped>
.lj-card {
  display: flex;
  flex-direction: column;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  overflow: hidden;
}

.lj-card--soft {
  background: var(--lj-surface-bg-soft);
}

.lj-card__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.lj-card__icon {
  color: var(--lj-text-muted);
}

.lj-card__title {
  margin: 0;
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
}

.lj-card__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}

.lj-card__body {
  padding: var(--lj-space-5);
}

.lj-card--flush .lj-card__body {
  padding: 0;
}

.lj-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-5);
  border-top: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
}
</style>
