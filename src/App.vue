<template>
  <AppLoading />
  <v-app id="app-container">
    <router-view />
    <WebFullscreenPrompt v-if="isProjectionRoute" />
  </v-app>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
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
