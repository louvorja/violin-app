<template>
  <div v-if="visible" class="wfp" @click="enterFullscreen">
    <button class="wfp__btn" type="button" @click.stop="enterFullscreen">
      <v-icon :icon="ICONS.PLAYER.FULLSCREEN" size="28" />
      <span class="wfp__label">{{ $t("projection.enter_fullscreen") }}</span>
      <span class="wfp__hint">{{ $t("projection.fullscreen_hint") }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Convite para entrar em tela cheia nas janelas de projeção no navegador.
 *
 * O navegador só concede tela cheia a partir de um gesto do usuário: a janela
 * não consegue se colocar em fullscreen sozinha ao abrir. Em vez de deixar o
 * operador descobrir o F11 no meio do culto, mostramos um alvo grande que
 * resolve com um clique — e que some sozinho assim que a tela cheia entra.
 *
 * No Electron não aparece: lá a janela já abre em tela cheia no monitor certo.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Platform from "@/helpers/Platform";
import { ICONS } from "@/config/Icons";
import WebDisplays from "@/helpers/projection/WebDisplays";

const isFullscreen = ref(false);
const dismissed = ref(false);

const visible = computed(() => !Platform.isDesktop && !isFullscreen.value && !dismissed.value);

function syncState(): void {
  isFullscreen.value = !!document.fullscreenElement;
}

async function enterFullscreen(): Promise<void> {
  try {
    // Com permissão concedida dá para escolher a tela; sem ela, o navegador usa
    // a tela onde a janela já está — que é justamente onde a queremos.
    const target = WebDisplays.listScreens().find(
      (screen) => Math.abs(screen.bounds.x - window.screenX) < screen.bounds.width
    );
    const options = target ? { screen: target } : undefined;
    await document.documentElement.requestFullscreen(options as FullscreenOptions);
  } catch {
    // Recusado (ou sem suporte a escolher tela): tenta o modo simples.
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Nada a fazer além de sair da frente — o operador ainda tem o F11.
      dismissed.value = true;
    }
  }
  syncState();
}

onMounted(() => {
  syncState();
  document.addEventListener("fullscreenchange", syncState);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncState);
});
</script>

<style scoped>
.wfp {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  cursor: pointer;
}

.wfp__btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 40px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-family: inherit;
  cursor: pointer;
}

.wfp__btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.wfp__label {
  font-size: 20px;
  font-weight: 600;
}

.wfp__hint {
  font-size: 13px;
  opacity: 0.7;
}
</style>
