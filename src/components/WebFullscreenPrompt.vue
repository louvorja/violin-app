<template>
  <button
    v-if="visible"
    type="button"
    class="wfp"
    :title="$t('projection.enter_fullscreen')"
    @click="onUserClick"
  >
    <v-icon :icon="ICONS.PLAYER.FULLSCREEN" size="20" />
  </button>
</template>

<script setup lang="ts">
/**
 * Botão discreto para colocar a janela de projeção em tela cheia no navegador.
 *
 * A janela já abre preenchendo o monitor; o que a tela cheia acrescenta é
 * esconder a barra do navegador. O navegador não deixa a página entrar em tela
 * cheia sozinha — só o Chrome com a configuração "Tela cheia automática"
 * (M126+), que não é oferecida a sites comuns e não pode ser pedida pela
 * página. Por isso a tentativa silenciosa ao abrir e, se ela falhar, este
 * botão, que some sozinho para não ficar sobre a projeção durante o culto.
 *
 * No Electron não aparece: lá a janela já abre em tela cheia.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Platform from "@/helpers/Platform";
import { ICONS } from "@/config/Icons";
import WebDisplays from "@/helpers/projection/WebDisplays";

/** Tempo até o botão sumir sozinho, para não atrapalhar a projeção. */
const AUTO_HIDE_MS = 8000;

const isFullscreen = ref(false);
const hidden = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const visible = computed(() => !Platform.isDesktop && !isFullscreen.value && !hidden.value);

function syncState(): void {
  isFullscreen.value = !!document.fullscreenElement;
}

async function enterFullscreen({ silent = false } = {}): Promise<void> {
  // A tela em que a janela está: `requestFullscreen({ screen })` precisa do
  // objeto cru da API, então localizamos o índice e pegamos o correspondente.
  const telas = WebDisplays.listScreens();
  const indice = telas.findIndex(
    (screen) =>
      window.screenX >= screen.bounds.x && window.screenX < screen.bounds.x + screen.bounds.width
  );
  const alvo = indice >= 0 ? WebDisplays.rawScreens()[indice] : undefined;

  try {
    await document.documentElement.requestFullscreen(
      (alvo ? { screen: alvo } : undefined) as unknown as FullscreenOptions
    );
  } catch {
    // Sem permissão para escolher a tela: a janela já está no monitor certo,
    // então o modo simples serve.
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      if (!silent) hidden.value = true;
    }
  }
  syncState();
}

function onUserClick(): void {
  enterFullscreen({ silent: false });
}

onMounted(async () => {
  syncState();
  document.addEventListener("fullscreenchange", syncState);
  if (Platform.isDesktop) return;

  // Reconecta ao acesso às telas já concedido na janela principal: sem ele
  // `rawScreens()` volta vazio nesta janela e a tela cheia não sabe em qual
  // monitor entrar.
  await WebDisplays.restoreAccess();
  await enterFullscreen({ silent: true });
  WebDisplays.setAutoFullscreenState(!!document.fullscreenElement);

  if (!document.fullscreenElement) {
    hideTimer = setTimeout(() => (hidden.value = true), AUTO_HIDE_MS);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncState);
  if (hideTimer) clearTimeout(hideTimer);
});
</script>

<style scoped>
.wfp {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
}

.wfp:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.7);
}
</style>
