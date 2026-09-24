"use strict";

const { randomUUID } = require("node:crypto");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

const DIAGNOSTIC_SCHEMA_VERSION = 1;
const DEFAULT_SAMPLE_INTERVAL_MS = 15_000;
const DEFAULT_CRITICAL_DELAY_MS = 1_000;
const DEFAULT_INCIDENT_COOLDOWN_MS = 60_000;
const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEATS = 32;
const MAX_RECENT_EVENTS = 24;

function _number(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(min, parsed));
}

function _integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.round(_number(value, min, max));
}

function _string(value, maxLength = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function _identifier(value, maxLength = 80) {
  return _string(value, maxLength).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function _role(value) {
  return ["main", "auxiliary", "unknown"].includes(value) ? value : "unknown";
}

function _visibility(value) {
  return ["visible", "hidden", "prerender"].includes(value) ? value : "unknown";
}

function _millisecondsFromNanoseconds(value) {
  const nanoseconds = Number(value);
  if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) return 0;
  return Math.round((nanoseconds / 1e6) * 10) / 10;
}

function _boundedOperations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => _identifier(item, 80))
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Valida o heartbeat sem confiar em ids enviados pelo renderer. O id real vem
 * de event.sender.id no main process.
 */
function normalizeHeartbeat(senderId, payload, receivedAt) {
  if (!Number.isInteger(senderId) || senderId <= 0 || !payload || typeof payload !== "object") {
    return null;
  }

  const longTasks = payload.long_tasks && typeof payload.long_tasks === "object"
    ? payload.long_tasks
    : {};

  return {
    web_contents_id: senderId,
    received_monotonic_ms: receivedAt,
    sampled_at_ms: _integer(payload.sampled_at_ms, 0, Number.MAX_SAFE_INTEGER),
    window_role: _role(payload.window_role),
    feature: _identifier(payload.feature || "unknown", 64) || "unknown",
    route: _string(payload.route || "/", 160).split("?")[0] || "/",
    visibility: _visibility(payload.visibility),
    active_operations: _boundedOperations(payload.active_operations),
    playback_id: _identifier(payload.playback_id, 120) || undefined,
    presentation_revision: Number.isInteger(payload.presentation_revision)
      ? _integer(payload.presentation_revision, 0, Number.MAX_SAFE_INTEGER)
      : undefined,
    long_task_count: _integer(longTasks.count, 0, 1_000_000),
    long_task_warn_count: _integer(longTasks.warn_count, 0, 1_000_000),
    long_task_critical_count: _integer(longTasks.critical_count, 0, 1_000_000),
    long_task_total_ms: _integer(longTasks.total_ms, 0, 60 * 60_000),
    long_task_max_ms: _integer(longTasks.max_ms, 0, 10 * 60_000),
  };
}

