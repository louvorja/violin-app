/** Bounded reduction of routine events. Incident capture never uses this budget. */
type Properties = Record<string, unknown>;
const SUMMARY_LIMIT = 32;
const DETAIL_INTERVAL_MS = 60_000;
const AGGREGATED = new Set([
  "module_prefetch_completed",
  "performance_measurement",
  "module_view_mounted",
  "module_view_first_paint",
  "music_page_stage",
  "music_metadata_load_started",
  "music_metadata_load_completed",
  "music_metadata_resolved",
  "music_audio_load_started",
  "music_audio_streaming_started",
  "data_table_filter_completed",
  "data_table_loaded",
  "database_bundle_stage_completed",
  "app_boot_stage",
  "diagnostic_log_repeated",
]);
const ONCE_PER_STAGE = new Set([
  "music_media_ready",
  "music_listening_completed",
  "file_projection_video_ready",
  "file_projection_video_playing",
  "file_projection_return_video_ready",
  "file_projection_return_video_playing",
]);
const LABELS = [
  "source",
  "endpoint",
  "outcome",
  "status",
  "method",
  "module_id",
  "measurement",
  "readiness",
  "stage",
  "buffering_phase",
] as const;

interface Summary {
  event: string;
  labels: Properties;
  count: number;
  detailed_count: number;
  first_seen_at: string;
  last_seen_at: string;
  duration_count: number;
  duration_total_ms: number;
  duration_max_ms: number;
}

function label(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
}

export class TelemetryBuffer {
  private summaries = new Map<string, Summary>();
  private details = new Map<string, number>();
  private seen = new Map<string, number>();
  private networkWindow = { at: 0, count: 0 };

  private summarize(event: string, properties: Properties, detailed: boolean, now: number): void {
    const labels: Properties = {};
    for (const key of LABELS) {
      const value = label(properties[key]);
      if (value !== undefined) labels[key] = value;
    }
    let key = JSON.stringify([event, labels]);
    if (!this.summaries.has(key) && this.summaries.size >= SUMMARY_LIMIT - 1) key = "overflow";
    let summary = this.summaries.get(key);
    if (!summary) {
      summary = {
        event: key === "overflow" ? "other_routine_events" : event,
        labels: key === "overflow" ? {} : labels,
        count: 0,
        detailed_count: 0,
        first_seen_at: new Date(now).toISOString(),
        last_seen_at: new Date(now).toISOString(),
        duration_count: 0,
        duration_total_ms: 0,
        duration_max_ms: 0,
      };
      this.summaries.set(key, summary);
    }
    summary.count++;
    if (detailed) summary.detailed_count++;
    summary.last_seen_at = new Date(now).toISOString();
    const duration = properties.duration_ms ?? properties.buffering_ms;
    if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
      summary.duration_count++;
      summary.duration_total_ms += duration;
      summary.duration_max_ms = Math.max(summary.duration_max_ms, duration);
    }
  }

  /** True means keep the individual event as well as its aggregate. */
  record(event: string, properties: Properties, now = Date.now()): boolean {
    if (event === "local_storage_failed") {
      const key = JSON.stringify([
        event,
        properties.source,
        properties.operation,
        properties.local_environment_error,
      ]);
      const previous = this.details.get(key);
      const detailed = previous === undefined || now - previous >= DETAIL_INTERVAL_MS;
      if (detailed) {
        if (this.details.size >= 64) this.details.delete(this.details.keys().next().value!);
        this.details.set(key, now);
      }
      this.summarize(event, properties, detailed, now);
      return detailed;
    }
    if (event === "network_request") {
      const failure =
        properties.outcome !== "cancelled" &&
        (properties.ok === false || properties.outcome === "network_error");
      const slow = Number(properties.duration_ms) >= 1000 && properties.outcome !== "cancelled";
      const key = JSON.stringify([
        properties.source,
        properties.endpoint,
        properties.status,
        properties.outcome,
        slow,
      ]);
      if (now - this.networkWindow.at >= DETAIL_INTERVAL_MS)
        this.networkWindow = { at: now, count: 0 };
      const previous = this.details.get(key);
      const detailed =
        (failure || slow) &&
        this.networkWindow.count < 5 &&
        (previous === undefined || now - previous >= DETAIL_INTERVAL_MS);
      if (detailed) {
        if (this.details.size >= 64) this.details.delete(this.details.keys().next().value!);
        this.details.set(key, now);
        this.networkWindow.count++;
      }
      this.summarize(event, properties, detailed, now);
      return detailed;
    }
    if (AGGREGATED.has(event)) {
      this.summarize(event, properties, false, now);
      return false;
    }
    if (ONCE_PER_STAGE.has(event) && properties.playback_id) {
      const key = JSON.stringify([
        event,
        properties.playback_id,
        event === "music_listening_completed" ? null : properties.media_stage_epoch,
        properties.readiness,
      ]);
      const detailed = !this.seen.has(key);
      if (detailed) {
        if (this.seen.size >= 512) this.seen.delete(this.seen.keys().next().value!);
        this.seen.set(key, now);
      }
      this.summarize(event, properties, detailed, now);
      return detailed;
    }
    if (event === "music_buffering_recovered") {
      const detailed = Number(properties.buffering_ms) >= 1000;
      this.summarize(event, properties, detailed, now);
      return detailed;
    }
    return true;
  }

  snapshot(): Summary[] {
    return [...this.summaries.values()].map((row) => ({ ...row, labels: { ...row.labels } }));
  }
  flush(): Summary[] {
    const rows = this.snapshot();
    this.summaries.clear();
    return rows;
  }
  clear(): void {
    this.summaries.clear();
    this.details.clear();
    this.seen.clear();
    this.networkWindow = { at: 0, count: 0 };
  }
}
