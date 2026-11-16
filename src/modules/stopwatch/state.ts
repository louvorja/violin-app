/**
 * Estado compartilhado do **Cronômetro**.
 *
 * Antes tudo vivia em `components/Index.vue`: fechar a janela zerava a
 * contagem e o controle remoto não tinha como operar o cronômetro com a
 * janela fechada. Aqui o estado é um singleton do renderer, carregado sob
 * demanda (o `main-shell` só toca nele quando chega um comando HTTP), como o
 * Sorteio. A configuração continua no `UserData`, que é a fonte da verdade
 * entre janelas/reinícios; a sessão (tempo, voltas) fica em memória — abrir o
 * app começa um cronômetro novo, igual antes.
 *
 * A projeção também é emitida daqui: assim o telão continua atualizando mesmo
 * quando a janela do módulo está fechada, e a API/SSE enxergam o mesmo estado.
 */
import { computed, reactive, ref, watch } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import UserData from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { playBeep } from "@helpers/AudioBeep";
import {
  isStopwatchProjecting,
  projectStopwatch,
  unprojectStopwatch,
} from "./projection";
import {
  elapsedMs,
  endsAtLabel,
  formatStopwatch,
  shownSeconds,
  stopwatchAlert,
  stopwatchProgress,
} from "./stopwatchClock";

export type StopwatchMode = "up" | "down";
export type StopwatchAlert = "" | "warning" | "danger";

/** Volta registrada: `elapsed` é o total e `shown` o que estava no display. */
export interface StopwatchLap {
  index: number;
  elapsed: number;
  shown: number;
}

/** Estado exposto pela API/SSE (`/api/stopwatch`). */
export interface StopwatchSnapshot {
  running: boolean;
  mode: "countup" | "countdown";
  elapsed: number;
  target: number | null;
  remaining: number | null;
  alert: StopwatchAlert;
  overtime: boolean;
  showSeconds: boolean;
  warningSeconds: number;
  laps: StopwatchLap[];
  /** O cronômetro está no telão (janela ou camada da Projeção de Fundo)? */
  projecting: boolean;
  seq: number;
}

const MODULE_ID = "stopwatch";
const TICK_MS = 250;
/** Uma emissão por segundo basta para os clientes; a UI pinta a 250 ms. */
const STATE_EMIT_MS = 1000;
const RUNNING_KEY = KEYS.MODULES.STOPWATCH.RUNNING;
/** Mesmo limite do contrato da API/SSE (`events.js`/`playerRoutes.js`). */
const MAX_LAPS = 1_000;

/** Configuração vinda do `UserData` (reativa — a ribbon também grava aqui). */
export const mode = computed<StopwatchMode>(() =>
  UserData.get<string>(KEYS.MODULES.STOPWATCH.MODE, "up") === "down" ? "down" : "up"
);
export const targetSeconds = computed(() =>
  Math.max(0, Number(UserData.get(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, 600)) || 0)
);
export const showSeconds = computed(
  () => UserData.get<boolean>(KEYS.MODULES.STOPWATCH.SHOW_SECONDS, true) !== false
);
export const overtime = computed(
  () => UserData.get<boolean>(KEYS.MODULES.STOPWATCH.COUNT_OVERTIME, true) !== false
);
export const warningSeconds = computed(() =>
  Math.max(0, Number(UserData.get(KEYS.MODULES.STOPWATCH.WARNING_SECONDS, 60)) || 0)
);
export const flashBorders = computed(
  () => UserData.get<boolean>(KEYS.MODULES.STOPWATCH.FLASH_BORDERS, true) !== false
);

const run = reactive<{ baseMs: number; startedAt: number | null }>({
  baseMs: 0,
  startedAt: null,
});
const now = ref(Date.now());
export const running = ref(false);
const reachedEnd = ref(false);
export const laps = ref<StopwatchLap[]>([]);
export const projecting = ref(false);

let tickTimer: ReturnType<typeof setInterval> | null = null;
let projectionTimer: ReturnType<typeof setInterval> | null = null;
let emitTimer: ReturnType<typeof setInterval> | null = null;
let loaded = false;
let seq = 0;
/** Marca a próxima mudança de meta como extensão, não como recomeço. */
let extendTo: number | null = null;

export const elapsed = computed(() =>
  elapsedMs({ baseMs: run.baseMs, startedAt: run.startedAt }, now.value)
);
export const seconds = computed(() =>
  shownSeconds(mode.value, targetSeconds.value, elapsed.value, overtime.value)
);
export const display = computed(() =>
  formatStopwatch(seconds.value, showSeconds.value, mode.value === "down")
);
export const alert = computed<StopwatchAlert>(() =>
  stopwatchAlert(
    mode.value,
    seconds.value,
    warningSeconds.value,
    reachedEnd.value,
    // Começou = está contando ou já contou algo (pausado no meio ainda avisa).
    running.value || elapsed.value > 0
  )
);
export const progress = computed(() => stopwatchProgress(targetSeconds.value, elapsed.value));
export const targetLabel = computed(() => formatStopwatch(targetSeconds.value, true));
export const endsAt = computed(() =>
  running.value && mode.value === "down" && seconds.value > 0
    ? endsAtLabel(now.value, seconds.value)
    : ""
);

