import type { PerformanceSpan } from "@/helpers/Telemetry";

const MAX_SPANS = 32;
const MAX_AGE_MS = 60_000;

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 10) / 10
    : undefined;
}

function label(value: unknown, limit = 120): string | undefined {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9_$.:<>-]/g, "_").slice(0, limit)
    : undefined;
}

function scriptUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:", "louvorja:"].includes(url.protocol)) return undefined;
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 512);
  } catch {
    return undefined;
  }
}

function invoker(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return scriptUrl(value);
  // `IMG[src=…].onload` traz o endereço da mídia, que pode ser um caminho local do usuário.
  return value
    .replace(/\[src=[^\]]*\]/g, "[src]")
    .replace(/[^a-zA-Z0-9_$.:#-]/g, "_")
    .slice(0, 120);
}

/** LoAF exposes script entry points, not a stack of every slow sub-function. */
export function animationFrameDiagnostic(entry: PerformanceEntry): Record<string, unknown> | null {
  const raw = entry as PerformanceEntry & Record<string, unknown>;
  if (
    entry.entryType !== "long-animation-frame" ||
    number(entry.startTime) === undefined ||
    number(entry.duration) === undefined
  )
    return null;
  const scripts = Array.isArray(raw.scripts) ? raw.scripts : [];
  return {
    attribution_scope: "script_entry_points",
    start_time_ms: number(entry.startTime),
    duration_ms: number(entry.duration),
    blocking_duration_ms: number(raw.blockingDuration),
    render_start_ms: number(raw.renderStart),
    style_layout_start_ms: number(raw.styleAndLayoutStart),
    scripts: scripts
      .slice(0, 100)
      .filter((script) => script && typeof script === "object")
      .map((script) => ({
        source_url: scriptUrl(script.sourceURL),
        source_function: label(script.sourceFunctionName),
        source_char_position: number(script.sourceCharPosition),
        execution_start_ms: number(script.executionStart),
        duration_ms: number(script.duration),
        forced_style_layout_ms: number(script.forcedStyleAndLayoutDuration),
        pause_ms: number(script.pauseDuration),
        invoker_type: label(script.invokerType, 60),
        invoker: invoker(script.invoker),
        window_attribution: label(script.windowAttribution, 60),
      }))
      .sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0))
      .slice(0, 8),
  };
}

export function createResponsivenessContext() {
  const completed: Array<{
    name: string;
    module_id?: string;
    start: number;
    end: number;
    status: string;
  }> = [];
  return {
    clear() {
      completed.length = 0;
    },
    record(
      span: PerformanceSpan,
      endedAt: number,
      status: "completed" | "cancelled" = "completed"
    ) {
      if (!Number.isFinite(span.startedAt) || !Number.isFinite(endedAt) || endedAt < span.startedAt)
        return;
      completed.push({
        name: label(span.name) || "unknown",
        module_id: label(span.properties?.module_id),
        start: span.startedAt,
        end: endedAt,
        status,
      });
      while (
        completed.length > MAX_SPANS ||
        (completed[0] && completed[0].end < endedAt - MAX_AGE_MS)
      )
        completed.shift();
    },
    overlapping(start: number, duration: number, pending: Iterable<PerformanceSpan>) {
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
      const end = start + duration;
      // These existing spans measure elapsed wall time, including asynchronous
      // waits. Overlap is context and never evidence that an operation used CPU.
      const candidates = [
        ...completed,
        ...Array.from(pending)
          .slice(0, MAX_SPANS)
          .map((span) => ({
            name: label(span.name) || "unknown",
            module_id: label(span.properties?.module_id),
            start: span.startedAt,
            end,
            status: "pending",
          })),
      ];
      return candidates
        .filter((span) => Number.isFinite(span.start) && span.start < end && span.end > start)
        .map((span) => ({
          operation: span.name,
          module_id: span.module_id,
          status: span.status,
          timing_basis: "elapsed_wall_time",
          started_at_ms: Math.round(span.start),
          ended_at_ms: span.status === "pending" ? undefined : Math.round(span.end),
          overlap_ms: Math.round(Math.min(span.end, end) - Math.max(span.start, start)),
        }))
        .sort((a, b) => b.overlap_ms - a.overlap_ms)
        .slice(0, 8);
    },
  };
}
