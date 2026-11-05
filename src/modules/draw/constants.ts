/**
 * Tempo fixo do vai e vem final do sorteio.
 *
 * A duração configurada controla apenas o giro; o bumerangue tem sempre o
 * mesmo tempo para não ficar mais rápido/lento conforme o operador ajusta a
 * roleta.
 */
export const DRAW_BOOMERANG_MS = 2500;

/** Faixa aceita pelo wheel; o módulo usa os mesmos limites para o timer. */
export const DRAW_DURATION_MIN_MS = 300;
export const DRAW_DURATION_MAX_MS = 60_000;
