import { onBeforeUnmount, onMounted, type Ref } from "vue";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

/**
 * Setas, PageUp/PageDown, espaço, Home e End passam o slide com o foco numa janela
 * projetada (a de projeção ou a de retorno). Na janela principal elas só valem com
 * o player em foco, então estas janelas são o outro lugar de onde o operador passa
 * o slide pelo teclado. O pedido vai à principal, que é quem anda no deck.
 */
export function useProjectionSlideKeys(state: {
  slideIndex: Ref<number>;
  totalSlides: Ref<number>;
  sessionId: Ref<string | null>;
}): void {
  function goTo(index: number): void {
    if (state.totalSlides.value <= 0) return;
    const clamped = Math.max(0, Math.min(state.totalSlides.value - 1, index));
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, {
      index: clamped,
      _command_ts: Date.now(),
      ...(state.sessionId.value ? { presentation_session: state.sessionId.value } : {}),
    });
  }

  function onKey(e: KeyboardEvent): void {
    const target = {
      ArrowRight: 1,
      ArrowDown: 1,
      PageDown: 1,
      " ": 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      PageUp: -1,
    }[e.key];
    if (target !== undefined) {
      e.preventDefault();
      goTo(state.slideIndex.value + target);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(state.totalSlides.value - 1);
    }
  }

  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
