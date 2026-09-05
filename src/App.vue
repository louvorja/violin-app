<template>
  <AppLoading />
  <!-- Tooltips do design system exigem um provider único na raiz — ele guarda
       o atraso compartilhado, para que passar o mouse de um botão a outro não
       reinicie a contagem a cada elemento. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <div id="app-container" :class="{ 'is-transparente': semFundoProprio }">
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

/**
 * Rotas em que a raiz não pode pintar nada.
 *
 * `/obs` e `/obs/bible` viram Browser Source no OBS e precisam sair
 * transparentes: uma superfície opaca aqui cobre a câmera com um retângulo
 * branco, e ele fica na transmissão enquanto não houver slide. Em `/projection`
 * o preto vem do `index.html`, justamente para não haver lampejo branco antes
 * de o slide entrar por fade — no telão, diante da congregação.
 */
const semFundoProprio = computed(() => {
  const path = route.path || "";
  return path.startsWith("/obs") || path.startsWith("/projection");
});
</script>

<style>
/* Raiz de layout do app: a coluna que ocupa a janela inteira e a superfície do
   tema por baixo das rotas da interface. */
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

#app-container.is-transparente {
  background: transparent;
}
</style>
