import { onBeforeUnmount, ref, watch, type Ref } from "vue";

export interface BackgroundItem {
  active: boolean;
  type: string;
  url: string;
}

export interface BackgroundLayer {
  key: string;
  type: string;
  url: string;
}

/** Se o primeiro frame não chegar, não deixa a troca presa para sempre. */
export const BACKGROUND_FIRST_FRAME_TIMEOUT_MS = 1500;

/**
 * Pilha de camadas da Projeção de Fundo.
 *
 * O item novo entra POR CIMA do atual com opacidade 0 e sobe até 1; o atual
 * continua opaco embaixo. Assim o papel de parede/cor nunca aparece no meio da
 * troca. Só depois do fade as camadas antigas são removidas.
 *
 * O fade só começa quando a mídia nova tem o primeiro frame (ou estoura o
 * timeout), evitando um fade para uma tela preta enquanto o vídeo carrega.
 */
export function useBackgroundItemStack(item: BackgroundItem, fadeMs: Ref<number>) {
  const layers = ref<BackgroundLayer[]>([]);
  const pendingKey = ref<string | null>(null);
  const enteringKey = ref<string | null>(null);
  let seq = 0;
  let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  let pruneTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFirstFrameTimer(): void {
    if (firstFrameTimer) {
      clearTimeout(firstFrameTimer);
      firstFrameTimer = null;
    }
  }

  function clearPruneTimer(): void {
    if (pruneTimer) {
      clearTimeout(pruneTimer);
      pruneTimer = null;
    }
  }

  function dropPending(): void {
    if (!pendingKey.value) return;
    const key = pendingKey.value;
    layers.value = layers.value.filter((layer) => layer.key !== key);
    pendingKey.value = null;
    clearFirstFrameTimer();
  }

  /** Primeiro frame disponível (ou timeout): começa o fade por cima. */
  function markReady(key: string): void {
    if (pendingKey.value !== key) return;
    clearFirstFrameTimer();
    pendingKey.value = null;
    // A camada que ainda estava entrando vira opaca: só a nova anima.
    enteringKey.value = key;
    clearPruneTimer();
    pruneTimer = setTimeout(
      () => {
        const atual = layers.value.find((layer) => layer.key === key);
        if (!atual) return;
        layers.value = [atual];
        enteringKey.value = null;
        pruneTimer = null;
      },
      Math.max(0, fadeMs.value)
    );
  }

  function enqueue(type: string, url: string): void {
    // Uma pendente que nunca apareceu não precisa ficar na pilha.
    dropPending();
    // A camada anterior, se ainda animava, congela em opacidade 1.
    enteringKey.value = null;
    clearPruneTimer();

    const key = `bg-${++seq}`;
    layers.value = [...layers.value, { key, type, url }];
    pendingKey.value = key;
    clearFirstFrameTimer();
    firstFrameTimer = setTimeout(() => markReady(key), BACKGROUND_FIRST_FRAME_TIMEOUT_MS);
  }

  watch(
    () => [item.active, item.type, item.url] as const,
    ([active, type, url], previous) => {
      const [wasActive, wasType, wasUrl] = previous ?? [false, "", ""];
      if (!active) {
        // A saída é animada pelo Transition do container; a pendente (invisível)
        // pode sair já para não animar à toa no meio do fade de saída.
        dropPending();
        return;
      }
      if (!url) return;
      if (wasActive && type === wasType && url === wasUrl) return;
      enqueue(type, url);
    },
    { immediate: true }
  );

  function reset(): void {
    clearFirstFrameTimer();
    clearPruneTimer();
    layers.value = [];
    pendingKey.value = null;
    enteringKey.value = null;
  }

  onBeforeUnmount(reset);

  return { layers, pendingKey, enteringKey, markReady, reset };
}