/**
 * Cor do aviso/alerta lida direto do `UserData` (as mesmas chaves que a
 * Formatação grava). Usada na prévia e na projeção para as duas nunca
 * ficarem com cores diferentes.
 */
export const alertColor = computed<string | undefined>(() => {
  const stored = (key: string, fallback: string) => {
    const value = UserData.get<string>(key, fallback);
    return typeof value === "string" && value ? value : fallback;
  };
  if (alert.value === "danger") {
    return stored(`modules.${MODULE_ID}.alert_color`, "#E74C3C");
  }
  if (alert.value === "warning") {
    return stored(`modules.${MODULE_ID}.warning_color`, "#F59E0B");
  }
  return undefined;
});

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function playAlarm(): void {
  try {
    playBeep(880, 0.25, 0.5, 0);
    playBeep(880, 0.25, 0.5, 0.3);
    playBeep(1100, 0.4, 0.5, 0.6);
  } catch {
    /* noop */
  }
}

/** Projeção: texto/alertas do estado, sem depender da janela estar aberta. */
export function emitProjection(): void {
  Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_INTENT, {
    module: MODULE_ID,
    text: display.value,
    active: true,
    color: alertColor.value,
    alert: flashBorders.value && alert.value ? alert.value : undefined,
  });
}

/** Snapshot da API/SSE. Cada chamada avança o `seq` (monotônico). */
export function snapshot(): StopwatchSnapshot {
  const elapsedSeconds = elapsed.value / 1000;
  const target = mode.value === "down" ? targetSeconds.value : null;
  return {
    running: running.value,
    mode: mode.value === "down" ? "countdown" : "countup",
    elapsed: round3(elapsedSeconds),
    target: target === null ? null : round3(target),
    remaining: target === null ? null : round3(target - elapsedSeconds),
    alert: alert.value,
    overtime: overtime.value,
    showSeconds: showSeconds.value,
    // O DTO do app declara Int; `UserData` pode ter um decimal antigo.
    warningSeconds: Math.round(warningSeconds.value),
    laps: laps.value.map((lap) => ({
      index: lap.index,
      elapsed: round3(lap.elapsed),
      shown: lap.shown,
    })),
    projecting: projecting.value,
    seq: ++seq,
  };
}

function broadcastState(): void {
  Broadcast.send(BROADCAST_TYPE.STOPWATCH_STATE, snapshot());
}

function startEmitTimer(): void {
  if (emitTimer) return;
  emitTimer = setInterval(broadcastState, STATE_EMIT_MS);
}

function stopEmitTimer(): void {
  if (!emitTimer) return;
  clearInterval(emitTimer);
  emitTimer = null;
}

function scheduleTick(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTick(): void {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function tick(): void {
  now.value = Date.now();
  if (mode.value !== "down" || reachedEnd.value) return;
  const done = Math.floor(elapsed.value / 1000);
  if (done < targetSeconds.value) return;
  reachedEnd.value = true;
  playAlarm();
  // Sem tempo excedido a contagem termina aqui, como sempre foi.
  if (!overtime.value) pause();
}

export function start(): void {
  ensureStopwatchLoaded();
  if (running.value) return;
  // Regressivo que já terminou recomeça do início, não do zero parado.
  if (mode.value === "down" && reachedEnd.value && !overtime.value) resetCount();
  run.startedAt = Date.now();
  running.value = true;
  UserData.set(RUNNING_KEY, true);
  scheduleTick();
  tick();
  startEmitTimer();
  broadcastState();
  emitProjection();
}

export function pause(): void {
  if (run.startedAt !== null) {
    run.baseMs = elapsedMs(run, Date.now());
    run.startedAt = null;
  }
  running.value = false;
  UserData.set(RUNNING_KEY, false);
  stopTick();
  stopEmitTimer();
  now.value = Date.now();
  broadcastState();
  emitProjection();
}

export function toggle(): void {
  if (running.value) pause();
  else start();
}

function resetCount(): void {
  run.baseMs = 0;
  run.startedAt = running.value ? Date.now() : null;
  reachedEnd.value = false;
  now.value = Date.now();
}

/** Zera só o tempo (usado por troca de modo/meta), mantendo as voltas. */
export function resetTime(): void {
  pause();
  resetCount();
  broadcastState();
  emitProjection();
}

/** Botão “Reiniciar”/API: zera o tempo **e** as voltas. */
export function resetAll(): void {
  pause();
  resetCount();
  laps.value = [];
  broadcastState();
  emitProjection();
}

export function clearLaps(): void {
  if (laps.value.length === 0) return;
  laps.value = [];
  broadcastState();
}

/**
 * Registra a volta atual. `shown` é o que está no display (no regressivo, o
 * tempo restante), para a lista mostrar exatamente o que o operador viu.
 */
export function lap(): void {
  ensureStopwatchLoaded();
  if (!running.value && elapsed.value <= 0) return;
  // Acima do limite o snapshot deixaria de ser válido para os clientes.
  if (laps.value.length >= MAX_LAPS) return;
  laps.value = [
    ...laps.value,
    {
      index: laps.value.length + 1,
      elapsed: elapsed.value / 1000,
      shown: seconds.value,
    },
  ];
  broadcastState();
}

export function setMode(value: StopwatchMode): void {
  ensureStopwatchLoaded();
  if (value === mode.value) return;
  UserData.set(KEYS.MODULES.STOPWATCH.MODE, value);
}

export function setWarning(total: number): void {
  UserData.set(KEYS.MODULES.STOPWATCH.WARNING_SECONDS, String(total));
}

function clampTarget(total: number): number {
  return Math.max(0, Math.min(Number(total) || 0, 99 * 3600));
}

export function setTarget(total: number): void {
  ensureStopwatchLoaded();
  const next = clampTarget(total);
  extendTo = null;
  if (next === targetSeconds.value) {
    resetTime();
    return;
  }
  UserData.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, next);
}

export function extendTarget(extraSeconds: number): void {
  ensureStopwatchLoaded();
  const next = clampTarget(targetSeconds.value + extraSeconds);
  if (next === targetSeconds.value) return;
  extendTo = next;
  UserData.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, next);
}

