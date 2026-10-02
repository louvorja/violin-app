<template>
  <AppLoading />
  <!-- Tooltips do design system exigem um provider único na raiz — ele guarda
       o atraso compartilhado, para que passar o mouse de um botão a outro não
       reinicie a contagem a cada elemento. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <div
      id="app-container"
      :class="{ 'is-transparente': semFundoProprio, 'app-container--shell': route.path === '/' }"
    >
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
 * de o slide entrar por fade — no telão, diante da congregação. `/operator` abre
 * junto com o vídeo e desenha o próprio fundo por inteiro: até a rota carregar, o
 * tema por baixo (branco ou cinza-azulado) apareceria como uma piscada.
 */
const semFundoProprio = computed(() => {
  const path = route.path || "";
  return path.startsWith("/obs") || path.startsWith("/projection") || path === "/operator";
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
  height: 100dvh;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  backface-visibility: hidden;
}

#app-container.is-transparente {
  background: transparent;
}

/* O iOS 26 pinta a barra de status com o fundo de um elemento `position: fixed`
   encostado no topo ou, sem ele, com o background-color do <body>; ignora o
   theme-color e pseudo-elementos. Só a janela principal (main.js põe a classe):
   projeção e OBS cuidam do próprio fundo, que precisa ser preto ou transparente. */
body.lj-shell-body {
  background-color: var(--lj-shell-chrome-bg);
}

/* As faixas das áreas seguras (barra de status, indicador de início) mostram o
   <body>, não a superfície do tema — senão a de baixo fica branca no tema claro. */
#app-container.app-container--shell {
  background-clip: content-box;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}
</style>
