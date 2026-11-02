import { computed, ref, watch } from "vue";
import { useAudioPlayback } from "@/composables/useAudioPlayback";

/**
 * O mudo do player do operador, um só para o módulo: o botão do palco e o
 * "Reproduzir sem áudio" mexem no mesmo. É o `muted` do elemento, e não o
 * volume: o player volta o volume a 100 e faz fade-in a cada mídia nova, e o
 * volume que o operador ajustou continua o mesmo ao tirar o mudo.
 */

const muted = ref(false);
let installed = false;

function apply(): void {
  const el = useAudioPlayback().getElement();
  if (el.muted !== muted.value) el.muted = muted.value;
}

export function usePlayerMute() {
  if (!installed) {
    installed = true;
    const audio = useAudioPlayback();
    // Cada mídia nova (e a troca do elemento de áudio pelo de vídeo) recebe o mudo atual.
    watch(() => [audio.duration.value, audio.isPaused.value], apply);
  }

  return {
    muted: computed(() => muted.value),
    mute(): void {
      muted.value = true;
      apply();
    },
    unmute(): void {
      muted.value = false;
      apply();
    },
    toggle(): void {
      muted.value = !muted.value;
      apply();
    },
  };
}
