<template>
  <!-- Mesmo provider da janela principal: sem ele todo LjTooltip quebra ao
       montar, e o controle remoto (/remote) ficava com botões faltando. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <div id="app-container" :class="{ 'is-transparent': isTransparent }">
      <router-view />
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { TooltipProvider } from "reka-ui";

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
