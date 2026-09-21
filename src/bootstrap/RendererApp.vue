<template>
  <div id="app-container" :class="{ 'is-transparent': isTransparent }">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const isTransparent = computed(() => {
  const path = route.path || "";
  return path.startsWith("/obs") || path.startsWith("/projection");
});
</script>

<style>
#app-container {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  max-width: 100%;
  height: 100vh;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  backface-visibility: hidden;
}

#app-container.is-transparent {
  background: transparent;
}
</style>
