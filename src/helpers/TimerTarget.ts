/**
 * Contas do horário-alvo dos temporizadores, sem Vue.
 *
 * O horário é digitado como "HH:mm" e não tem data. A regra abaixo decide se
 * ele é o de hoje ou o de amanhã:
 *
 * - ainda está à frente hoje: hoje;
 * - passou há até 2h: hoje, negativo (tempo excedido);
 * - passou há mais de 2h (inclusive 2–3h e >3h): amanhã.
 *
 * O limite de 2h é o que evita que um horário da manhã, definido à tarde,
 * seja tratado como “já passou” e dispare a ação “Ao terminar” ao iniciar.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Janela em que um horário já passado ainda conta como tempo excedido. */
export const NEGATIVE_WINDOW_MS = 2 * HOUR_MS;

export interface TargetTimeOptions {
  /** Sobrescreve a janela de overtime (testes e ajustes futuros). */
  negativeWindowMs?: number;
}

function parseTargetTime(targetTime: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(targetTime.trim());
  if (!match) return { hours: 0, minutes: 0 };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return {
    hours: hours >= 0 && hours <= 23 ? hours : 0,
    minutes: minutes >= 0 && minutes <= 59 ? minutes : 0,
  };
}

/** Constrói a data-alvo a partir de "HH:mm", aplicando a regra de hoje/amanhã. */
export function resolveTargetDate(
  targetTime: string,
  now: Date = new Date(),
  opts: TargetTimeOptions = {}
): Date {
  const { hours, minutes } = parseTargetTime(targetTime);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  const ago = now.getTime() - target.getTime();
  const negativeWindow = opts.negativeWindowMs ?? NEGATIVE_WINDOW_MS;
  if (ago > negativeWindow) target.setDate(target.getDate() + 1);

  return target;
}

/** Segundos até o alvo; negativo significa que o horário já passou. */
export function secondsUntilTarget(
  targetTime: string,
  now: number = Date.now(),
  opts: TargetTimeOptions = {}
): number {
  const target = resolveTargetDate(targetTime, new Date(now), opts);
  return Math.ceil((target.getTime() - now) / 1000);
}
