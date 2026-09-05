<template>
  <AppLoading />
  <!-- Tooltips do design system exigem um provider único na raiz — ele guarda
       o atraso compartilhado, para que passar o mouse de um botão a outro não
       reinicie a contagem a cada elemento. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <div id="app-container">
      <router-view />
      <WebFullscreenPrompt v-if="isProjectionRoute" />
    </div>
  </TooltipProvider>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { TooltipProvider } from "reka-ui";
import AppLoading from "@/layout/Loading.vue";
import WebFullscreenPrompt from "@/components/WebFullscreenPrompt.vue";

const route = useRoute();

/**
 * Janelas que existem para ser projetadas. O convite de tela cheia só faz
 * sentido nelas — na janela principal atrapalharia o operador.
 */
const isProjectionRoute = computed(() => {
  const path = route.path || "";
  return path.startsWith("/projection") || path.startsWith("/obs") || path === "/clock";
});
</script>

<style>
/* Raiz de layout do app. Reúne num só elemento o que o `v-app` fazia em dois:
   a coluna que ocupa a janela inteira e a superfície do tema por baixo de todas
   as rotas — inclusive as que não pintam fundo próprio. */
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
</style>
