<template>
  <AppLoading />
  <!-- Tooltips do design system exigem um provider único na raiz — ele guarda
       o atraso compartilhado, para que passar o mouse de um botão a outro não
       reinicie a contagem a cada elemento. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <v-app id="app-container">
      <router-view />
      <WebFullscreenPrompt v-if="isProjectionRoute" />
    </v-app>
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
#app-container > div {
  height: 100vh;
}
</style>
