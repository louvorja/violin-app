/**
 * Download de coletâneas: a rodada chega ao PostHog com a origem e o desfecho,
 * em dois eventos, sem um evento por arquivo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, ref } from "vue";

const h = vi.hoisted(() => ({
  platform: {} as Record<string, unknown>,
  handlers: {} as Record<string, (d?: unknown) => void>,
  track: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));
vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/BundleInstaller", () => ({ default: {} }));
vi.mock("@/helpers/BibleBundleInstaller", () => ({ default: {} }));
vi.mock("@/helpers/Database", () => ({
  default: { get: vi.fn(), getLocal: vi.fn(), getStoredIdsForPrefix: vi.fn() },
  setDatabaseTimingReporter: vi.fn(),
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: h.track, log: vi.fn(), captureException: vi.fn(), histogram: vi.fn() },
}));
vi.mock("@/helpers/ReliabilityDiagnostics", () => ({
  reportReliabilityEvent: h.track,
  reportReliabilityFailure: vi.fn(),
}));

const capture = (name: string) => (cb: (d?: unknown) => void) => {
  h.handlers[name] = cb;
  return () => {};
};

const FILES = [
  { remote: "/a.opus", local: "a.opus", expectedSize: 0 },
  { remote: "/b.opus", local: "b.opus", expectedSize: 0 },
  { remote: "/c.opus", local: "c.opus", expectedSize: 0 },
] as never;

async function mountSync() {
  vi.resetModules();
  const { createPinia, setActivePinia } = await import("pinia");
  setActivePinia(createPinia());
  const { useSyncManager } = await import("@/composables/useSyncManager");
  let sync!: ReturnType<typeof useSyncManager>;
  createApp({
    setup() {
      sync = useSyncManager();
      return () => null;
    },
  }).mount(document.createElement("div"));
  return sync;
}

function tracked(name: string) {
  return h.track.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
}

beforeEach(() => {
  h.track.mockReset();
  h.handlers = {};
  window.localStorage.clear();
  Object.assign(h.platform, {
    isDesktop: true,
    storage: { checkLocal: vi.fn(async () => ({})) },
    download: {
      onProgress: capture("progress"),
      onFileDone: capture("fileDone"),
      onFileError: capture("fileError"),
      onQueueDone: capture("queueDone"),
      onQueueCancelled: capture("queueCancelled"),
      start: vi.fn(async () => ({ queued: 3 })),
      cancel: vi.fn(),
    },
  });
});

describe("collection_download_*", () => {
  it("fila concluída manda início e fim com a origem, sem evento por arquivo", async () => {
    const sync = await mountSync();
    await sync.startDownloads(FILES, { source: "startup_check" });
    for (const file of ["/a.opus", "/b.opus", "/c.opus"]) {
      h.handlers.progress({ file, current: 1, total: 3, bytes: 1, totalBytes: 2 });
      h.handlers.fileDone({ file });
    }
    h.handlers.queueDone({ downloaded: 3, failed: 0 });

    await vi.waitFor(() => expect(tracked("collection_download_finished")).toHaveLength(1));
    expect(tracked("collection_download_started")).toEqual([
      expect.objectContaining({ source: "startup_check", requested: 3, resumed: false }),
    ]);
    expect(tracked("collection_download_finished")[0]).toMatchObject({
      source: "startup_check",
      outcome: "completed",
      queued: 3,
      downloaded: 3,
      failed: 0,
      remaining: 0,
    });
    expect(h.track.mock.calls.map(([event]) => event).sort()).toEqual([
      "collection_download_finished",
      "collection_download_started",
    ]);
  });

  it("falha parcial mantém download_queue_failed e a rodada seguinte é retomada", async () => {
    const sync = await mountSync();
    await sync.startDownloads(FILES, { source: "sync_menu" });
    h.handlers.fileDone({ file: "/a.opus" });
    h.handlers.fileError({ file: "/b.opus", error: "HTTP timeout" });
    h.handlers.fileError({ file: "/c.opus", error: "HTTP 404" });
    h.handlers.queueDone({ downloaded: 1, failed: 2 });
    await vi.waitFor(() => expect(tracked("collection_download_finished")).toHaveLength(1));

    expect(tracked("collection_download_finished")[0]).toMatchObject({
      outcome: "failed",
      downloaded: 1,
      failed: 2,
      code: "file_error",
      first_error: "timeout",
    });
    await vi.waitFor(() => expect(tracked("download_queue_failed")).toHaveLength(1));

    await sync.startDownloads(FILES, { source: "sync_continue" });
    await vi.waitFor(() => expect(tracked("collection_download_started")).toHaveLength(2));
    expect(tracked("collection_download_started")[1]).toMatchObject({
      source: "sync_continue",
      resumed: true,
      previous_outcome: "failed",
    });
  });

  it("cancelar e nada a baixar também fecham a rodada", async () => {
    const sync = await mountSync();
    await sync.startDownloads(FILES);
    h.handlers.queueCancelled();
    (h.platform.download as { start: ReturnType<typeof vi.fn> }).start.mockResolvedValueOnce({
      queued: 0,
    });
    await sync.startDownloads(FILES, { source: "sync_menu" });

    await vi.waitFor(() => expect(tracked("collection_download_finished")).toHaveLength(2));
    const outcomes = tracked("collection_download_finished").map((props) => [
      props.source,
      props.outcome,
    ]);
    expect(outcomes).toEqual([
      ["unknown", "cancelled"],
      ["sync_menu", "nothing_to_do"],
    ]);
  });
});
