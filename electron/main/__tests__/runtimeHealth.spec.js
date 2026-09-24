// @vitest-environment node
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createRuntimeHealthMonitor, normalizeHeartbeat } = require("../runtimeHealth.js");

const monitors = [];

afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.stop();
  vi.restoreAllMocks();
});

function fakeLoopDelay(values = {}) {
  return {
    mean: values.mean ?? 20e6,
    max: values.max ?? 30e6,
    percentile: vi.fn((percentile) => (percentile === 99 ? values.p99 ?? 25e6 : values.p95 ?? 22e6)),
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
  };
}

function makeMonitor(options = {}) {
  let wallClock = options.wallClock ?? 10_000;
  let monotonicClock = options.monotonicClock ?? 1_000;
  let nextId = 0;
  const incidents = [];
  const monitor = createRuntimeHealthMonitor({
    now: () => wallClock,
    monotonicNow: () => monotonicClock,
    createId: () => `incident-${++nextId}`,
    appInstanceId: "app-test",
    loopDelayMonitor: options.loopDelayMonitor || fakeLoopDelay(),
    emitIncident: (incident) => incidents.push(incident),
    getRuntimeSnapshot: () => options.runtimeSnapshot || ({ download_active: true }),
    sampleIntervalMs: 60_000,
    criticalDelayMs: 1_000,
    incidentCooldownMs: 60_000,
  });
  monitors.push(monitor);
  return {
    monitor,
    incidents,
    advanceWall: (milliseconds) => { wallClock += milliseconds; },
    advanceMonotonic: (milliseconds) => { monotonicClock += milliseconds; },
  };
}

function fakeWindow(id = 7) {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.webContents.id = id;
  return win;
}

describe("normalizeHeartbeat", () => {
  it("usa o sender id real, limita cardinalidade e remove query da rota", () => {
    const heartbeat = normalizeHeartbeat(12, {
      web_contents_id: 999,
      window_role: "main",
      feature: "projection/../../bad",
      route: "/projection?token=segredo",
      visibility: "visible",
      active_operations: ["bundle:extract", "video download", ...Array(10).fill("extra")],
      long_tasks: { count: 2, warn_count: 1, critical_count: 1, total_ms: 1_400, max_ms: 1_100 },
    }, 5_000);

    expect(heartbeat).toEqual(expect.objectContaining({
      web_contents_id: 12,
      feature: "projection_.._.._bad",
      route: "/projection",
      active_operations: expect.arrayContaining(["bundle:extract", "video_download"]),
      long_task_critical_count: 1,
      long_task_max_ms: 1_100,
    }));
    expect(heartbeat.active_operations).toHaveLength(8);
  });
});

describe("runtimeHealth", () => {
  it("mantém heartbeat local e o inclui somente quando ocorre incidente", () => {
    const state = makeMonitor();
    expect(state.monitor.acceptHeartbeat(7, {
      window_role: "auxiliary",
      feature: "projection",
      route: "/projection",
      visibility: "visible",
      active_operations: ["video:playback"],
      long_tasks: { count: 3, warn_count: 2, critical_count: 1, total_ms: 1_900, max_ms: 1_200 },
    })).toBe(true);
    expect(state.incidents).toHaveLength(0);

    const win = fakeWindow(7);
    state.monitor.watchWindow(win, { window_role: "auxiliary", feature: "projection" });
    win.emit("unresponsive");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toEqual(expect.objectContaining({
      incident_type: "renderer_unresponsive",
      window_role: "auxiliary",
      feature: "projection",
      renderer_route: "/projection",
      renderer_long_task_critical_count: 1,
      renderer_active_operations: ["video:playback"],
      download_active: true,
    }));
  });

  it("anexa o retrato agregado de vídeo somente ao incidente emitido", () => {
    const state = makeMonitor({
      runtimeSnapshot: {
        download_active: false,
        online_video_manager_initialized: true,
        online_video_active_count: 3,
        online_video_foreground_running: 1,
        online_video_background_running: 1,
        online_video_background_queued: 1,
        online_video_streaming: 1,
        online_video_jobs: [
          { priority: "foreground", lane: "streaming", phase: "downloading", played: true, age_bucket: "lt_10s" },
        ],
      },
    });
    expect(state.incidents).toHaveLength(0);

    const win = fakeWindow(21);
    state.monitor.watchWindow(win, { window_role: "main", feature: "main" });
    win.emit("unresponsive");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      online_video_manager_initialized: true,
      online_video_active_count: 3,
      online_video_foreground_running: 1,
      online_video_background_running: 1,
      online_video_background_queued: 1,
      online_video_streaming: 1,
      online_video_jobs: [
        { priority: "foreground", lane: "streaming", phase: "downloading", played: true, age_bucket: "lt_10s" },
      ],
    });
  });

  it("correlaciona unresponsive e recovery com o mesmo id e duração", () => {
    const state = makeMonitor();
    const win = fakeWindow(9);
    state.monitor.watchWindow(win, { window_role: "main", feature: "main" });

    win.emit("unresponsive");
    state.advanceMonotonic(2_400);
    win.emit("responsive");

    expect(state.incidents).toHaveLength(2);
    expect(state.incidents[1]).toEqual(expect.objectContaining({
      incident_id: state.incidents[0].incident_id,
      incident_status: "recovered",
      duration_ms: 2_400,
    }));
  });

  it("emite no máximo um incidente de event-loop por cooldown", () => {
    const loopDelayMonitor = fakeLoopDelay({ max: 1_500e6, p99: 1_100e6 });
    const state = makeMonitor({ loopDelayMonitor });

    state.monitor.sampleEventLoop();
    state.advanceWall(15_000);
    state.advanceMonotonic(15_000);
    state.monitor.sampleEventLoop();
    expect(state.incidents).toHaveLength(1);

    state.advanceWall(60_000);
    state.advanceMonotonic(60_000);
    state.monitor.sampleEventLoop();
    expect(state.incidents).toHaveLength(2);
    expect(state.incidents[0]).toEqual(expect.objectContaining({
      incident_type: "main_event_loop_stall",
      main_loop_max_ms: 1_500,
      critical_budget_ms: 1_000,
    }));
    expect(loopDelayMonitor.reset).toHaveBeenCalledTimes(3);
  });

  it("ignora a amostra artificial criada por suspend/resume do sistema", () => {
    const loopDelayMonitor = fakeLoopDelay({ max: 45_000e6, p99: 45_000e6 });
    const state = makeMonitor({ loopDelayMonitor });

    state.monitor.noteSystemResume();
    state.monitor.sampleEventLoop();
    expect(state.incidents).toHaveLength(0);

    state.advanceWall(61_000);
    state.advanceMonotonic(61_000);
    state.monitor.sampleEventLoop();
    expect(state.incidents).toHaveLength(1);
  });

  it("captura render crash e queda do processo GPU sem polling extra", () => {
    const state = makeMonitor();
    const win = fakeWindow(11);
    const app = new EventEmitter();
    state.monitor.watchWindow(win, { window_role: "auxiliary", feature: "file" });
    state.monitor.watchApp(app);

    win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 139 });
    app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });

    expect(state.incidents.map((incident) => incident.incident_type)).toEqual([
      "render_process_gone",
      "child_process_gone",
    ]);
    expect(state.incidents[1]).toEqual(expect.objectContaining({
      severity: "fatal",
      child_process_type: "GPU",
    }));
  });
});
