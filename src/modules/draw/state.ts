/**
 * Estado compartilhado do **Sorteio**.
 *
 * O módulo visual, a projeção e o controle remoto (HTTP) precisam enxergar a
 * mesma sessão. Antes tudo vivia em `Index.vue`: fechar o módulo apagava o
 * histórico e o remoto não tinha como configurar o sorteio. Aqui o estado é
 * um singleton do renderer, carregado sob demanda (o `main-shell` só toca
 * nele quando chega um comando `http:draw`).
 *
 * Configuração (modo, intervalo e nomes) continua no `UserData`, que é a
 * fonte da verdade entre janelas/reinícios. O histórico da sessão fica só em
 * memória — reiniciar o app começa um sorteio novo, como antes.
 */
import { reactive } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import UserData from "@/helpers/UserData";
import type { ModuleWheelState } from "@/presentation/ModulePresentationState";
import { DRAW_DURATION_MAX_MS, DRAW_DURATION_MIN_MS } from "./constants";
import { createBoomerangPlan } from "./boomerang";

export type DrawMode = "number" | "names";

export interface DrawSnapshot {
  status: "ok";
  mode: DrawMode;
  names: string[];
  range: { min: number; max: number };
  current: string | null;
  drawn: string[];
  total: number;
  remaining: number;
  animating: boolean;
  running: boolean;
  canDraw: boolean;
}

const MAX_NAMES = 10_000;
const MAX_NAME_LENGTH = 200;
const MAX_RANGE_SPAN = 100_000;
const WHEEL_ITEMS_LIMIT = 1_000;
// O app (Int) e o iOS (Int32) compartilham este contrato; não devolva valores
// que não caibam neles.
const RANGE_INT_MIN = -2_147_483_648;
const RANGE_INT_MAX = 2_147_483_647;

export const drawState = reactive({
  loaded: false,
  mode: "number" as DrawMode,
  names: [] as string[],
  min: 1,
  max: 100,
  current: null as string | null,
  wheel: null as ModuleWheelState | null,
  animating: false,
  running: false,
  drawnNumbers: [] as number[],
  drawnNames: [] as string[],
});

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<DrawSnapshot> | null = null;
let resolvePending: ((_state: DrawSnapshot) => void) | null = null;
let listening = false;

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function intOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= RANGE_INT_MIN && parsed <= RANGE_INT_MAX
    ? parsed
    : fallback;
}

function sortedRange(min: number, max: number): { min: number; max: number } {
  let mn = intOr(min, 1);
  let mx = intOr(max, 100);
  if (mn > mx) [mn, mx] = [mx, mn];
  return { min: mn, max: mx };
}

function readNames(): string[] {
  const current = UserData.get<unknown>(KEYS.MODULES.DRAW.NAMES, null);
  const saved = current ?? UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.NAMES, null);
  if (!Array.isArray(saved)) return [];

  // Dados antigos podem ter espaços/duplicatas: a lista é usada como `key`
  // no LazyColumn do app e no pool do sorteio. Normaliza na entrada.
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of saved) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= MAX_NAMES) break;
  }
  return result;
}

function readMode(): DrawMode {
  return UserData.get<string>(KEYS.MODULES.DRAW.MODE, "number") === "names" ? "names" : "number";
}

function readRange(): { min: number; max: number } {
  const range = sortedRange(
    intOr(UserData.get(KEYS.MODULES.DRAW.RANGE_MIN, 1), 1),
    intOr(UserData.get(KEYS.MODULES.DRAW.RANGE_MAX, 100), 100)
  );
  // Configuração antiga/corrompida não pode criar um pool gigante no renderer.
  return range.max - range.min > MAX_RANGE_SPAN ? { min: 1, max: 100 } : range;
}

function cancelActiveDraw(): void {
  clearTimer();
  drawState.wheel = null;
  drawState.animating = false;
  settlePending();
}

