<template>
  <div class="ribbon-group" :class="{ 'ribbon-group--web': !Platform.isDesktop }">
    <div class="ribbon-group-content">
      <slot />
    </div>
    <div class="ribbon-group-label">{{ title }}</div>
  </div>
</template>

<script setup>
import Platform from "@/helpers/Platform";

defineProps({
  title: { type: String, required: true },
});
</script>

<style scoped>
.ribbon-group {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--lj-body-divider);
  padding: var(--lj-space-2) var(--lj-space-3) 0;
  flex-shrink: 0;
  height: 100%;
  width: max-content;
}

.ribbon-group:last-child {
  border-right: none;
}

.ribbon-group-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 1 1 auto;
  gap: var(--lj-space-2);
  padding: var(--lj-space-1) 0 0;
  min-height: 0;
  width: max-content;
  min-width: max-content;
  /* O web usa dois trilhos internos: um para itens grandes e outro para
     controles compactos. O grupo só limita a altura total. */
  max-height: calc(var(--lj-ribbon-body-height) - var(--lj-group-label-height) - 8px);
  overflow: hidden;
}

.ribbon-group--web .ribbon-group-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 1 1 auto;
  gap: var(--lj-space-2);
  overflow: hidden;
}

.ribbon-group-label {
  margin-top: auto;
  height: var(--lj-group-label-height);
  text-align: center;
  font-size: var(--lj-text-xs);
  color: var(--lj-group-label-color);
  letter-spacing: 0.02em;
  padding: 0 var(--lj-space-2) 3px;
  white-space: nowrap;
  font-weight: var(--lj-weight-regular);
  line-height: 1;
}
</style>
