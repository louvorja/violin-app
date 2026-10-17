import { nextTick, type Directive } from "vue";

/**
 * Ajusta a fonte de uma linha para que ela caiba na largura disponível.
 *
 * A largura de referência é o **palco**, não a própria caixa: desde que o fundo
 * do texto encolhe até o texto (`width: fit-content`), medir o próprio elemento
 * daria sempre "cabe", a redução nunca dispararia e uma hora/minuto longa
 * quebraria linha em vez de encolher.
 *
 * Aceita as duas formas:
 *   `v-fit-clock-line="42"`                     → mede o pai (comportamento antigo)
 *   `v-fit-clock-line="{ size, widthFrom }"`    → mede o elemento indicado
 */
type FitValue = string | number | null | undefined;
type FitBinding = { size?: FitValue; widthFrom?: HTMLElement | null };

interface FitState {
  value: FitValue;
  widthFrom?: HTMLElement | null;
  refit: () => void;
  observer: ResizeObserver | null;
  active: boolean;
}

const states = new WeakMap<HTMLElement, FitState>();

/** O valor pode ser o tamanho direto ou o objeto com o palco. */
function _lerBinding(value: unknown): { size: FitValue; widthFrom?: HTMLElement | null } {
  if (value && typeof value === "object") {
    const b = value as FitBinding;
    return { size: b.size, widthFrom: b.widthFrom };
  }
  return { size: value as FitValue };
}

function fit(el: HTMLElement, value: FitValue, widthFrom?: HTMLElement | null): void {
  const preferred = Number.parseFloat(String(value));
  if (!Number.isFinite(preferred) || preferred <= 0) return;

  // Recomeça do tamanho escolhido pelo operador. O ajuste só atua quando a
  // linha não cabe, inclusive depois de uma troca de fonte ou de janela.
  el.style.fontSize = `${preferred}px`;
  const referencia = widthFrom || el.parentElement || el;
  const available = referencia.clientWidth - 2;
  if (available <= 0 || !el.textContent) return;

  const range = document.createRange();
  range.selectNodeContents(el);
  const width = range.getBoundingClientRect().width;
  if (width > available) {
    el.style.fontSize = `${Math.max(1, (preferred * available) / width)}px`;
  }
}

/** Reduz apenas a linha que excede a largura; nunca quebra nem corta texto. */
export const vFitClockLine: Directive<HTMLElement, FitValue | FitBinding> = {
  mounted(el, binding) {
    const { size, widthFrom } = _lerBinding(binding.value);
    const state: FitState = {
      value: size,
      widthFrom,
      refit: () => {},
      observer: null,
      active: true,
    };
    state.refit = () => fit(el, state.value, state.widthFrom);
    states.set(el, state);
    /*
     * O primeiro ajuste espera o tick: `widthFrom` é um ref do elemento PAI, e
     * no `mounted` da diretiva ele ainda não foi atribuído — medir sem ele cairia
     * na caixa encolhida e encolheria a linha à toa.
     */
    void nextTick(() => {
      if (state.active) state.refit();
    });

    if (typeof ResizeObserver !== "undefined") {
      let lastWidth = 0;
      state.observer = new ResizeObserver(([entry]) => {
        /* O que muda de tamanho é o PALCO: a caixa encolhe junto com o texto,
           então observar o próprio elemento não acusaria mudança alguma. */
        const alvo = state.widthFrom || el;
        const width = alvo === el ? entry.contentRect.width : alvo.clientWidth;
        if (Math.abs(width - lastWidth) < 0.5) return;
        lastWidth = width;
        state.refit();
      });
      state.observer.observe(state.widthFrom || el);
    }

    document.fonts?.addEventListener?.("loadingdone", state.refit);
    void document.fonts?.ready?.then(() => {
      if (state.active) state.refit();
    });
  },
  updated(el, binding) {
    const state = states.get(el);
    if (!state) return;
    const { size, widthFrom } = _lerBinding(binding.value);
    state.value = size;
    if (widthFrom) state.widthFrom = widthFrom;
    state.refit();
  },
  unmounted(el) {
    const state = states.get(el);
    if (!state) return;
    state.active = false;
    state.observer?.disconnect();
    document.fonts?.removeEventListener?.("loadingdone", state.refit);
    states.delete(el);
  },
};
