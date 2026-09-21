/**
 * Maior tamanho de fonte em que um texto cabe numa caixa, sem cortar.
 *
 * O tamanho configurado pelo operador é o TETO: o texto só diminui quando a
 * letra é longa demais para ele. Uma estrofe curta fica no tamanho pedido; uma
 * de cinco linhas compridas encolhe até caber inteira, em vez de estourar por
 * cima e por baixo da caixa.
 *
 * @category helper-puro
 */

/**
 * Uma linha da letra só é quebrada em duas se isso render bem mais tamanho.
 * Abaixo deste fator o texto fica com as linhas do verso intactas, como no
 * hinário, e o tamanho é o que a linha mais comprida permite.
 */
export const WRAP_TOLERANCE = 0.72;

export interface FitResult {
  /** Tamanho da fonte, em px. */
  px: number;
  /** true quando as linhas compridas precisaram quebrar para caber. */
  wrap: boolean;
}

/**
 * Maior tamanho em [min, max] para o qual `fits` é verdadeiro. Se nem o menor
 * couber devolve `min`: o chamador prefere texto pequeno a texto cortado, e
 * não há tamanho menor que isso para tentar.
 */
export function largestFit(fits: (_px: number) => boolean, min: number, max: number): number {
  if (max <= min) return min;
  if (fits(max)) return max;
  if (!fits(min)) return min;
  let lo = min;
  let hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}

/** Escolhe o tamanho preferindo manter cada linha do verso inteira. */
export function chooseFit(
  fits: (_px: number, _wrap: boolean) => boolean,
  min: number,
  max: number
): FitResult {
  const single = largestFit((px) => fits(px, false), min, max);
  if (single >= max) return { px: max, wrap: false };
  const wrapped = largestFit((px) => fits(px, true), min, max);
  return single >= wrapped * WRAP_TOLERANCE
    ? { px: single, wrap: false }
    : { px: wrapped, wrap: true };
}

function paddingOf(el: HTMLElement): { x: number; y: number } {
  const cs = getComputedStyle(el);
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
  };
}

/**
 * Aplica em `text` o maior `font-size` que cabe no miolo de `box` e o devolve.
 * O elemento precisa ocupar a largura da caixa (`width: 100%`) e a caixa não
 * pode depender do tamanho do texto, senão a medida corre atrás de si mesma.
 */
export function fitTextToBox(
  box: HTMLElement,
  text: HTMLElement,
  min: number,
  max: number
): FitResult {
  const pad = paddingOf(box);
  const availW = box.clientWidth - pad.x;
  const availH = box.clientHeight - pad.y;

  const apply = (px: number, wrap: boolean): void => {
    text.style.fontSize = `${px}px`;
    // Só `white-space`: nos navegadores novos ele e `text-wrap` são atalhos da
    // mesma propriedade interna (`text-wrap-mode`), e limpar um apagava o outro.
    // O `text-wrap: balance` do modo com quebra fica no CSS de quem usa.
    text.style.whiteSpace = wrap ? "normal" : "nowrap";
  };

  const fits = (px: number, wrap: boolean): boolean => {
    apply(px, wrap);
    // 1px de folga: scrollWidth arredonda para inteiro.
    return text.scrollWidth <= availW + 1 && text.getBoundingClientRect().height <= availH + 1;
  };

  const result = chooseFit(fits, min, max);
  apply(result.px, result.wrap);
  return result;
}
