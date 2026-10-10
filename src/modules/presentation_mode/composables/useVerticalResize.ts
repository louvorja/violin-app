import type { Ref } from "vue";

const MIN_HEIGHT = 120;
/** O palco acima nunca fica menor que isso. */
const MIN_STAGE = 150;
const KEY_STEP = 24;

interface Options {
  /** O painel que cresce; o limite de cima vem do container dele. */
  root: Ref<HTMLElement | null>;
  height: () => number;
  onResize: (height: number) => void;
  onEnd: (height: number) => void;
}

/**
 * Altura de um painel ancorado embaixo, puxada pela borda de cima — com o
 * ponteiro ou, com a alça em foco, pelas setas.
 */
export function useVerticalResize({ root, height, onResize, onEnd }: Options) {
  function clamp(value: number): number {
    const area = root.value?.parentElement;
    const max = area ? Math.max(MIN_HEIGHT, area.clientHeight - MIN_STAGE) : value;
    return Math.min(max, Math.max(MIN_HEIGHT, value));
  }

  function start(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = height();
    let current = startHeight;

    const move = (e: PointerEvent) => {
      current = clamp(startHeight + (startY - e.clientY));
      onResize(current);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onEnd(current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function step(direction: 1 | -1): void {
    onEnd(clamp(height() + direction * KEY_STEP));
  }

  return { start, step };
}
