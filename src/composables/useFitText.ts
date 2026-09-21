import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { fitTextToBox } from "@/helpers/FitText";

interface FitTextOptions {
  box: Ref<HTMLElement | null>;
  text: Ref<HTMLElement | null>;
  /** Teto, em % da altura da janela (vh) — o mesmo vocabulário da tela de Opções. */
  maxVh: () => number;
  /** Piso, em vh. Abaixo dele o texto só cede se nem assim couber. */
  minVh: () => number;
  /** Tudo o que muda a largura ou a altura do texto: conteúdo, fonte, caixa. */
  deps: () => unknown;
}

/**
 * Mantém `text` no maior tamanho que cabe em `box`, refazendo a conta quando o
 * conteúdo, a configuração, a janela ou a fonte mudam.
 *
 * Custo: uma dezena de medidas de um bloco de poucas linhas a cada troca de
 * slide ou de tamanho de janela; em regime não há timer nem laço.
 */
export function useFitText(o: FitTextOptions): { refit: () => void } {
  function refit(): void {
    const box = o.box.value;
    const text = o.text.value;
    if (!box || !text) return;
    const vh = window.innerHeight / 100;
    const max = Math.max(1, o.maxVh() * vh);
    const min = Math.min(max, Math.max(1, o.minVh() * vh));
    fitTextToBox(box, text, min, max);
  }

  // `post`: o DOM já tem o texto novo e o navegador ainda não pintou, então o
  // primeiro quadro já sai no tamanho certo, sem piscar.
  watch([o.box, o.text, () => o.maxVh(), () => o.minVh(), o.deps], refit, { flush: "post" });

  let observer: ResizeObserver | null = null;

  onMounted(() => {
    refit();
    if (typeof ResizeObserver !== "undefined" && o.box.value) {
      observer = new ResizeObserver(refit);
      observer.observe(o.box.value);
    }
    // A fonte de projeção chega depois do primeiro layout; sem refazer a conta
    // o texto seria medido com a fonte reserva, mais larga ou mais estreita.
    document.fonts?.addEventListener?.("loadingdone", refit);
    void document.fonts?.ready?.then(refit);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    document.fonts?.removeEventListener?.("loadingdone", refit);
  });

  return { refit };
}