function createRuntimeHealthMonitor(options = {}) {
  const now = options.now || Date.now;
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const emitIncident = typeof options.emitIncident === "function" ? options.emitIncident : () => {};
  const getRuntimeSnapshot =
    typeof options.getRuntimeSnapshot === "function" ? options.getRuntimeSnapshot : () => ({});
  const createId = options.createId || randomUUID;
  const sampleIntervalMs = _integer(
    options.sampleIntervalMs || DEFAULT_SAMPLE_INTERVAL_MS,
    1_000,
    5 * 60_000,
  );
  const criticalDelayMs = _integer(
    options.criticalDelayMs || DEFAULT_CRITICAL_DELAY_MS,
    250,
    60_000,
  );
  const incidentCooldownMs = _integer(
    options.incidentCooldownMs || DEFAULT_INCIDENT_COOLDOWN_MS,
    1_000,
    60 * 60_000,
  );
  const loopDelay = options.loopDelayMonitor || monitorEventLoopDelay({ resolution: 20 });
  const appInstanceId = _identifier(options.appInstanceId || createId(), 80);
  const heartbeats = new Map();
  const watchedWindows = new Map();
  const openUnresponsive = new Map();
  const recentEvents = [];
  const appListeners = [];

  let timer = null;
  let running = false;
  let lastLoopIncidentAt = -Infinity;
  let lastLoopSample = null;
  let suppressLoopIncidentsUntil = -Infinity;
  let previousCpuUsage = process.cpuUsage();
  let previousSampleAt = monotonicNow();

  function recordEvent(type, details = {}) {
    recentEvents.push({
      at: new Date(now()).toISOString(),
      type: _identifier(type, 80),
      window_role: _role(details.window_role),
      feature: _identifier(details.feature, 64) || undefined,
      web_contents_id: Number.isInteger(details.web_contents_id)
        ? details.web_contents_id
        : undefined,
      status: _identifier(details.status, 40) || undefined,
    });
    if (recentEvents.length > MAX_RECENT_EVENTS) {
      recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
    }
  }

  function heartbeatContext(webContentsId) {
    const heartbeat = heartbeats.get(webContentsId);
    if (!heartbeat) return {};
    return {
      renderer_last_seen_ms_ago: Math.max(0, monotonicNow() - heartbeat.received_monotonic_ms),
      renderer_route: heartbeat.route,
      renderer_visibility: heartbeat.visibility,
      renderer_active_operations: heartbeat.active_operations,
      playback_id: heartbeat.playback_id,
      presentation_revision: heartbeat.presentation_revision,
      renderer_long_task_count: heartbeat.long_task_count,
      renderer_long_task_warn_count: heartbeat.long_task_warn_count,
      renderer_long_task_critical_count: heartbeat.long_task_critical_count,
      renderer_long_task_total_ms: heartbeat.long_task_total_ms,
      renderer_long_task_max_ms: heartbeat.long_task_max_ms,
    };
  }

  function runtimeSnapshot() {
    try {
      const snapshot = getRuntimeSnapshot();
      return snapshot && typeof snapshot === "object" ? snapshot : {};
    } catch (error) {
      return { snapshot_error: _string(error?.message || error, 300) };
    }
  }

  function report(incidentType, severity, details = {}) {
    const webContentsId = Number.isInteger(details.web_contents_id)
      ? details.web_contents_id
      : undefined;
    const incident = {
      diagnostic_schema_version: DIAGNOSTIC_SCHEMA_VERSION,
      incident_id: _identifier(details.incident_id || createId(), 80),
      incident_type: _identifier(incidentType, 80),
      incident_status: _identifier(details.incident_status || "detected", 40),
      severity: ["info", "warn", "error", "fatal"].includes(severity) ? severity : "error",
      observed_at: new Date(now()).toISOString(),
      app_instance_id: appInstanceId,
      main_pid: process.pid,
      main_uptime_ms: Math.round(process.uptime() * 1_000),
      window_role: _role(details.window_role),
      feature: _identifier(details.feature, 64) || "unknown",
      web_contents_id: webContentsId,
      ...heartbeatContext(webContentsId),
      ...runtimeSnapshot(),
      ...details,
      recent_runtime_events: recentEvents.slice(-10),
    };
    try {
      emitIncident(incident);
    } catch (_) {
      // Observabilidade nunca pode interromper a aplicação.
    }
    return incident;
  }

  function acceptHeartbeat(senderId, payload) {
    const receivedAt = monotonicNow();
    const previous = heartbeats.get(senderId);
    if (previous && receivedAt - previous.received_monotonic_ms < MIN_HEARTBEAT_INTERVAL_MS) {
      return false;
    }
    const heartbeat = normalizeHeartbeat(senderId, payload, receivedAt);
    if (!heartbeat) return false;

    heartbeats.delete(senderId);
    heartbeats.set(senderId, heartbeat);
    while (heartbeats.size > MAX_HEARTBEATS) {
      heartbeats.delete(heartbeats.keys().next().value);
    }
    return true;
  }

  function sampleEventLoop() {
    const sampledAt = monotonicNow();
    const elapsedMs = Math.max(1, sampledAt - previousSampleAt);
    const cpu = process.cpuUsage(previousCpuUsage);
    previousCpuUsage = process.cpuUsage();
    previousSampleAt = sampledAt;

    const sample = {
      main_loop_mean_ms: _millisecondsFromNanoseconds(loopDelay.mean),
      main_loop_p95_ms: _millisecondsFromNanoseconds(loopDelay.percentile(95)),
      main_loop_p99_ms: _millisecondsFromNanoseconds(loopDelay.percentile(99)),
      main_loop_max_ms: _millisecondsFromNanoseconds(loopDelay.max),
      main_cpu_percent: Math.round((((cpu.user + cpu.system) / 1_000) / elapsedMs) * 1_000) / 10,
      sample_window_ms: Math.round(elapsedMs),
    };
    lastLoopSample = sample;
    loopDelay.reset();

    const observedAt = now();
    if (
      sampledAt >= suppressLoopIncidentsUntil &&
      sample.main_loop_max_ms >= criticalDelayMs &&
      observedAt - lastLoopIncidentAt >= incidentCooldownMs
    ) {
      lastLoopIncidentAt = observedAt;
      recordEvent("main_event_loop_stall", { window_role: "main", status: "detected" });
      report("main_event_loop_stall", "error", {
        window_role: "main",
        feature: "main_process",
        ...sample,
        critical_budget_ms: criticalDelayMs,
      });
    }
    return sample;
  }

  function noteSystemResume() {
    suppressLoopIncidentsUntil = monotonicNow() + Math.min(sampleIntervalMs * 2, 60_000);
    previousCpuUsage = process.cpuUsage();
    previousSampleAt = monotonicNow();
    loopDelay.reset();
    recordEvent("system_resume", { window_role: "unknown", status: "observed" });
  }

  function watchWindow(win, context = {}) {
    const webContents = win?.webContents;
    const webContentsId = webContents?.id;
    if (!win || !webContents || !Number.isInteger(webContentsId) || watchedWindows.has(webContentsId)) {
      return () => {};
    }

    const windowContext = {
      window_role: _role(context.window_role),
      feature: _identifier(context.feature, 64) || "unknown",
      web_contents_id: webContentsId,
    };
    const listeners = [];
    const on = (target, event, handler) => {
      if (!target || typeof target.on !== "function") return;
      target.on(event, handler);
      listeners.push(() => target.removeListener?.(event, handler));
    };

    on(win, "unresponsive", () => {
      if (openUnresponsive.has(webContentsId)) return;
      const incident = {
        id: createId(),
        started_at: monotonicNow(),
      };
      openUnresponsive.set(webContentsId, incident);
      recordEvent("renderer_unresponsive", { ...windowContext, status: "detected" });
      report("renderer_unresponsive", "error", {
        ...windowContext,
        incident_id: incident.id,
        incident_status: "detected",
      });
    });

    on(win, "responsive", () => {
      const incident = openUnresponsive.get(webContentsId);
      if (!incident) return;
      openUnresponsive.delete(webContentsId);
      const durationMs = Math.max(0, Math.round(monotonicNow() - incident.started_at));
      recordEvent("renderer_unresponsive", { ...windowContext, status: "recovered" });
      report("renderer_unresponsive", "warn", {
        ...windowContext,
        incident_id: incident.id,
        incident_status: "recovered",
        duration_ms: durationMs,
      });
    });

    on(webContents, "render-process-gone", (_event, details = {}) => {
      openUnresponsive.delete(webContentsId);
      recordEvent("render_process_gone", { ...windowContext, status: details.reason });
      report("render_process_gone", "fatal", {
        ...windowContext,
        reason: _identifier(details.reason, 80) || "unknown",
        exit_code: Number.isInteger(details.exitCode) ? details.exitCode : undefined,
      });
    });

    const cleanup = () => {
      for (const remove of listeners.splice(0)) remove();
      watchedWindows.delete(webContentsId);
      heartbeats.delete(webContentsId);
      openUnresponsive.delete(webContentsId);
    };
    on(win, "closed", cleanup);
    watchedWindows.set(webContentsId, cleanup);
    recordEvent("renderer_registered", windowContext);
    return cleanup;
  }

  function watchApp(app) {
    if (!app || typeof app.on !== "function") return () => {};
    const handler = (_event, details = {}) => {
      const processType = _identifier(details.type, 80) || "unknown";
      recordEvent("child_process_gone", {
        window_role: "unknown",
        feature: processType,
        status: details.reason,
      });
      report("child_process_gone", processType === "GPU" ? "fatal" : "error", {
        window_role: "unknown",
        feature: processType,
        child_process_type: processType,
        reason: _identifier(details.reason, 80) || "unknown",
        exit_code: Number.isInteger(details.exitCode) ? details.exitCode : undefined,
        service_name: _identifier(details.serviceName, 120) || undefined,
        process_name: _identifier(details.name, 120) || undefined,
      });
    };
    app.on("child-process-gone", handler);
    const cleanup = () => app.removeListener?.("child-process-gone", handler);
    appListeners.push(cleanup);
    return cleanup;
  }

  function start() {
    if (running) return;
    running = true;
    loopDelay.enable();
    previousCpuUsage = process.cpuUsage();
    previousSampleAt = monotonicNow();
    timer = setInterval(sampleEventLoop, sampleIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (running) {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      loopDelay.disable();
    }
    for (const cleanup of Array.from(watchedWindows.values())) cleanup();
    for (const cleanup of appListeners.splice(0)) cleanup();
    heartbeats.clear();
    openUnresponsive.clear();
  }

  return {
    appInstanceId,
    acceptHeartbeat,
    getLastEventLoopSample: () => lastLoopSample,
    noteSystemResume,
    sampleEventLoop,
    start,
    stop,
    watchApp,
    watchWindow,
  };
}

module.exports = {
  DIAGNOSTIC_SCHEMA_VERSION,
  createRuntimeHealthMonitor,
  normalizeHeartbeat,
};
