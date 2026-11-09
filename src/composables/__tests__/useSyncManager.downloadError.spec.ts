/**
 * Fila que falhou inteira: a telemetria precisa dizer se foi disco, permissão
 * ou rede, sem levar o caminho do usuário que vem na mensagem do main.
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

const capture = (name: string) => (cb: (d?: unknown) => void) => {
  h.handlers[name] = cb;
  return () => {};
};

beforeEach(() => {
  h.track.mockReset();
  h.handlers = {};
  Object.assign(h.platform, {
    isDesktop: true,
    storage: { checkLocal: vi.fn(async () => ({})) },
    download: {
      onProgress: capture("progress"),
      onFileDone: capture("fileDone"),
      onFileError: capture("fileError"),
      onQueueDone: capture("queueDone"),
      onQueueCancelled: capture("queueCancelled"),
      start: vi.fn(async () => ({ queued: 2 })),
      cancel: vi.fn(),
    },
  });
});

describe("downloadErrorKind", () => {
  it.each([
    ["EACCES: permission denied, open 'C:\\Users\\Maria\\Documents\\x.opus'", "EACCES"],
    ["ENOSPC: no space left on device, write", "ENOSPC"],
    ["getaddrinfo ENOTFOUND files.louvorja.com.br", "ENOTFOUND"],
    ["HTTP 403", "http_403"],
    ["HTTP timeout", "timeout"],
    ["Esta pasta está somente para leitura ou em uso por outra conta.", "collection_readonly"],
    ["Download incompleto: 10/20 bytes", "incomplete"],
    ["algo inesperado", "other"],
    [undefined, "unknown"],
  ])("%s → %s", async (message, kind) => {
    const { downloadErrorKind } = await import("@/composables/useSyncManager");
    expect(downloadErrorKind(message)).toBe(kind);
  });
});

describe("download_queue_failed", () => {
  it("leva a categoria do primeiro erro, sem o caminho do arquivo", async () => {
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

    await sync.startDownloads([
      { remote: "/a.opus", local: "a.opus", expectedSize: 0 },
      { remote: "/b.opus", local: "b.opus", expectedSize: 0 },
    ] as never);
    h.handlers.fileError({ file: "/a.opus", error: "EPERM: operation not permitted, open 'C:\\Users\\Public\\a.opus'" });
    h.handlers.fileError({ file: "/b.opus", error: "HTTP 404" });
    h.handlers.queueDone({ failed: 2 });
    await vi.waitFor(() => expect(h.track).toHaveBeenCalledWith("download_queue_failed", expect.anything()));

    const props = h.track.mock.calls.find(([name]) => name === "download_queue_failed")![1];
    expect(props).toEqual({ code: "file_error", failed_count: 2, first_error: "EPERM" });
  });
});
