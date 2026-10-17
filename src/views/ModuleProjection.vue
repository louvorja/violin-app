<!--
  Janela própria da projeção de um módulo de Utilitários.

  Ela só existe quando NÃO há Projeção de Fundo aberta — com o fundo ligado, o
  módulo renderiza dentro dele, como mais uma camada com fade
  (`ModuleProjectionLayer.vue`).

  Esta tela guarda só o que é da janela: o overlay, o módulo que vem da query
  string, o aviso de fechamento vindo da janela principal e o ESC fechando a
  tela. O desenho, o texto e a escuta do estado ficam no componente de camada,
  compartilhado pelos dois lugares.
-->
<template>
  <OverlayRenderer />
  <ModuleProjectionLayer :module-id="moduleId" />
  <ProjectionClearScreen />
</template>

<script setup>
import { onBeforeUnmount, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import ProjectionClearScreen from "@/components/ProjectionClearScreen.vue";
import ModuleProjectionLayer from "@/components/ModuleProjectionLayer.vue";

const route = useRoute();
/** Uma única view genérica `/projection/module` serve a vários módulos. */
const moduleId = computed(() => String(route.query.module || ""));

/**
 * A janela principal manda fechar (ESC, ou trocar tudo de projeção). No web/PWA
 * é o caminho real: `window.open` com noopener não devolve referência para
 * fechar por fora. Dentro da janela de fundo não há o que fechar — a camada sai
 * pelo próprio estado do módulo.
 */
useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, (payload) => {
  if (!payload || payload.module !== moduleId.value) return;
  window.close();
});

function onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    setTimeout(() => window.close(), 150);
  }
}

onMounted(() => {
  document.documentElement.style.background = "#000";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000";
  document.body.style.height = "100vh";
  document.body.style.height = "100dvh";
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});
</script>