function applyConfig(): void {
  const range = readRange();
  drawState.min = range.min;
  drawState.max = range.max;
  drawState.names = readNames();
  drawState.running =
    UserData.get<unknown>(
      KEYS.MODULES.DRAW.NAMES_RUNNING,
      UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.RUNNING, false)
    ) === true;

  // A ribbon grava o modo direto no UserData (optionKey), sem passar por
  // `setMode`; se isso acontecer no meio do giro, cancele a roda para o alvo
  // não cair no histórico do outro modo.
  const nextMode = readMode();
  if (nextMode !== drawState.mode) {
    if (drawState.animating) cancelActiveDraw();
    drawState.current = null;
    drawState.mode = nextMode;
    if (nextMode !== "names" && drawState.running) {
      drawState.running = false;
      persistRunning();
    }
  }

  // Quem vinha do módulo antigo (Sorteio de Nomes) abre no modo Nomes; quem já
  // tem uma lista no draw mantém o modo salvo (ou o padrão Números).
  const hasDrawNames = UserData.get<unknown>(KEYS.MODULES.DRAW.NAMES, null) != null;
  const hasSavedMode = UserData.get<unknown>(KEYS.MODULES.DRAW.MODE, null) != null;
  if (!hasDrawNames && drawState.names.length > 0 && !hasSavedMode) {
    drawState.mode = "names";
    UserData.set(KEYS.MODULES.DRAW.MODE, "names");
  }
}

function persistNames(): void {
  UserData.set(KEYS.MODULES.DRAW.NAMES, [...drawState.names]);
}

function persistRunning(): void {
  UserData.set(KEYS.MODULES.DRAW.NAMES_RUNNING, drawState.running);
}

function effectDuration(): number {
  const stored = UserData.get(KEYS.MODULES.DRAW.EFFECT_DURATION, null);
  const value =
    stored != null
      ? Number(stored)
      : Number(UserData.get(KEYS.MODULES.NAME_DRAW.EFFECT_DURATION, 2000));
  if (!Number.isFinite(value)) return 2000;
  return Math.max(DRAW_DURATION_MIN_MS, Math.min(DRAW_DURATION_MAX_MS, value));
}

function randomFinish(): boolean {
  return UserData.get<unknown>(KEYS.MODULES.DRAW.RANDOM_FINISH, true) !== false;
}

function showDrawnHistory(): boolean {
  const stored = UserData.get<unknown>(KEYS.MODULES.DRAW.SHOW_DRAWN_HISTORY, null);
  if (stored != null) return stored === true;
  return UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.SHOW_DRAWN, false) === true;
}

function drawnForMode(): (number | string)[] {
  return drawState.mode === "names" ? drawState.drawnNames : drawState.drawnNumbers;
}

function totalForMode(): number {
  return drawState.mode === "names"
    ? drawState.names.length
    : Math.max(0, drawState.max - drawState.min + 1);
}

function remainingForMode(): number {
  if (drawState.mode === "names") {
    const drawn = new Set(drawState.drawnNames);
    return drawState.names.reduce((remaining, name) => remaining + (drawn.has(name) ? 0 : 1), 0);
  }
  const drawn = new Set(drawState.drawnNumbers);
  let remaining = 0;
  for (let value = drawState.min; value <= drawState.max; value++) {
    if (!drawn.has(value)) remaining += 1;
  }
  return remaining;
}

function numberPool(): number[] {
  const result: number[] = [];
  const drawn = new Set(drawState.drawnNumbers);
  for (let value = drawState.min; value <= drawState.max; value++) {
    if (!drawn.has(value)) result.push(value);
  }
  return result;
}

function namePool(): string[] {
  const drawn = new Set(drawState.drawnNames);
  return drawState.names.filter((name) => !drawn.has(name));
}

function wheelWindow<T>(pool: T[], target: T): T[] {
  if (pool.length <= WHEEL_ITEMS_LIMIT) return [...pool];
  const index = Math.max(0, pool.indexOf(target));
  const first = Math.max(
    0,
    Math.min(pool.length - WHEEL_ITEMS_LIMIT, index - Math.floor(WHEEL_ITEMS_LIMIT / 2))
  );
  return pool.slice(first, first + WHEEL_ITEMS_LIMIT);
}

function emitProjection(): void {
  const history =
    drawState.wheel == null || drawState.wheel.settled === true
      ? showDrawnHistory()
        ? drawnForMode().slice(-WHEEL_ITEMS_LIMIT).map(String)
        : []
      : [];
  Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_INTENT, {
    module: "draw",
    text: drawState.current != null ? String(drawState.current) : "",
    reference: history,
    active: drawState.wheel != null || drawState.current != null,
    mode: drawState.mode,
    ...(drawState.wheel ? { wheel: drawState.wheel } : {}),
  });
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function settlePending(): void {
  const resolve = resolvePending;
  resolvePending = null;
  pending = null;
  resolve?.(snapshot());
}

