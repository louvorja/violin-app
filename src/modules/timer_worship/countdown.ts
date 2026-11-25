/**
 * Contas do Temporizador de Culto, sem Vue: o componente guarda um
 * `CountdownState`, chama estas funções com a hora do relógio e reage aos
 * eventos devolvidos (tocar a abertura, os avisos, a ação "Ao terminar").
 *
 * Tudo gira em torno de dois números:
 * - `endAt`: o instante (ms) em que a contagem chega a zero, enquanto roda;
 * - `frozenLeft`: os segundos que faltavam quando pausou.
 *
 * "Definir por hora de término": o tempo não para quando se pausa — o culto
 * acaba no mesmo horário —, então retomar volta a ler `endAt`.
 * "Definir por duração": pausar congela, e retomar continua de onde parou.
 *
 * Mantido puro de propósito: as combinações que já deram problema (pausar e
 * somar minutos, desligar o tempo excedido no meio dele, retomar depois do
 * fim, trocar de modo) ficam cobertas por teste com relógio falso.
 */
import { secondsUntilTarget } from "@/helpers/TimerTarget";

export type CountdownMode = "up" | "down";
export type CountdownDefineBy = "end" | "duration";

export interface CountdownConfig {
  mode: CountdownMode;
  defineBy: CountdownDefineBy;
  /** "HH:MM" — usado em `defineBy: "end"`. */
  target: string;
  /** Minutos — usado em `defineBy: "duration"`. */
  durationMinutes: number;
  /** Seguir contando depois do zero (-00:00:01…), só no regressivo. */
  overtime: boolean;
  /** Avisos extras: segundos restantes em que cada um toca (regressivo). */
  marks?: number[];
}

export interface CountdownState {
  /** Já foi iniciado desde o último "Reiniciar". */
  started: boolean;
  running: boolean;
  /** Instante do zero, enquanto roda (ms). */
  endAt: number;
  /** Segundos que faltavam ao pausar. */
  frozenLeft: number;
  /** Tempo total desta contagem (para o progressivo), em segundos. */
  total: number;
  /** O que a tela mostra, em segundos (negativo = tempo excedido). */
  seconds: number;
  /** Já chegou ao zero (a ação "Ao terminar" já foi disparada). */
  alarmed: boolean;
  fiveFired: boolean;
  oneFired: boolean;
  /** Segundos que faltavam no tick anterior — os avisos tocam ao cruzar a marca. */
  lastLeft: number | null;
}

/** `mark:600` = aviso extra marcado para faltando 10 min. */
export type CountdownEvent = "start" | "five" | "one" | "end" | `mark:${number}`;

/**
 * Os avisos tocam 10 s antes da marca, como no Classic ('00:05:10' e
 * '00:01:10'): a locução termina junto com o 5:00 e o 1:00.
 */
export const SOUND_LEAD_SECONDS = 10;
export const FIVE_MIN_CUE = 300 + SOUND_LEAD_SECONDS;
export const ONE_MIN_CUE = 60 + SOUND_LEAD_SECONDS;

const MINUTES_PER_DAY = 24 * 60;

export function createCountdownState(): CountdownState {
  return {
    started: false,
    running: false,
    endAt: 0,
    frozenLeft: 0,
    total: 0,
    seconds: 0,
    alarmed: false,
    fiveFired: false,
    oneFired: false,
    lastLeft: null,
  };
}

/** Segundo cheio para baixo: a contagem vira junto com o relógio do sistema. */
export function wholeSecond(now: number): number {
  return Math.floor(now / 1000) * 1000;
}

/** Segundos até `endAt`, arredondados para cima (09:59:50 com fim às 10:00 → 10). */
function secondsLeft(endAt: number, now: number): number {
  // `|| 0` troca o -0 (Math.ceil de -0,3) por 0.
  return Math.ceil((endAt - now) / 1000) || 0;
}

/** Quanto falta agora, rodando ou pausado. */
export function currentLeft(state: CountdownState, cfg: CountdownConfig, now: number): number {
  if (!state.started) return idleLeft(cfg, now);
  return state.running ? secondsLeft(state.endAt, now) : state.frozenLeft;
}

