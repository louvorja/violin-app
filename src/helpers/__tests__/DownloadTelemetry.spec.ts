/**
 * Uma rodada de download e uma abertura da verificação inicial viram poucos
 * eventos com desfecho, inclusive quando o app fecha no meio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_STALL_MS,
  STARTUP_CHECK_STUCK_MS,
  openStartupCheckSession,
  reportUnfinishedRuns,
  setDownloadTelemetryDeps,
  startCollectionDownloadRun,
} from "@/helpers/DownloadTelemetry";

let now = 1_000_000;
let store = new Map<string, string>();
let intervals: Array<{ fn: () => void; cleared: boolean }> = [];
const track = vi.fn();

function tick(ms: number): void {
  now += ms;
  for (const interval of intervals) if (!interval.cleared) interval.fn();
}

function events(name: string): Record<string, unknown>[] {
  return track.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
}

/** Simula o boot seguinte: estado em memória zerado, armazenamento mantido. */
function restartApp(): void {
  setDownloadTelemetryDeps(deps());
}

function deps() {
  return {
    now: () => now,
    storage: () => ({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }),
    track,
    setInterval: (fn: () => void) => {
      const handle = { fn, cleared: false };
      intervals.push(handle);
      return handle;
    },
    clearInterval: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    appVersion: "2.0.1-beta.3",
  };
}

beforeEach(() => {
  now = 1_000_000;
  store = new Map();
  intervals = [];
  track.mockReset();
  setDownloadTelemetryDeps(deps());
});

afterEach(() => setDownloadTelemetryDeps(null));

describe("downloads de coletâneas", () => {
  it("manda só o início e o desfecho, com contagens e não um evento por arquivo", () => {
    const run = startCollectionDownloadRun("startup_check", 3);
    run.queued(3);
    run.fileDone();
    run.activity();
    run.fileDone();
    run.fileError();
    tick(5_000);
    run.finish("failed", { failed: 1, code: "file_error", firstError: "http_404" });

    expect(track.mock.calls.map(([event]) => event)).toEqual([
      "collection_download_started",
      "collection_download_finished",
    ]);
    expect(events("collection_download_started")[0]).toMatchObject({
      source: "startup_check",
      requested: 3,
      resumed: false,
      previous_outcome: null,
    });
    expect(events("collection_download_finished")[0]).toMatchObject({
      source: "startup_check",
      outcome: "failed",
      queued: 3,
      downloaded: 2,
      failed: 1,
      remaining: 0,
      duration_ms: 5_000,
      stalled: false,
      code: "file_error",
      first_error: "http_404",
    });
    expect(intervals.every((interval) => interval.cleared)).toBe(true);
  });

  it("avisa uma vez quando a fila fica parada e guarda a maior pausa no desfecho", () => {
    const run = startCollectionDownloadRun("sync_menu", 10);
    run.fileDone();
    tick(DOWNLOAD_STALL_MS - 1);
    expect(events("collection_download_stalled")).toHaveLength(0);
    tick(1);
    tick(60_000);
    expect(events("collection_download_stalled")).toEqual([
      expect.objectContaining({ source: "sync_menu", downloaded: 1, waited_ms: DOWNLOAD_STALL_MS }),
    ]);
    run.fileDone();
    run.finish("completed", { downloaded: 10 });

    expect(events("collection_download_finished")[0]).toMatchObject({
      outcome: "completed",
      downloaded: 10,
      stalled: true,
      max_gap_ms: DOWNLOAD_STALL_MS + 60_000,
    });
  });

  it("rodada cortada pelo fechamento do app aparece no boot seguinte como interrupted", () => {
    const run = startCollectionDownloadRun("startup_check", 50);
    run.queued(50);
    for (let i = 0; i < 20; i++) run.fileDone();
    tick(30_000);

    restartApp();
    reportUnfinishedRuns();
    reportUnfinishedRuns();

    const finished = events("collection_download_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      outcome: "interrupted",
      queued: 50,
      downloaded: 20,
      remaining: 30,
      started_app_version: "2.0.1-beta.3",
      reported_late: true,
    });
  });

  it("começar de novo depois de uma rodada que não terminou bem conta como retomada", () => {
    startCollectionDownloadRun("startup_check", 5).finish("cancelled");
    tick(10_000);
    startCollectionDownloadRun("sync_continue", 4);

    expect(events("collection_download_started")[1]).toMatchObject({
      source: "sync_continue",
      resumed: true,
      previous_outcome: "cancelled",
      since_previous_ms: 10_000,
    });
  });

  it("uma rodada interrompida não relatada no boot é relatada antes da próxima começar", () => {
    startCollectionDownloadRun("startup_check", 5).fileDone();
    restartApp();
    startCollectionDownloadRun("sync_continue", 4);

    expect(track.mock.calls.map(([event, props]) => [event, props.outcome ?? null])).toEqual([
      ["collection_download_started", null],
      ["collection_download_finished", "interrupted"],
      ["collection_download_started", null],
    ]);
    expect(events("collection_download_started")[1]).toMatchObject({
      resumed: true,
      previous_outcome: "interrupted",
    });
  });

  it("depois de concluída, uma rodada não é relatada outra vez no boot", () => {
    startCollectionDownloadRun("sync_menu", 1).finish("completed", { downloaded: 1 });
    restartApp();
    reportUnfinishedRuns();
    expect(events("collection_download_finished")).toHaveLength(1);
  });
});