/** +1 min durante a contagem: a meta cresce e a contagem continua. */
export function addMinute(): void {
  extendTarget(60);
}

/**
 * Relê a projeção (janela/camada) e publica no SSE quando muda.
 *
 * A ribbon abre/fecha a projeção por conta própria; este poll mantém o estado
 * da API/app alinhado mesmo quando a ação veio do desktop.
 */
export async function refreshProjecting(): Promise<boolean> {
  try {
    const next = await isStopwatchProjecting();
    if (next !== projecting.value) {
      projecting.value = next;
      if (loaded) broadcastState();
    }
    return next;
  } catch {
    return projecting.value;
  }
}

/** API: projeta o cronômetro (janela ou camada da Projeção de Fundo). */
export async function project(): Promise<void> {
  ensureStopwatchLoaded();
  await projectStopwatch();
  await refreshProjecting();
  broadcastState();
  emitProjection();
}

/** API: encerra a projeção do cronômetro. */
export async function unproject(): Promise<void> {
  ensureStopwatchLoaded();
  await unprojectStopwatch();
  await refreshProjecting();
  broadcastState();
  emitProjection();
}

/**
 * Carrega o estado sob demanda: zera a chave `running` deixada por um app
 * fechado no meio da contagem e instala os watches de configuração/projeção.
 */
export function ensureStopwatchLoaded(): void {
  if (loaded) return;
  loaded = true;
  preventStaleRunning();
  // `flush: "sync"` mantém a resposta da API/SSE já com o tempo zerado.
  watch(mode, () => resetTime(), { flush: "sync" });
  watch(targetSeconds, (next) => {
    const isExtension = extendTo !== null && next === extendTo;
    extendTo = null;
    if (isExtension) {
      // `seconds` já reflete a meta nova: se voltou a sobrar tempo, sai do vermelho.
      if (seconds.value > 0) reachedEnd.value = false;
      emitProjection();
      return;
    }
    resetTime();
  }, { flush: "sync" });
  watch(overtime, (on) => {
    // Desligar o excedido passado do zero precisa parar o relógio.
    if (!on && reachedEnd.value && running.value) pause();
  }, { flush: "sync" });
  watch([display, alert, flashBorders, alertColor], emitProjection, { immediate: true });
  // A projeção pode ser aberta/fechada pela ribbon; mantém o estado coerente
  // para a API/SSE sem depender de um GET do cliente.
  void refreshProjecting();
  projectionTimer = setInterval(() => void refreshProjecting(), 2_000);
  broadcastState();
}

function preventStaleRunning(): void {
  // O app pode ter sido fechado com a contagem rodando: a chave ficava "true"
  // e o botão da ribbon abria em "Pausar" com nada contando.
  UserData.set(RUNNING_KEY, false);
}

/** Só para testes: devolve o singleton ao estado inicial. */
export function _resetForTests(): void {
  stopTick();
  stopEmitTimer();
  if (projectionTimer) {
    clearInterval(projectionTimer);
    projectionTimer = null;
  }
  projecting.value = false;
  running.value = false;
  reachedEnd.value = false;
  laps.value = [];
  run.baseMs = 0;
  run.startedAt = null;
  now.value = Date.now();
  seq = 0;
  extendTo = null;
  loaded = false;
}

export default {
  mode,
  targetSeconds,
  showSeconds,
  overtime,
  warningSeconds,
  flashBorders,
  running,
  laps,
  elapsed,
  seconds,
  display,
  alert,
  progress,
  targetLabel,
  endsAt,
  alertColor,
  projecting,
  start,
  pause,
  toggle,
  resetTime,
  resetAll,
  clearLaps,
  lap,
  setMode,
  setWarning,
  setTarget,
  extendTarget,
  addMinute,
  snapshot,
  ensureStopwatchLoaded,
  refreshProjecting,
  project,
  unproject,
};
