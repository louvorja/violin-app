import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * Palco de 1920×1080 desenhado reduzido por `transform: scale()`.
 *
 * É o mesmo desenho da prévia do módulo Sobreposições: o slot é posicionado em
 * pixels de uma tela Full HD e a escala reduz tudo junto — inclusive os
 * deslocamentos em px, que em `cqw/cqh` ficariam fora de proporção.
 */
export function useStageScale(target: Ref<HTMLElement | null>, designWidth = 1920) {
  const scale = ref(0.2);
  let observer: ResizeObserver | null = null;

  function measure(): void {
    const width = target.value?.clientWidth ?? 0;
    if (width > 0) scale.value = width / designWidth;
  }

  // O alvo pode nascer depois (a prévia só monta o palco para alguns tipos de
  // item), então observamos a ref em vez de medir uma única vez no mount.
  watch(
    target,
    (element) => {
      observer?.disconnect();
      observer = null;
      if (!element) return;
      measure();
      if (typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(measure);
      observer.observe(element);
    },
    { immediate: true, flush: "post" }
  );

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { scale, measure };
}
