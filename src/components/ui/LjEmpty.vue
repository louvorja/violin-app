<template>
  <div class="lj-empty">
    <Icon v-if="icon" :icon="icon" :size="28" class="lj-empty__icon" />
    <p class="lj-empty__title">{{ title }}</p>
    <p v-if="description" class="lj-empty__desc">{{ description }}</p>
    <div v-if="$slots.default" class="lj-empty__actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";

defineProps<{ icon?: string; title: string; description?: string }>();
</script>

<style scoped>
.lj-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-7) var(--lj-space-5);
  background: var(--lj-surface-bg-soft);
  border: 1px dashed var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-md);
  text-align: center;
}

.lj-empty__icon {
  color: var(--lj-text-subtle);
}

.lj-empty__title {
  margin: 0;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text);
}

.lj-empty__desc {
  margin: 0;
  max-width: 44ch;
  font-size: var(--lj-text-sm);
  line-height: 1.5;
  color: var(--lj-text-muted);
}

.lj-empty__actions {
  display: flex;
  gap: var(--lj-space-3);
  margin-top: var(--lj-space-2);
}
</style>
