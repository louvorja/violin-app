import { computed, ref, type Ref } from "vue";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * Larguras das colunas do programa (esquerda) e das saídas (direita),
 * puxadas pelas bordas e gravadas nas preferências. O palco fica com o resto
 * e nunca encolhe abaixo de `MIN_STAGE`.
 */

export type Column = "program" | "outputs";

const DEFAULTS: Record<Column, number> = { program: 282, outputs: 306 };
const LIMITS: Record<Column, [number, number]> = { program: [220, 520], outputs: [260, 560] };
const MIN_STAGE = 420;
const KEY_STEP = 24;
const KEYS_OF: Record<Column, string> = {
  program: KEYS.MODULES.PRESENTATION_MODE.PROGRAM_WIDTH,
  outputs: KEYS.MODULES.PRESENTATION_MODE.OUTPUTS_WIDTH,
};

export function useColumnLayout(area: Ref<HTMLElement | null>) {
  /** Durante o arraste a largura é local; só vai para as preferências ao soltar. */
  const dragging = ref<Partial<Record<Column, number>>>({});

  const width = (column: Column) =>
    dragging.value[column] ?? $userdata.get<number>(KEYS_OF[column], DEFAULTS[column]) ?? DEFAULTS[column];

  const program = computed(() => width("program"));
  const outputs = computed(() => width("outputs"));

  function clamp(column: Column, value: number): number {
    const [min, max] = LIMITS[column];
    const other = column === "program" ? outputs.value : program.value;
    const room = area.value ? area.value.clientWidth - other - MIN_STAGE : max;
    return Math.round(Math.min(max, Math.max(min, Math.min(value, room))));
  }

  function save(column: Column, value: number): void {
    $userdata.set(KEYS_OF[column], clamp(column, value));
    const { [column]: _done, ...rest } = dragging.value;
    dragging.value = rest;
  }

  /** A coluna da esquerda cresce para a direita; a da direita, para a esquerda. */
  function start(column: Column, event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width(column);
    const sign = column === "program" ? 1 : -1;
    let current = startWidth;
    const move = (e: PointerEvent) => {
      current = clamp(column, startWidth + sign * (e.clientX - startX));
      dragging.value = { ...dragging.value, [column]: current };
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      save(column, current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return {
    program,
    outputs,
    start,
    /** Setas na alça em foco: → alarga a coluna da esquerda e estreita a da direita. */
    step(column: Column, direction: 1 | -1): void {
      save(column, width(column) + (column === "program" ? direction : -direction) * KEY_STEP);
    },
    reset(column: Column): void {
      save(column, DEFAULTS[column]);
    },
  };
}