/** O que faltaria se iniciasse agora (prévia antes do "Iniciar"). */
function idleLeft(cfg: CountdownConfig, now: number): number {
  if (cfg.defineBy === "duration") return cfg.durationMinutes * 60;
  return Math.max(0, secondsUntilTarget(cfg.target, wholeSecond(now)));
}

function displaySeconds(state: CountdownState, cfg: CountdownConfig, left: number): number {
  if (cfg.mode === "up") return Math.min(Math.max(state.total - left, 0), state.total);
  return cfg.overtime ? left : Math.max(left, 0);
}

/** Prévia parada: o tempo que a contagem vai começar mostrando. */
export function refreshIdle(state: CountdownState, cfg: CountdownConfig, now: number): void {
  if (state.started) return;
  const left = idleLeft(cfg, now);
  state.total = left;
  state.seconds = cfg.mode === "down" ? left : 0;
}

export function reset(state: CountdownState, cfg: CountdownConfig, now: number): void {
  Object.assign(state, createCountdownState());
  refreshIdle(state, cfg, now);
}

/**
 * A contagem acabou e parou sozinha (progressivo, ou regressivo sem tempo
 * excedido)? Aí "Iniciar" recomeça do zero em vez de retomar.
 */
function finished(state: CountdownState, cfg: CountdownConfig): boolean {
  return state.alarmed && (cfg.mode === "up" || !cfg.overtime) && state.frozenLeft <= 0;
}

export function start(state: CountdownState, cfg: CountdownConfig, now: number): CountdownEvent[] {
  if (state.running) return [];

  if (state.started && !finished(state, cfg)) {
    // Retomar. Por duração, continua de onde parou; por hora de término, o
    // relógio andou durante a pausa e `endAt` continua valendo.
    if (cfg.defineBy === "duration") {
      state.endAt = Math.round(now / 1000) * 1000 + state.frozenLeft * 1000;
    }
    state.running = true;
    state.lastLeft = secondsLeft(state.endAt, now);
    // Pausado e ajustado para abaixo do zero: resolve já, sem esperar o tick.
    return tick(state, cfg, now);
  }

  const startAt = wholeSecond(now);
  let left: number;
  if (cfg.defineBy === "duration") {
    left = cfg.durationMinutes * 60;
    state.endAt = Math.round(now / 1000) * 1000 + left * 1000;
  } else {
    left = secondsUntilTarget(cfg.target, startAt);
    // Regressivo aceita horário já passado: começa no excedido, ou no zero sem ele.
    if (left < 0 && !(cfg.mode === "down" && cfg.overtime)) left = 0;
    state.endAt = startAt + left * 1000;
  }

  state.started = true;
  state.running = true;
  state.alarmed = false;
  state.fiveFired = false;
  state.oneFired = false;
  state.total = Math.max(left, 0);
  state.frozenLeft = left;
  state.lastLeft = left;
  state.seconds = displaySeconds(state, cfg, left);
  return ["start", ...tick(state, cfg, now)];
}

export function pause(state: CountdownState, cfg: CountdownConfig, now: number): void {
  if (!state.running) return;
  state.frozenLeft = secondsLeft(state.endAt, now);
  state.running = false;
  state.seconds = displaySeconds(state, cfg, state.frozenLeft);
}

