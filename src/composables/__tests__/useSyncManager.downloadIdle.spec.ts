/**
 * Quando não há nada a baixar a fila nem existe: ninguém emite "terminou". A
 * barra de progresso ficava presa em "0 de 0" com o botão Cancelar e os botões
 * de continuar/apagar desabilitados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, ref } from "vue";

const h = vi.hoisted(() => ({
  unsubscribed: 0,
  start: vi.fn(),
  platform: {} as Record<string, unknown>,
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

const listener = () => () => {
  h.unsubscribed += 1;
};

async function mountSync() {
  vi.resetModules();
  const { createPinia, setActivePinia } = await import("pinia");
  setActivePinia(createPinia());
  const { useSyncManager } = await import("@/composables/useSyncManager");
  const { useBackgroundTasks } = await import("@/composables/useBackgroundTasks");
  let sync!: ReturnType<typeof useSyncManager>;
  createApp({
    setup() {
      sync = useSyncManager();
      return () => null;
    },
  }).mount(document.createElement("div"));
  return { sync, tasks: useBackgroundTasks() };
}

beforeEach(() => {
  h.unsubscribed = 0;
  h.start.mockReset();
  Object.assign(h.platform, {
    isDesktop: true,
    storage: { checkLocal: vi.fn(async () => ({})) },
    download: {
      onProgress: listener,
      onFileDone: listener,
      onFileError: listener,
      onQueueDone: listener,
      onQueueCancelled: listener,
      start: h.start,
      cancel: vi.fn(),
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FILES = [{ remote: "/a.opus", local: "a.opus", expectedSize: 0 }];

describe("download sem nada a baixar", () => {
  it("fecha a tarefa, zera o progresso e solta os assinantes", async () => {
    h.start.mockResolvedValue({ queued: 0, message: "Todos os arquivos já estão atualizados" });
    const { sync, tasks } = await mountSync();

    await sync.startDownloads(FILES as never);

    expect(sync.downloading.value).toBe(false);
    expect(sync.downloadProgress.value).toEqual({ done: 0, failed: 0, total: 0, currentFile: "" });
    expect(sync.downloadCompletedMsg.value).toBe("Todos os arquivos já estão atualizados");
    expect(tasks.tasks.value.some((t) => t.id === "sync-collections")).toBe(false);
    expect(tasks.hasActiveTasks.value).toBe(false);
    // 5 da rodada (progress, file-done, file-error, queue-done, queue-cancelled)
    // e 5 do painel de processos, que sai quando a última tarefa é dispensada.
    expect(h.unsubscribed).toBe(10);
  });

  it("erro ao iniciar também não deixa a tarefa presa", async () => {
    h.start.mockRejectedValue(new Error("Download já em andamento"));
    const { sync, tasks } = await mountSync();

    await sync.startDownloads(FILES as never);

    expect(sync.downloading.value).toBe(false);
    expect(sync.downloadCompletedMsg.value).toBe("Download já em andamento");
    expect(tasks.hasActiveTasks.value).toBe(false);
    expect(h.unsubscribed).toBe(10);
  });

  it("com arquivos na fila a tarefa continua em andamento", async () => {
    h.start.mockResolvedValue({ queued: 3 });
    const { sync, tasks } = await mountSync();

    await sync.startDownloads(FILES as never);

    expect(sync.downloading.value).toBe(true);
    expect(sync.downloadProgress.value.total).toBe(3);
    expect(tasks.tasks.value.find((t) => t.id === "sync-collections")?.status).toBe("running");
    expect(h.unsubscribed).toBe(0);
  });
});
