<template>
  <span class="lj-skeleton" :style="{ width, height, borderRadius: radius }" aria-hidden="true" />
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; radius?: string }>(), {
  width: "100%",
  height: "12px",
  radius: "var(--lj-radius-xs)",
});
</script>

<style scoped>
.lj-skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--lj-surface-bg-hover) 25%,
    var(--lj-surface-bg-active) 37%,
    var(--lj-surface-bg-hover) 63%
  );
  background-size: 400% 100%;
  animation: lj-skeleton-shimmer 1.4s ease infinite;
}

@keyframes lj-skeleton-shimmer {
  from {
    background-position: 100% 50%;
  }
  to {
    background-position: 0 50%;
  }
}
</style>
