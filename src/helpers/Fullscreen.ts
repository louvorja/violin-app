import { computed, shallowRef, type Ref, type ShallowRef, type WritableComputedRef } from "vue";

// Mesmo critério do vue-fullscreen: sem a API (iPhone) ele usa o modo "só página".
export function fullscreenApiAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export interface FullscreenStage {
  /** `ref` do `<Fullscreen>`. */
  stage: ShallowRef<unknown>;
  /** `v-model` do `<Fullscreen>`. */
  model: WritableComputedRef<boolean>;
}

/**
 * `v-model` do `<Fullscreen>` com exatamente um pedido de tela cheia por ativação.
 *
 * O componente do vue-fullscreen só pede tela cheia quando o `v-model` MUDA: montado
 * já com `true` (player minimizado reaberto pelo botão de tela cheia) ele não pede
 * nada. Aqui o `true` só chega a ele depois de montado, e a mudança dispara o pedido
 * dele mesmo, ainda dentro do gesto do usuário.
 *
 * Pedir por fora, além dele, fazia dois pedidos a cada clique: o primeiro consome o
 * gesto e o navegador recusa o segundo ("Permissions check failed").
 */
export function useFullscreenStage(active: Ref<boolean | undefined>): FullscreenStage {
  const stage = shallowRef<unknown>(null);
  const model = computed<boolean>({
    get: () => !!active.value && stage.value != null,
    set: (value) => {
      active.value = value;
    },
  });
  return { stage, model };
}