/** Um segundo do relógio: atualiza a tela e diz o que tocar. */
export function tick(state: CountdownState, cfg: CountdownConfig, now: number): CountdownEvent[] {
  if (!state.started) {
    refreshIdle(state, cfg, now);
    return [];
  }
  if (!state.running) return [];

  const left = secondsLeft(state.endAt, now);
  const prev = state.lastLeft;
  state.lastLeft = left;
  state.seconds = displaySeconds(state, cfg, left);
  const events: CountdownEvent[] = [];

  if (left <= 0) {
    if (!state.alarmed) {
      state.alarmed = true;
      events.push("end");
      // O progressivo para no total; o regressivo só segue com tempo excedido.
      if (cfg.mode === "up" || !cfg.overtime) {
        pause(state, cfg, now);
        state.frozenLeft = Math.min(state.frozenLeft, 0);
      }
    }
    return events;
  }

  if (cfg.mode !== "down" || state.alarmed || prev === null) return events;

  if (!state.fiveFired && prev > FIVE_MIN_CUE && left <= FIVE_MIN_CUE) {
    state.fiveFired = true;
    // Caiu direto abaixo do aviso de 1 min? Esse é o que vale.
    if (left > ONE_MIN_CUE) events.push("five");
  }
  if (!state.oneFired && prev > ONE_MIN_CUE && left <= ONE_MIN_CUE) {
    state.oneFired = true;
    events.push("one");
  }
  // Avisos extras: tocam na marca exata, só ao passar por ela — como os fixos,
  // ganhar tempo e passar de novo toca de novo; tirar tempo pula sem tocar.
  for (const mark of cfg.marks ?? []) {
    if (mark > 0 && prev > mark && left <= mark) events.push(`mark:${mark}`);
  }
  return events;
}

/** "HH:MM" deslocado em minutos, dando a volta na meia-noite. */
export function shiftTarget(target: string, deltaMinutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(target.trim());
  const base = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  const total = (((base + deltaMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface AdjustResult {
  /** Novo horário de término a salvar (definir por hora de término). */
  target?: string;
  /** Nova duração a salvar (definir por duração, ainda não iniciado). */
  durationMinutes?: number;
}

/**
 * ±1/5/10 min sem parar nem zerar. Rodando ou pausado, mexe nesta contagem;
 * parado, mexe na configuração. Os avisos que ficaram para trás voltam a valer
 * quando se ganha tempo, mas tirar tempo nunca toca um aviso fora de hora:
 * passar de 6 para 1 min não toca o "5 minutos".
 */
export function adjust(
  state: CountdownState,
  cfg: CountdownConfig,
  deltaMinutes: number,
  now: number
): AdjustResult {
  if (!deltaMinutes) return {};
  const delta = deltaMinutes * 60;
  const result: AdjustResult = {};

  if (cfg.defineBy === "end") result.target = shiftTarget(cfg.target, deltaMinutes);

  if (!state.started) {
    if (cfg.defineBy === "duration") {
      result.durationMinutes = Math.max(1, cfg.durationMinutes + deltaMinutes);
    }
    refreshIdle(state, { ...cfg, ...result }, now);
    return result;
  }

  // Por hora de término o fim é um horário: anda junto mesmo pausado, porque
  // retomar volta a ler `endAt`. Por duração, pausado vale o que estava congelado.
  if (state.running || cfg.defineBy === "end") state.endAt += delta * 1000;
  if (!state.running) state.frozenLeft += delta;
  state.total = Math.max(0, state.total + delta);

  const left = currentLeft(state, cfg, now);
  state.lastLeft = left;
  if (left > 0) state.alarmed = false;
  if (left > FIVE_MIN_CUE) state.fiveFired = false;
  if (left > ONE_MIN_CUE) state.oneFired = false;
  state.seconds = displaySeconds(state, cfg, left);
  return result;
}

/**
 * Desligar o tempo excedido no meio dele: a contagem vai a 00:00:00 e para.
 * Sem isto ela ficava em "Pausar" com o display congelado.
 */
export function overtimeTurnedOff(state: CountdownState, cfg: CountdownConfig, now: number): void {
  if (cfg.mode !== "down" || !state.started) return;
  if (currentLeft(state, cfg, now) > 0) return;
  pause(state, cfg, now);
  state.frozenLeft = 0;
  state.alarmed = true;
  state.seconds = 0;
}

/** Hora em que a contagem chega a zero, "HH:MM" — a linha abaixo da contagem. */
export function endTimeText(state: CountdownState, cfg: CountdownConfig, now: number): string {
  if (cfg.defineBy === "end") return cfg.target;
  const at = state.running ? state.endAt : now + currentLeft(state, cfg, now) * 1000;
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