/** Carrega a configuração salva e passa a acompanhar mudanças vindas da ribbon. */
export function ensureDrawLoaded(): void {
  if (drawState.loaded) return;
  applyConfig();
  // A sessão em memória não sobrevive ao reload: não deixe a ribbon com
  // "Finalizar" (running persistido) apontando para um histórico vazio.
  if (drawState.running) {
    drawState.running = false;
    persistRunning();
  }
  drawState.loaded = true;
  if (listening) return;
  listening = true;
  Broadcast.listen((message) => {
    if (message.type !== BROADCAST_TYPE.USERDATA_PATCH) return;
    const path = (message.payload as { path?: unknown } | null)?.path;
    if (typeof path !== "string") return;
    if (!path.startsWith("modules.draw.") && !path.startsWith("modules.name_draw.")) return;
    applyConfig();
    emitProjection();
  });
}

export function snapshot(): DrawSnapshot {
  const drawn = drawnForMode().map(String);
  const total = totalForMode();
  // Sorteados de um intervalo anterior não podem "comer" as opções do novo
  // intervalo: conta o pool atual, não `total - drawn.length`.
  const remaining = remainingForMode();
  return {
    status: "ok",
    mode: drawState.mode,
    names: [...drawState.names],
    range: { min: drawState.min, max: drawState.max },
    current: drawState.current,
    drawn,
    total,
    remaining,
    animating: drawState.animating,
    running: drawState.running,
    canDraw: !drawState.animating && remaining > 0,
  };
}

export function setMode(value: unknown): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  const mode: DrawMode = value === "names" ? "names" : "number";
  if (mode === drawState.mode) return true;
  clearTimer();
  drawState.wheel = null;
  drawState.animating = false;
  drawState.current = null;
  if (mode !== "names") {
    drawState.running = false;
    persistRunning();
  }
  drawState.mode = mode;
  UserData.set(KEYS.MODULES.DRAW.MODE, mode);
  settlePending();
  emitProjection();
  return true;
}

export function setRange(min: unknown, max: unknown): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  const minNumber = Number(min);
  const maxNumber = Number(max);
  if (
    !Number.isSafeInteger(minNumber) ||
    !Number.isSafeInteger(maxNumber) ||
    minNumber < RANGE_INT_MIN ||
    minNumber > RANGE_INT_MAX ||
    maxNumber < RANGE_INT_MIN ||
    maxNumber > RANGE_INT_MAX
  ) {
    return false;
  }
  const range = sortedRange(minNumber, maxNumber);
  if (range.max - range.min > MAX_RANGE_SPAN) return false;
  drawState.min = range.min;
  drawState.max = range.max;
  UserData.set(KEYS.MODULES.DRAW.RANGE_MIN, range.min);
  UserData.set(KEYS.MODULES.DRAW.RANGE_MAX, range.max);
  emitProjection();
  return true;
}

export function addName(raw: unknown): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  const name = String(raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name || drawState.names.length >= MAX_NAMES || drawState.names.includes(name)) return false;
  drawState.names.push(name);
  persistNames();
  return true;
}

/** Importação em lote (txt) — mantém a ordem e ignora duplicados. */
export function addNames(rawNames: unknown[]): number {
  ensureDrawLoaded();
  if (drawState.animating) return 0;
  let added = 0;
  for (const raw of rawNames) {
    const name = String(raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name || drawState.names.length >= MAX_NAMES) continue;
    if (drawState.names.includes(name)) continue;
    drawState.names.push(name);
    added += 1;
  }
  if (added) persistNames();
  return added;
}

export function replaceNames(rawNames: unknown[]): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  const next: string[] = [];
  for (const raw of rawNames) {
    const name = String(raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name || next.includes(name)) continue;
    next.push(name);
    if (next.length >= MAX_NAMES) break;
  }
  drawState.names = next;
  drawState.drawnNames = drawState.drawnNames.filter((name) => next.includes(name));
  if (drawState.current != null && !next.includes(drawState.current)) {
    drawState.current = null;
  }
  if (drawState.wheel && !next.includes(drawState.wheel.target)) {
    clearTimer();
    drawState.wheel = null;
    drawState.animating = false;
    settlePending();
  }
  persistNames();
  emitProjection();
  return true;
}

