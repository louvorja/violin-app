import { onBeforeUnmount, watch } from "vue";
import { prefetch } from "@/helpers/OnlineVideo";

/** Clicar em vários cartões seguidos não deve consultar o YouTube a cada um. */
const SETTLE_MS = 500;

/**
 * Adianta a consulta ao YouTube dos vídeos que estão perto de ir ao ar — a
 * prévia, o "a seguir", o próximo da playlist. Quando o operador manda tocar,
 * os links já estão prontos e o vídeo entra em ~2 s a menos.
 */
export function useOnlinePrefetch(candidates: () => (string | null | undefined)[]): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = watch(
    () => [...new Set(candidates().filter((id): id is string => !!id))].join(","),
    (key) => {
      if (timer) clearTimeout(timer);
      if (!key) return;
      timer = setTimeout(() => key.split(",").forEach(prefetch), SETTLE_MS);
    },
    { immediate: true }
  );
  onBeforeUnmount(() => {
    stop();
    if (timer) clearTimeout(timer);
  });
}
