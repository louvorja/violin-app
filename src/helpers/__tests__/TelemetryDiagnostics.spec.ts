import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryBuffer } from "../TelemetryBuffer";
import { TelemetryBoot } from "../TelemetryBoot";
import { TelemetryIncidents } from "../TelemetryIncidents";
import { KEYS_LS } from "@/constants/LocalStorageKeys";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("diagnósticos limitados", () => {
  it("preserva o denominador de uma rajada sem consumir capacidade de erros", () => {
    const buffer = new TelemetryBuffer();
    let details = 0;
    for (let i = 0; i < 10000; i++) {
      details += Number(
        buffer.record(
          "network_request",
          {
            endpoint: "libras.bundle",
            status: 404,
            ok: false,
            outcome: "response",
            duration_ms: 20,
          },
          100000
        )
      );
      buffer.record(
        "network_request",
        { endpoint: "catalog", status: 200, ok: true, duration_ms: 10 },
        100000
      );
    }
    expect(details).toBe(1);
    expect(buffer.record("music_playback_failed", { playback_id: "p" })).toBe(true);
    const rows = buffer.flush();
    expect(rows.map((row) => row.count)).toEqual([10000, 10000]);
    expect(rows.map((row) => row.duration_total_ms)).toEqual([200000, 100000]);
    expect(buffer.flush()).toEqual([]);
    expect(
      buffer.record(
        "network_request",
        { endpoint: "libras.bundle", status: 404, ok: false, outcome: "response" },
        160000
      )
    ).toBe(true);
  });

  it("limita cardinalidade e detalhes, mas soma o excedente e permite outra etapa/música", () => {
    const buffer = new TelemetryBuffer();
    for (let i = 0; i < 500; i++)
      buffer.record("network_request", { source: `source${i}`, ok: false }, 100000);
    const rows = buffer.flush();
    expect(rows).toHaveLength(32);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(500);
    expect(rows.reduce((sum, row) => sum + row.detailed_count, 0)).toBe(5);
    const ready = { playback_id: "p", media_stage_epoch: 1, readiness: "canplay" };
    expect(buffer.record("music_media_ready", ready)).toBe(true);
    expect(buffer.record("music_media_ready", ready)).toBe(false);
    expect(buffer.record("music_media_ready", { ...ready, media_stage_epoch: 2 })).toBe(true);
    expect(buffer.record("music_media_ready", { ...ready, playback_id: "p2" })).toBe(true);
    expect(buffer.record("music_buffering_recovered", { buffering_ms: 150 })).toBe(false);
    expect(buffer.record("music_buffering_recovered", { buffering_ms: 1500 })).toBe(true);
  });

  it("agrega incidentes até recuperação confirmada sem fabricar exceções", () => {
    vi.useFakeTimers();
    const emit = vi.fn(),
      replay = vi.fn();
    const incidents = new TelemetryIncidents(emit, () => "incident1");
    const context = () => ({ breadcrumbs: [{ event: "seek" }] });
    const properties = { playback_id: "p", media_stage_epoch: 1 };
    expect(incidents.observe("music_playback_stalled", properties, context, replay)).toMatchObject({
      incident_id: "incident1",
      breadcrumbs: [{ event: "seek" }],
    });
    expect(incidents.observe("music_playback_stalled", properties, context, replay)).toBeNull();
    incidents.observe("music_play_started", properties, context, replay);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    incidents.observe("music_playback_progress_recovered", properties, context, replay);
    expect(emit).toHaveBeenCalledWith(
      "functional_incident_closed",
      expect.objectContaining({
        incident_status: "recovered",
        occurrence_count: 2,
        duration_ms: 2000,
      })
    );
    expect(replay).toHaveBeenCalledOnce();
    for (const kind of ["tools", "busy", "cancelled", "private"])
      incidents.observe("online_video_stream_failed", { kind }, context, replay);
    incidents.observe("music_playback_failed", { reason: "AbortError" }, context, replay);
    expect(replay).toHaveBeenCalledOnce();
    incidents.observe("music_playback_failed", properties, context, replay);
    vi.advanceTimersByTime(300000);
    incidents.expire();
    expect(emit).toHaveBeenLastCalledWith(
      "functional_incident_closed",
      expect.objectContaining({ incident_status: "unconfirmed" })
    );
  });

  it("detecta boot interrompido, remove checkpoint após pintura e ignora armazenamento inválido", () => {
    const emit = vi.fn();
    const first = new TelemetryBoot(() => localStorage, emit);
    first.record("database", 120);
    const next = new TelemetryBoot(() => localStorage, emit);
    next.record("started", 0);
    expect(emit).toHaveBeenCalledWith(
      "app_boot_interrupted",
      expect.objectContaining({ last_stage: "database" })
    );
    next.record("first_paint", 450);
    expect(emit).toHaveBeenCalledWith(
      "app_boot_summary",
      expect.objectContaining({ stages: { started: 0, first_paint: 450 } })
    );
    expect(localStorage.getItem(KEYS_LS.TELEMETRY_BOOT_STATE)).toBeNull();
    localStorage.setItem(KEYS_LS.TELEMETRY_BOOT_STATE, '{"at":1e999,"last_stage":"secret/path"}');
    emit.mockClear();
    new TelemetryBoot(() => localStorage, emit).record("started", 0);
    expect(emit).not.toHaveBeenCalled();
    expect(() =>
      new TelemetryBoot(() => {
        throw new Error("blocked");
      }, emit).record("started", 0)
    ).not.toThrow();
  });
});
