import { nextTick, watch, type Ref } from "vue";

// Mesmo critério do vue-fullscreen: sem a API (iPhone) ele usa o modo "só página".
export function fullscreenApiAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export interface FullscreenComponentLike {
  isFullscreen?: boolean;
  request?: () => Promise<void> | void;
}

/**
 * Garante entrada em tela cheia quando `<Fullscreen>` monta já com `v-model=true`
 * (ex.: player minimizado reaberto pelo botão de tela cheia).
 */
export function watchDeferredFullscreenRequest(
  active: Readonly<Ref<boolean | undefined>>,
  stage: Readonly<Ref<FullscreenComponentLike | null>>,
  onRejected: () => void
): void {
  watch(
    [active, stage],
    async ([isActive, comp]) => {
      if (!isActive || !comp || comp.isFullscreen) return;
      await nextTick();
      try {
        await comp.request?.();
      } catch {
        onRejected();
      }
    },
    { flush: "post" }
  );
}
