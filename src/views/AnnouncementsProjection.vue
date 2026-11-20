<!--
  Janela própria da projeção de Anúncios (Utilitários).

  Ela só existe quando NÃO há Projeção de Fundo aberta — `openAnnouncementsWindow`
  devolve cedo nesse caso, porque aí o aviso renderiza dentro da janela de fundo,
  como mais uma camada com fade (`ProjectionLayer.vue`).

  Esta tela guarda só o que é da janela: os overlays, o aviso de fechamento e o
  que fazer quando o módulo manda "parar". O conteúdo do aviso, a navegação e a
  transição entre slides estão no componente de camada, compartilhado pelos dois
  lugares.
-->
<template>
  <OverlayRenderer />
  <AnnouncementsLayer :on-stop="fecharJanela" />
  <ProjectionClearScreen />
</template>

<script setup lang="ts">
import { useProjectionCloseNotice } from "@/composables/useProjectionCloseNotice";
import { PROJECTION_TYPE } from "@/constants/Projection";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import ProjectionClearScreen from "@/components/ProjectionClearScreen.vue";
import AnnouncementsLayer from "@/modules/announcements/components/ProjectionLayer.vue";

/**
 * O ESC, o X da barra de título e o fim do slideshow avisam a janela principal
 * que a projeção de Anúncios acabou — senão o botão ficaria aceso sem ninguém
 * projetando.
 */
useProjectionCloseNotice(PROJECTION_TYPE.ANNOUNCEMENTS);

/** O comando "parar" chega por broadcast; aqui ele significa fechar a tela. */
function fecharJanela(): void {
  window.close();
}
</script>