describe("verificação inicial", () => {
  it("relata abertura, fim da verificação e fechamento com o caminho usado", () => {
    const session = openStartupCheckSession("boot", () => ({ busy: false }));
    tick(4_000);
    session.scanFinished("ok", {
      durationMs: 3_900,
      detailed: false,
      albumsTotal: 120,
      cachedAlbums: 7,
    });
    session.view("summary");
    tick(2_000);
    session.closed("close_button");
    session.closed("unmounted");

    expect(track.mock.calls.map(([event]) => event)).toEqual([
      "startup_check_opened",
      "startup_check_scan_finished",
      "startup_check_closed",
    ]);
    expect(events("startup_check_scan_finished")[0]).toMatchObject({
      source: "boot",
      outcome: "ok",
      duration_ms: 3_900,
      albums_total: 120,
      cached_albums: 7,
    });
    expect(events("startup_check_closed")[0]).toMatchObject({
      via: "close_button",
      view: "summary",
      open_ms: 6_000,
      scan_ms: 3_900,
      scan_outcome: "ok",
      busy: false,
    });
    expect(store.size).toBe(0);
  });

  it("avisa uma vez quando fica parada em Verificando", () => {
    openStartupCheckSession("boot", () => ({ bundleInstalling: true, ftpChecking: false }));
    for (let waited = 0; waited < STARTUP_CHECK_STUCK_MS * 2; waited += 15_000) tick(15_000);

    expect(events("startup_check_stuck")).toEqual([
      expect.objectContaining({ view: "scanning", bundle_installing: true, ftp_checking: false }),
    ]);
  });

  it("fechar o app com a janela aberta aparece no boot seguinte como app_closed", () => {
    const session = openStartupCheckSession("menu");
    tick(15_000);
    session.view("downloading");
    session.downloadStarted();
    tick(15_000);

    restartApp();
    reportUnfinishedRuns();
    reportUnfinishedRuns();

    expect(events("startup_check_closed")).toEqual([
      expect.objectContaining({
        source: "menu",
        via: "app_closed",
        view: "downloading",
        open_ms: 30_000,
        download_started: true,
        reported_late: true,
      }),
    ]);
  });

  it("armazenamento indisponível não impede os eventos nem o fluxo", () => {
    setDownloadTelemetryDeps({ ...deps(), storage: () => null });
    const run = startCollectionDownloadRun("sync_menu", 1);
    run.finish("completed", { downloaded: 1 });
    expect(events("collection_download_finished")).toHaveLength(1);
  });
});
