<template>
  <div
    class="lj-clear-screen"
    :class="{ 'lj-clear-screen--on': active }"
    :style="background"
    data-testid="projection-clear-screen"
    :data-active="active"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useMainBackground } from "@/composables/useMainBackground";

/**
 * "Limpar tela" do Modo apresentação nas janelas de projeção.
 *
 * Cobre a janela inteira com o fundo configurado em Opções (cor, imagem e
 * ajuste), acima das sobreposições, sem desmontar nada: a música e o vídeo
 * seguem rodando por baixo e voltam no ponto em que estão.
 *
 * O cache do Broadcast é por janela: uma janela aberta com a tela já limpa
 * não recebeu o aviso. Por isso ela pergunta ao montar.
 *
 * A camada fica sempre montada e só muda de opacidade. Com `v-if` e
 * `<Transition>`, a saída espera o fim da animação — e numa janela oculta ou
 * encoberta o navegador pausa animações: a tela ficava presa no fundo.
 */

const active = ref(false);
const { style: background } = useMainBackground();

useBroadcastListener(BROADCAST_TYPE.PROJECTION_CLEAR, (payload) => {
  active.value = (payload as { active?: boolean } | null)?.active === true;
});

onMounted(() => {
  Broadcast.send(BROADCAST_TYPE.REQUEST_PROJECTION_CLEAR, {});
});
</script>

<style scoped>
.lj-clear-screen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 200ms var(--lj-ease),
    visibility 0s linear 200ms;
}

.lj-clear-screen--on {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 200ms var(--lj-ease),
    visibility 0s;
}
</style>
