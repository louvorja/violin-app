<template>
  <div
    v-if="state.active && (state.url || state.type === 'blank')"
    class="lj-return-override"
    data-testid="return-override"
    :data-type="state.type"
    aria-hidden="true"
  >
    <img v-if="state.type === 'image'" class="lj-return-override__media" :src="state.url" alt="" />
    <video
      v-else-if="state.type === 'video'"
      ref="videoEl"
      :key="state.url"
      class="lj-return-override__media"
      :src="state.url"
      autoplay
      muted
      playsinline
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { applyVideoState } from "@/helpers/VideoSync";
import type { VideoMediaState } from "@/types/Media";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";

/**
 * Conteúdo só do retorno de palco — a letra para quem canta o louvor especial,
 * um recado para quem está no palco. Cobre o retorno inteiro; a tela principal
 * não recebe nada. O vídeo toca aqui mudo e acompanha o relógio que a janela
 * principal anuncia — é de lá que sai o som, pelo player do operador.
 * `blank` esconde o conteúdo do retorno: fica só o fundo.
 *
 * Fica abaixo da tela limpa (que cobre tudo) e acima do conteúdo do retorno.
 * Como a tela limpa, pergunta o estado ao abrir — o cache do Broadcast é por janela.
 */

interface OverrideState {
  active: boolean;
  type?: "image" | "video" | "blank";
  url?: string;
  id?: string;
}

const state = reactive<OverrideState>({ active: false });
const videoEl = ref<HTMLVideoElement | null>(null);

useBroadcastListener(BROADCAST_TYPE.RETURN_OVERRIDE, (payload) => {
  const p = (payload ?? {}) as OverrideState;
  state.active = p.active === true;
  state.type = p.type;
  state.url = p.url;
  state.id = p.id;
});

useBroadcastListener(BROADCAST_TYPE.RETURN_OVERRIDE_STATE, (payload) => {
  const p = payload as (VideoMediaState & { id?: string }) | null;
  if (!p || !videoEl.value || p.id !== state.id) return;
  applyVideoState(videoEl.value, p);
});

onMounted(() => {
  Broadcast.send(BROADCAST_TYPE.REQUEST_RETURN_OVERRIDE, {});
});
</script>

<style scoped>
.lj-return-override {
  position: fixed;
  inset: 0;
  z-index: 9990;
  background: var(--lj-color-projection-bg);
}

.lj-return-override__media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
