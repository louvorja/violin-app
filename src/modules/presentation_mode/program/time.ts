import type { Program, ProgramItem } from "@/types/Presentation";

/**
 * Relógio do programa. Tudo em minutos desde a meia-noite, com fração: o
 * delta de um culto atrasado precisa dos segundos para não saltar de minuto
 * em minuto na tela.
 *
 * O culto não atravessa a meia-noite; os horários exibidos só dão a volta no
 * relógio por segurança.
 */

const MINUTES_PER_DAY = 24 * 60;

export function parseHHMM(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const total = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `8m`, `1h12m`, `2h`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}

export function minutesOfDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function flattenItems(program: Program): ProgramItem[] {
  return program.sessions.flatMap((s) => s.items);
}

function itemMinutes(item: ProgramItem): number {
  return Math.max(0, Number(item.plannedMinutes) || 0);
}

export function totalMinutes(program: Program): number {
  return flattenItems(program).reduce((sum, item) => sum + itemMinutes(item), 0);
}

export function sessionMinutes(program: Program, sessionId: string): number {
  const session = program.sessions.find((s) => s.id === sessionId);
  return session ? session.items.reduce((sum, item) => sum + itemMinutes(item), 0) : 0;
}

/** Horário previsto de cada item: início do programa + as durações anteriores. */
export function plannedStarts(program: Program): Map<string, number> {
  const starts = new Map<string, number>();
  let cursor = parseHHMM(program.plannedStart) ?? 0;
  for (const item of flattenItems(program)) {
    starts.set(item.id, cursor);
    cursor += itemMinutes(item);
  }
  return starts;
}

/** Início de cada sessão — o do primeiro item, ou onde a anterior terminou. */
export function sessionStarts(program: Program): Map<string, number> {
  const starts = new Map<string, number>();
  let cursor = parseHHMM(program.plannedStart) ?? 0;
  for (const session of program.sessions) {
    starts.set(session.id, cursor);
    cursor += session.items.reduce((sum, item) => sum + itemMinutes(item), 0);
  }
  return starts;
}

export type ForecastStatus = "late" | "early" | "on_time";

export interface ProgramForecast {
  plannedEnd: number;
  forecastEnd: number;
  /** Positivo = atrasado. */
  deltaMinutes: number;
  status: ForecastStatus;
}

export interface ForecastInput {
  /**
   * Agora, em minutos do dia — ou `null` quando o relógio não se aplica
   * (programa de outra data): aí o previsto é o planejado.
   */
  now: number | null;
  liveItemId: string | null;
  /** Quando o item ao vivo entrou no ar, em minutos do dia. */
  liveStartedAt: number | null;
  doneIds: ReadonlySet<string>;
}

/**
 * Término previsto = agora + o que falta do item ao vivo + tudo que vem depois.
 *
 * Sem item ao vivo, o programa ainda não começou (ou está entre itens): o que
 * resta é o que não foi concluído, a partir de agora ou do início planejado,
 * o que vier depois. Um item que estourou a duração conta como zero restante —
 * o atraso já está no relógio.
 */
export function forecast(program: Program, input: ForecastInput): ProgramForecast {
  const items = flattenItems(program);
  const start = parseHHMM(program.plannedStart) ?? 0;
  const plannedEnd = start + items.reduce((sum, item) => sum + itemMinutes(item), 0);
  if (input.now === null || !items.length) {
    return { plannedEnd, forecastEnd: plannedEnd, deltaMinutes: 0, status: "on_time" };
  }

  const liveIndex = input.liveItemId ? items.findIndex((i) => i.id === input.liveItemId) : -1;
  let forecastEnd: number;
  if (liveIndex >= 0) {
    const live = items[liveIndex];
    const elapsed = input.liveStartedAt === null ? 0 : input.now - input.liveStartedAt;
    const remainingLive = Math.max(0, itemMinutes(live) - Math.max(0, elapsed));
    const after = items.slice(liveIndex + 1).reduce((sum, item) => sum + itemMinutes(item), 0);
    forecastEnd = input.now + remainingLive + after;
  } else {
    const pending = items
      .filter((item) => !input.doneIds.has(item.id))
      .reduce((sum, item) => sum + itemMinutes(item), 0);
    forecastEnd = Math.max(input.now, start) + pending;
  }

  const deltaMinutes = forecastEnd - plannedEnd;
  const status: ForecastStatus =
    Math.abs(deltaMinutes) < 1 ? "on_time" : deltaMinutes > 0 ? "late" : "early";
  return { plannedEnd, forecastEnd, deltaMinutes, status };
}
