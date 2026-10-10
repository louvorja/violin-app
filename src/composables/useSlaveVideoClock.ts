import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * Vídeo de tela que segue o player da janela principal (o som sai de lá).
 *
 * A tela não tem relógio próprio: ela não toca por conta própria e só anda
 * enquanto ouve o player. Antes, o vídeo dela começava sozinho e só era
 * corrigido pelas mensagens — se elas deixassem de valer (identidade trocada,
 * janela recarregada no meio), a tela seguia rodando sem som, fora do
 * controle do operador. Agora, sem estado aceito do player por `LOST_MS`
 * com o vídeo andando, a tela para no quadro e pede o estado de novo.
 *
 * O player manda o estado a cada 500 ms tocando e a cada 1 s pausado; 3 s
 * cobre a janela principal em segundo plano sem parar a tela à toa.
 */

const LOST_MS = 3000;
const CHECK_MS = 500;

export function useSlaveVideoClock(
  video: Ref<HTMLVideoElement | null>,
  opts: { enabled: () => boolean; request: () => void }
) {
  let lastAccepted = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      if (!opts.enabled()) return;
      const el = video.value;
      if (!el || el.paused) return;
      if (Date.now() - lastAccepted <= LOST_MS) return;
      el.pause();
      opts.request();
    }, CHECK_MS);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });

  return {
    /** Chegou um estado do player e foi aceito. */
    heard(): void {
      lastAccepted = Date.now();
    },
    /** Vídeo novo: ainda não ouviu nada deste. */
    reset(): void {
      lastAccepted = 0;
    },
  };
}