export function removeName(raw: unknown): boolean {
  ensureDrawLoaded();
  const name = String(raw ?? "");
  const index = drawState.names.indexOf(name);
  return index >= 0 ? removeNameAt(index) : false;
}

export function removeNameAt(index: number): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  if (!Number.isInteger(index) || index < 0 || index >= drawState.names.length) return false;
  const [removed] = drawState.names.splice(index, 1);
  if (removed == null) return false;
  drawState.drawnNames = drawState.drawnNames.filter((name) => name !== removed);
  if (drawState.wheel?.target === removed) {
    drawState.wheel = null;
    drawState.animating = false;
    clearTimer();
    settlePending();
  }
  if (drawState.current === removed) drawState.current = null;
  persistNames();
  emitProjection();
  return true;
}

export function renameNameAt(index: number, raw: unknown): boolean {
  ensureDrawLoaded();
  if (drawState.animating) return false;
  if (!Number.isInteger(index) || index < 0 || index >= drawState.names.length) return false;
  const oldName = drawState.names[index];
  const nextName = String(raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (!oldName || !nextName) return false;
  if (drawState.names.some((name, i) => i !== index && name === nextName)) return false;
  drawState.names.splice(index, 1, nextName);
  drawState.drawnNames = drawState.drawnNames.map((name) =>
    name === oldName ? nextName : name
  );
  if (drawState.wheel) {
    drawState.wheel = {
      ...drawState.wheel,
      ...(drawState.wheel.target === oldName ? { target: nextName } : {}),
      ...(drawState.wheel.items
        ? {
            items: drawState.wheel.items.map((name) =>
              name === oldName ? nextName : name
            ),
          }
        : {}),
    };
  }
  if (drawState.current === oldName) drawState.current = nextName;
  persistNames();
  emitProjection();
  return true;
}

export function setRunning(value: unknown): void {
  ensureDrawLoaded();
  drawState.running = value === true;
  persistRunning();
}

/**
 * Sorteia uma opção e resolve quando a roda assenta.
 *
 * Um segundo pedido enquanto a roda gira reaproveita a mesma promessa, para o
 * controle remoto não sortear duas vezes por um duplo toque.
 */
export function draw(): Promise<DrawSnapshot> {
  ensureDrawLoaded();
  if (pending) return pending;
  const pool: (number | string)[] =
    drawState.mode === "names" ? namePool() : numberPool();
  if (!pool.length) return Promise.resolve(snapshot());

  const picked = pool[Math.floor(Math.random() * pool.length)];
  const duration = effectDuration();
  const target = String(picked);
  const runId = uuid();
  const randomFinishEnabled = randomFinish();
  const boomerang = createBoomerangPlan(runId, randomFinishEnabled);
  const items =
    drawState.mode === "names"
      ? wheelWindow(namePool(), target)
      : wheelWindow(numberPool(), Number(target)).map(String);

  drawState.wheel = {
    run_id: runId,
    mode: drawState.mode,
    target,
    duration,
    settled: false,
    random_finish: randomFinishEnabled,
    ...(drawState.mode === "number" ? { min: drawState.min, max: drawState.max } : {}),
    items,
  };
  drawState.animating = true;
  drawState.current = null;
  drawState.running = true;
  persistRunning();
  emitProjection();

  pending = new Promise<DrawSnapshot>((resolve) => {
    resolvePending = resolve;
  });

  clearTimer();
  timer = setTimeout(
    () => {
      timer = null;
      if (!drawState.wheel) {
        settlePending();
        return;
      }
      drawState.wheel = { ...drawState.wheel, settled: true };
      drawState.animating = false;
      drawState.current = target;
      if (drawState.mode === "names") drawState.drawnNames.push(target);
      else drawState.drawnNumbers.push(Number(target));
      emitProjection();
      settlePending();
    },
    duration + boomerang.totalMs + 60
  );
  return pending;
}

export function reset(): void {
  ensureDrawLoaded();
  clearTimer();
  drawState.wheel = null;
  drawState.animating = false;
  drawState.running = false;
  persistRunning();
  if (drawState.mode === "names") drawState.drawnNames = [];
  else drawState.drawnNumbers = [];
  drawState.current = null;
  settlePending();
  emitProjection();
}

export default {
  drawState,
  ensureDrawLoaded,
  snapshot,
  setMode,
  setRange,
  addName,
  addNames,
  replaceNames,
  removeName,
  removeNameAt,
  renameNameAt,
  setRunning,
  draw,
  reset,
};
