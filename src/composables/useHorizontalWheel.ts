import type { Ref } from "vue";

/**
 * Converte a roda vertical em rolagem lateral de uma faixa com `overflow-x`.
 * Trackpads que já mandam `deltaX` seguem o comportamento nativo; no limite ou
 * sem overflow, a página continua rolando normalmente.
 */
export function useHorizontalWheel(el: Ref<HTMLElement | null>) {
  function onWheel(event: WheelEvent): void {
    const node = el.value;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const factor =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? node.clientWidth
          : 1;
    const delta = event.deltaY * factor;
    if (!delta) return;

    const max = node.scrollWidth - node.clientWidth;
    const next = Math.max(0, Math.min(max, node.scrollLeft + delta));
    if (next === node.scrollLeft) return;
    event.preventDefault();
    node.scrollLeft = next;
  }

  return { onWheel };
}
