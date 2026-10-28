/**
 * Marcações de troca de slide de uma música, em segundos da faixa.
 *
 * Slide sem horário — tempo zero depois do primeiro — não tem marcação: o áudio
 * passa por ele sem exibi-lo, como no editor de slides e no LouvorJA clássico.
 * O primeiro começa em 0:00 mesmo sem horário. Sem nenhuma marcação depois do
 * primeiro, a música não está sincronizada e quem troca o slide é o operador.
 */

export function hasMarker(times: readonly number[], index: number): boolean {
  return index === 0 || times[index] > 0;
}

export function isSynced(times: readonly number[]): boolean {
  return times.some((time, index) => index > 0 && time > 0);
}

/** Slide no ar em `position`: o último marcado cujo horário já chegou. */
export function slideAt(times: readonly number[], position: number, total: number): number {
  let index = 0;
  const last = Math.min(times.length, total) - 1;
  for (let i = 1; i <= last; i++) if (hasMarker(times, i) && times[i] <= position) index = i;
  return index;
}

/** Próximo slide que entra no ar depois de `index`, ou -1. */
export function nextMarked(times: readonly number[], index: number): number {
  for (let i = index + 1; i < times.length; i++) if (hasMarker(times, i)) return i;
  return -1;
}

/** Início do slide `index`: o horário dele ou, sem horário, o do último marcado antes. */
export function slideStart(times: readonly number[], index: number): number {
  for (let i = index; i > 0; i--) if (hasMarker(times, i)) return times[i];
  return times[0] ?? 0;
}

/** Fim do slide `index`: o horário do próximo marcado, ou `fallback` (a duração da faixa). */
export function slideEnd(times: readonly number[], index: number, fallback: number): number {
  const next = nextMarked(times, index);
  return next < 0 ? fallback : times[next];
}

/**
 * Destino de uma navegação de `from` para `to`: o próprio `to`, ou o marcado
 * mais próximo no sentido do movimento. Sem nenhum, fica em `from`.
 */
export function navigableSlide(times: readonly number[], from: number, to: number): number {
  if (hasMarker(times, to)) return to;
  const step = to < from ? -1 : 1;
  for (let i = to + step; i >= 0 && i < times.length; i += step) if (hasMarker(times, i)) return i;
  return from;
}
