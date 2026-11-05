import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";

const h = vi.hoisted(() => ({ data: new Map<string, unknown>() }));

vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) =>
      h.data.has(key) ? h.data.get(key) : fallback,
    set: (key: string, value: unknown) => h.data.set(key, value),
  },
}));

vi.mock("@/helpers/Broadcast", () => ({
  default: { send: vi.fn(), listen: vi.fn(() => () => {}) },
}));

const {
  addNames,
  draw,
  drawState,
  ensureDrawLoaded,
  reset,
  setMode,
  setRange,
  snapshot,
} = await import("../state");

describe("estado do Sorteio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.data.clear();
    h.data.set(KEYS.MODULES.DRAW.EFFECT_DURATION, 300);
    h.data.set(KEYS.MODULES.DRAW.RANDOM_FINISH, false);
    drawState.loaded = false;
    drawState.names = [];
    drawState.current = null;
    drawState.wheel = null;
    drawState.animating = false;
    drawState.running = false;
    drawState.drawnNumbers = [];
    drawState.drawnNames = [];
    ensureDrawLoaded();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sorteia nomes e remove o escolhido do pool", async () => {
    setMode("names");
    addNames(["Ana", "Bia"]);
    const pending = draw();
    await vi.advanceTimersByTimeAsync(1_000);
    const state = await pending;
    expect(["Ana", "Bia"]).toContain(state.current);
    expect(state.drawn).toHaveLength(1);
    expect(state.remaining).toBe(1);
    expect(drawState.animating).toBe(false);
  });

  it("não conta sorteados fora do intervalo atual", async () => {
    setMode("number");
    setRange(1, 2);
    const pending = draw();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    setRange(3, 4);
    const state = snapshot();
    expect(state.drawn).toHaveLength(1);
    expect(state.total).toBe(2);
    expect(state.remaining).toBe(2);
    expect(state.canDraw).toBe(true);
  });

  it("recusa intervalo fora do safe integer/32 bits", () => {
    expect(setRange(1e20, 1e20)).toBe(false);
    expect(setRange(3_000_000_000, 3_000_000_001)).toBe(false);
    expect(snapshot().range).toEqual({ min: 1, max: 100 });
  });

  it("recusa mudanças de configuração durante a roda", async () => {
    setMode("number");
    setRange(1, 3);
    const pending = draw();
    expect(setRange(4, 5)).toBe(false);
    expect(setMode("names")).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
  });

  it("reinicia e libera todo o intervalo", async () => {
    setMode("number");
    setRange(1, 2);
    const pending = draw();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(snapshot().remaining).toBe(1);

    reset();
    expect(snapshot().remaining).toBe(2);
    expect(snapshot().current).toBeNull();
  });
});
