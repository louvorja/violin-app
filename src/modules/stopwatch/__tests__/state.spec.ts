import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";

const h = vi.hoisted(() => ({ data: new Map<string, unknown>(), sent: [] as unknown[][] }));

vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => (h.data.has(key) ? h.data.get(key) : fallback),
    set: (key: string, value: unknown) => h.data.set(key, value),
  },
}));

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: (...args: unknown[]) => h.sent.push(args),
    listen: vi.fn(() => () => {}),
  },
}));

vi.mock("@helpers/AudioBeep", () => ({ playBeep: vi.fn() }));

vi.mock("../projection", () => ({
  isStopwatchProjecting: vi.fn(async () => false),
  projectStopwatch: vi.fn(async () => {}),
  unprojectStopwatch: vi.fn(async () => {}),
}));

const {
  _resetForTests,
  clearLaps,
  ensureStopwatchLoaded,
  lap,
  laps,
  pause,
  resetAll,
  running,
  snapshot,
  start,
} = await import("../state");

describe("estado do Cronômetro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.sent.length = 0;
    h.data.clear();
    h.data.set(KEYS.MODULES.STOPWATCH.MODE, "up");
    h.data.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, 600);
    _resetForTests();
    ensureStopwatchLoaded();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("conta, pausa e mantém o tempo congelado", () => {
    start();
    expect(running.value).toBe(true);
    vi.advanceTimersByTime(1500);

    pause();
    expect(running.value).toBe(false);
    const frozen = snapshot();
    expect(frozen.running).toBe(false);
    expect(frozen.mode).toBe("countup");
    expect(frozen.elapsed).toBeGreaterThanOrEqual(1.4);
    expect(frozen.elapsed).toBeLessThan(1.8);

    vi.advanceTimersByTime(2000);
    expect(snapshot().elapsed).toBeCloseTo(frozen.elapsed, 2);
  });

  it("registra voltas com índice, tempo total e display", () => {
    start();
    vi.advanceTimersByTime(1200);
    lap();
    vi.advanceTimersByTime(800);
    lap();

    expect(laps.value).toHaveLength(2);
    expect(laps.value[0].index).toBe(1);
    expect(laps.value[1].index).toBe(2);
    expect(laps.value[1].elapsed).toBeGreaterThan(laps.value[0].elapsed);
    expect(laps.value.every((item) => Number.isInteger(item.shown))).toBe(true);
    expect(snapshot().laps).toHaveLength(2);
  });

  it("lap parado em zero não cria volta", () => {
    lap();
    expect(laps.value).toHaveLength(0);
  });

  it("resetAll zera tempo e voltas", () => {
    start();
    vi.advanceTimersByTime(1100);
    lap();
    pause();
    expect(laps.value).toHaveLength(1);

    resetAll();
    expect(running.value).toBe(false);
    expect(laps.value).toHaveLength(0);
    expect(snapshot().elapsed).toBe(0);
    expect(snapshot().running).toBe(false);
  });

  it("clearLaps limpa só as voltas", () => {
    start();
    vi.advanceTimersByTime(1100);
    lap();
    pause();
    const frozen = snapshot().elapsed;

    clearLaps();
    expect(laps.value).toHaveLength(0);
    expect(snapshot().elapsed).toBeCloseTo(frozen, 2);
  });

  it("emite snapshot e projeção via broadcast", () => {
    start();
    vi.advanceTimersByTime(1100);

    const types = h.sent.map(([type]) => type);
    expect(types).toContain("stopwatch_state");
    expect(types).toContain("module_projection_intent");

    const stateEvents = h.sent.filter(([type]) => type === "stopwatch_state");
    expect(stateEvents.at(-1)?.[1]).toMatchObject({ running: true, mode: "countup" });

    const first = snapshot();
    const second = snapshot();
    expect(second.seq).toBeGreaterThan(first.seq);
  });
});
