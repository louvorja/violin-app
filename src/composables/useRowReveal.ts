import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from "vue";

const ROW_SELECTOR = "tr, [role='listitem']";

const touchedRow = shallowRef<Element | null>(null);
let outsideTapArmed = false;

function armOutsideTap(): void {
  if (outsideTapArmed || typeof document === "undefined") return;
  outsideTapArmed = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const row = touchedRow.value;
      if (row && !row.contains(event.target as Node)) touchedRow.value = null;
    },
    true
  );
}

// Foco vindo do mouse (clicar no ⋮ e o menu devolver o foco ao fechar) não conta: prenderia os ícones.
function keyboardFocus(target: EventTarget | null): boolean {
  try {
    return (target as Element).matches(":focus-visible");
  } catch {
    return true;
  }
}

function hoverAvailable(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: hover)").matches;
}

/**
 * Diz se o conteúdo de uma linha deve estar montado: mouse sobre a linha inteira,
 * foco de teclado dentro dela ou toque (que fica até o próximo toque fora).
 * Sem hover (tela só de toque) devolve sempre verdadeiro — não há como "passar por cima".
 */
export function useRowReveal(anchor: Ref<HTMLElement | null>) {
  const hoverable = hoverAvailable();
  const hovered = ref(false);
  const focused = ref(false);
  const row = shallowRef<Element | null>(null);
  let cleanup: (() => void) | null = null;

  const revealed = computed(
    () =>
      !hoverable ||
      hovered.value ||
      focused.value ||
      (row.value !== null && touchedRow.value === row.value)
  );

  onMounted(() => {
    if (!hoverable) return;
    const el = anchor.value;
    const host = el?.closest(ROW_SELECTOR) ?? el?.parentElement ?? el;
    if (!host) return;
    row.value = host;

    let lastPointerType = "mouse";
    const onPointerEnter = (e: Event) => {
      if ((e as PointerEvent).pointerType !== "touch") hovered.value = true;
    };
    const onPointerLeave = () => {
      hovered.value = false;
    };
    const onFocusIn = (e: Event) => {
      if (keyboardFocus(e.target)) focused.value = true;
    };
    const onFocusOut = (e: Event) => {
      if (!host.contains((e as FocusEvent).relatedTarget as Node | null)) focused.value = false;
    };
    const onPointerDown = (e: Event) => {
      lastPointerType = (e as PointerEvent).pointerType;
    };
    const onClick = () => {
      if (lastPointerType !== "touch") return;
      touchedRow.value = host;
      armOutsideTap();
    };

    host.addEventListener("pointerenter", onPointerEnter);
    host.addEventListener("pointerleave", onPointerLeave);
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("click", onClick);

    cleanup = () => {
      host.removeEventListener("pointerenter", onPointerEnter);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("click", onClick);
      if (touchedRow.value === host) touchedRow.value = null;
    };
  });

  onBeforeUnmount(() => cleanup?.());

  return revealed;
}
