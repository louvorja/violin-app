type Properties = Record<string, unknown>;
const FUNCTIONAL_FAILURES = new Set([
  "music_playback_failed",
  "music_playback_stalled",
  "music_open_failed",
  "music_audio_load_failed",
  "music_mode_switch_failed",
  "file_projection_video_failed",
  "file_projection_return_video_failed",
  "online_video_stream_failed",
  "online_video_stream_start_failed",
  "liturgy_execution_failed",
  "module_load_failed",
  "presentation_snapshot_publish_failed",
  "projection_window_close_unconfirmed",
  "database_read_failed",
  "database_bundle_install_failed",
]);
const RECOVERY_EVENTS = new Set([
  "music_play_started",
  "music_playback_resumed",
  "music_playback_progress_recovered",
  "file_projection_video_playing",
  "file_projection_return_video_playing",
]);
interface Incident {
  id: string;
  event: string;
  playback?: string;
  first: number;
  last: number;
  count: number;
}

/** Tracks bounded incident lifetimes; it does not fabricate JavaScript exceptions. */
export class TelemetryIncidents {
  private active = new Map<string, Incident>();
  constructor(
    private emit: (event: string, properties: Properties) => void,
    private newId: () => string
  ) {}

  observe(
    event: string,
    properties: Properties,
    context: () => Properties,
    replay: () => void
  ): Properties | null {
    const playback =
      typeof properties.playback_id === "string" ? properties.playback_id : undefined;
    if (RECOVERY_EVENTS.has(event) && playback) {
      for (const [key, incident] of this.active) {
        if (
          incident.playback === playback &&
          (incident.event !== "music_playback_stalled" ||
            event === "music_playback_progress_recovered")
        )
          this.close(key, "recovered");
      }
    }
    if (!FUNCTIONAL_FAILURES.has(event)) return properties;
    if (
      properties.stale_context === true ||
      /^(aborted|AbortError|cancelled|canceled|superseded)$/.test(String(properties.reason))
    )
      return properties;
    if (
      [
        "tools",
        "busy",
        "unsupported",
        "cancelled",
        "private",
        "age",
        "geo",
        "unavailable",
      ].includes(String(properties.kind))
    )
      return properties;
    const key = JSON.stringify([
      event,
      playback,
      properties.media_stage_epoch,
      properties.stage,
      properties.reason,
      properties.kind,
      properties.operation,
    ]);
    const now = Date.now();
    const previous = this.active.get(key);
    if (previous) {
      previous.count++;
      previous.last = now;
      return null;
    }
    if (this.active.size >= 32) this.close(this.active.keys().next().value!, "capacity");
    const incident: Incident = {
      id: this.newId(),
      event,
      playback,
      first: now,
      last: now,
      count: 1,
    };
    this.active.set(key, incident);
    replay();
    return { ...context(), ...properties, incident_id: incident.id, incident_status: "open" };
  }

  private close(key: string, reason: string): void {
    const item = this.active.get(key);
    if (!item) return;
    this.active.delete(key);
    this.emit("functional_incident_closed", {
      incident_id: item.id,
      incident_event: item.event,
      playback_id: item.playback,
      incident_status: reason,
      occurrence_count: item.count,
      duration_ms: Date.now() - item.first,
      first_seen_at: new Date(item.first).toISOString(),
      last_seen_at: new Date(item.last).toISOString(),
    });
  }
  closePlayback(playback: string, reason: string): void {
    for (const [key, incident] of this.active)
      if (incident.playback === playback) this.close(key, reason);
  }
  expire(): void {
    for (const [key, incident] of this.active)
      if (Date.now() - incident.first >= 300_000) this.close(key, "unconfirmed");
  }
  clear(): void {
    this.active.clear();
  }
}
