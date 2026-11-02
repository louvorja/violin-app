import { onBeforeUnmount, watch } from "vue";
import Media from "@/composables/useMedia";
import { useSlides } from "@/composables/useSlides";

/**
 * Clique num slide da prévia: a música vai ao ar e, quando os slides dela
 * chegarem, salta para o slide escolhido. Só uma espera por vez: mandar outra
 * coisa ao ar cancela a anterior. Desiste depois de 15 s.
 */
export function useSlideWait() {
  const slides = useSlides();
  let cancelWait: (() => void) | null = null;

  function goToSlideWhenLoaded(idMusic: number, index: number): void {
    cancelWait?.();
    cancelWait = null;
    if (index <= 0) return;
    const stop = watch(
      () => [slides.totalSlides.value, slides.slides.value[0]?.id_music] as const,
      ([total, id]) => {
        if (total <= index || Number(id) !== idMusic) return;
        cancel();
        Media.goToSlide(index);
      },
      { immediate: true }
    );
    const timer = setTimeout(() => cancel(), 15000);
    function cancel(): void {
      stop();
      clearTimeout(timer);
      if (cancelWait === cancel) cancelWait = null;
    }
    cancelWait = cancel;
  }

  onBeforeUnmount(() => cancelWait?.());

  return { goToSlideWhenLoaded };
}
