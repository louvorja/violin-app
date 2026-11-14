import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { installRouteTelemetry } from "../RouteTelemetry";

const telemetry = vi.hoisted(() => ({
  track: vi.fn(),
  log: vi.fn(),
  histogram: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/helpers/Telemetry", () => ({ default: telemetry }));

function setup() {
  const lazyError = new TypeError("Failed to fetch dynamically imported module");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/broken", component: () => Promise.reject(lazyError) },
      { path: "/slow", component: { template: "<div />" } },
    ],
  });
  installRouteTelemetry(router);
  return { router, lazyError };
}

describe("RouteTelemetry com Vue Router", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("encerra a medição na falha do import, preservando a exceção original sem timeout posterior", async () => {
    const { router, lazyError } = setup();
    await expect(router.push("/broken")).rejects.toBe(lazyError);
    expect(telemetry.captureException).toHaveBeenCalledWith(
      lazyError,
      expect.objectContaining({ source: "router", to: "/broken" })
    );
    await vi.advanceTimersByTimeAsync(10001);
    expect(telemetry.track).not.toHaveBeenCalledWith("route_transition_timeout", expect.anything());
    expect(telemetry.track).not.toHaveBeenCalledWith(
      "route_transition_completed",
      expect.anything()
    );
  });

  it("não conta navegação cancelada pelo guard como tela aberta", async () => {
    const { router } = setup();
    await router.push("/");
    vi.clearAllMocks();
    router.beforeEach(() => false);
    await router.push("/slow");
    await vi.advanceTimersByTimeAsync(10001);
    expect(router.currentRoute.value.path).toBe("/");
    expect(telemetry.track).not.toHaveBeenCalledWith("route_changed", expect.anything());
    expect(telemetry.track).not.toHaveBeenCalledWith(
      "route_transition_completed",
      expect.anything()
    );
    expect(telemetry.track).not.toHaveBeenCalledWith("route_transition_timeout", expect.anything());
  });

  it("preserva timeout real e duração de uma navegação lenta concluída", async () => {
    const { router } = setup();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    router.beforeResolve(() => {
      entered();
      return waiting;
    });
    const navigation = router.push("/slow");
    await ready;
    await vi.advanceTimersByTimeAsync(10001);
    expect(telemetry.track).toHaveBeenCalledWith("route_transition_timeout", {
      to: "/slow",
      timeout_ms: 10000,
    });
    release();
    await navigation;
    expect(telemetry.track).toHaveBeenCalledWith(
      "route_transition_completed",
      expect.objectContaining({ to: "/slow", duration_ms: 10001 })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancelar uma tentativa não encerra o timer da nova tentativa para a mesma URL", async () => {
    const { router } = setup();
    const releases: Array<() => void> = [];
    router.beforeResolve(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        })
    );
    const first = router.push("/slow");
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    const second = router.push("/slow");
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(2);
    releases[0]();
    await first;
    await vi.advanceTimersByTimeAsync(5000);
    expect(telemetry.track).not.toHaveBeenCalledWith("route_transition_timeout", expect.anything());
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      telemetry.track.mock.calls.filter(([event]) => event === "route_transition_timeout")
    ).toHaveLength(1);
    releases[1]();
    await second;
    expect(telemetry.track).toHaveBeenCalledWith(
      "route_transition_completed",
      expect.objectContaining({ duration_ms: 10000 })
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
