/**
 * useSyncManager.bible.spec.ts — as telas bíblicas pedem a Bíblia local ao
 * abrir. Três regras seguram o consumo da API: a checagem é só disco, várias
 * telas abrindo juntas dividem um único download, e uma falha não vira uma
 * tentativa nova a cada abertura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, ref } from "vue";
import { bundlePercentOf } from "@/composables/useSyncManager";

const { isInstalled, install, dbGet, storedIds } = vi.hoisted(() => ({
  isInstalled: vi.fn(),
  install: vi.fn(),
  dbGet: vi.fn(),
  storedIds: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));

vi.mock("@/helpers/BibleBundleInstaller", () => ({ default: { isInstalled, install } }));
vi.mock("@/helpers/BundleInstaller", () => ({ default: { install: vi.fn() } }));
vi.mock("@/helpers/IndexedDB", () => ({ default: { del: vi.fn(async () => {}) } }));
vi.mock("@/helpers/Database", () => ({
  default: { get: dbGet, getStoredIdsForPrefix: storedIds },
}));

// O módulo guarda o estado (Bíblia pronta, última falha) fora do componente,
// para as telas compartilharem. Cada caso precisa de um módulo novo.
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

beforeEach(() => {
  isInstalled.mockReset();
  install.mockReset();
  dbGet.mockReset();
  storedIds.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSyncManager.ensureBibleBundle", () => {
  it("não baixa nada quando a Bíblia já está no disco, nem checa de novo depois", async () => {
    isInstalled.mockResolvedValue(true);
    const sync = await mountSync();

    expect(await sync.ensureBibleBundle()).toBe(true);
    expect(await sync.ensureBibleBundle()).toBe(true);

    expect(install).not.toHaveBeenCalled();
    expect(isInstalled).toHaveBeenCalledTimes(1);
  });

  it("baixa quando falta e várias telas abrindo juntas dividem um único download", async () => {
    isInstalled.mockResolvedValue(false);
    install.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5)));
    const sync = await mountSync();

    const results = await Promise.all([
      sync.ensureBibleBundle(),
      sync.ensureBibleBundle(),
      sync.ensureBibleBundle(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0][0]).toEqual(
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("depois de instalar, abrir outra tela não consulta nem baixa de novo", async () => {
    isInstalled.mockResolvedValue(false);
    install.mockResolvedValue(undefined);
    const sync = await mountSync();

    await sync.ensureBibleBundle();
    isInstalled.mockClear();
    install.mockClear();
    await sync.ensureBibleBundle();

    expect(isInstalled).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it("após uma falha não retenta dentro da pausa, e retenta quando ela passa", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    isInstalled.mockResolvedValue(false);
    install.mockRejectedValueOnce(new Error("rede caiu"));
    const sync = await mountSync();

    expect(await sync.ensureBibleBundle()).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);

    expect(await sync.ensureBibleBundle()).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T12:06:00Z"));
    install.mockResolvedValue(undefined);
    expect(await sync.ensureBibleBundle()).toBe(true);
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("o percentual da barra nunca volta atrás ao passar do download para a gravação", async () => {
    isInstalled.mockResolvedValue(false);
    const seen: number[] = [];
    let sync!: Awaited<ReturnType<typeof mountSync>>;
    install.mockImplementation(async ({ onProgress }) => {
      const steps = [
        { phase: "download", current: 50, total: 100, bytesReceived: 50, bytesTotal: 100 },
        { phase: "download", current: 100, total: 100, bytesReceived: 100, bytesTotal: 100 },
        { phase: "inject", current: 0, total: 10 },
        { phase: "inject", current: 5, total: 10 },
        { phase: "inject", current: 10, total: 10 },
      ];
      for (const step of steps) {
        onProgress(step);
        seen.push(sync.bundlePercent.value);
      }
    });
    sync = await mountSync();

    await sync.ensureBibleBundle();

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(0)).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(100);
  });
});

describe("useSyncManager.downloadBibleVersions", () => {
  const versions = [{ id_bible_version: 1 }] as never;
  const books = [{ id_bible_book: 1, chapters: 3 }];
  const chapterKeys = ["bible_1_1_1", "bible_1_1_2", "bible_1_1_3"];

  it("instala o bundle antes de olhar o que falta e não pede capítulo por capítulo", async () => {
    let bundleInstalled = false;
    isInstalled.mockResolvedValue(false);
    install.mockImplementation(async () => {
      bundleInstalled = true;
    });
    storedIds.mockImplementation(async () => new Set(bundleInstalled ? chapterKeys : []));
    dbGet.mockImplementation(async (key: string) => (key === "pt_bible_book" ? books : {}));
    const sync = await mountSync();

    const downloaded = await sync.downloadBibleVersions([1], versions, "pt");

    expect(downloaded).toBe(chapterKeys.length);
    expect(install).toHaveBeenCalledTimes(1);
    expect(dbGet.mock.calls.map(([key]) => key)).toEqual(["pt_bible_book"]);
  });

  it("sem o bundle, volta a baixar os capítulos que faltam", async () => {
    isInstalled.mockResolvedValue(false);
    install.mockRejectedValue(new Error("rede caiu"));
    storedIds.mockResolvedValue(new Set(["bible_1_1_1"]));
    dbGet.mockImplementation(async (key: string) => (key === "pt_bible_book" ? books : {}));
    const sync = await mountSync();

    await sync.downloadBibleVersions([1], versions, "pt");

    const chapterRequests = dbGet.mock.calls
      .map(([key]) => key)
      .filter((k) => k.startsWith("bible_"));
    expect(chapterRequests.sort()).toEqual(["bible_1_1_2", "bible_1_1_3"]);
  });

  it("não deixa a tarefa em andamento quando não há nada a baixar", async () => {
    isInstalled.mockResolvedValue(true);
    storedIds.mockResolvedValue(new Set(chapterKeys));
    dbGet.mockImplementation(async (key: string) => (key === "pt_bible_book" ? books : {}));
    const sync = await mountSync();
    const { useBackgroundTasks } = await import("@/composables/useBackgroundTasks");

    const downloaded = await sync.downloadBibleVersions([1], versions, "pt");

    expect(downloaded).toBe(0);
    const task = useBackgroundTasks().tasks.value.find((t) => t.id === "sync-bible");
    // "running" para sempre fazia a aba Bíblia desenhar o progresso e sumir com o botão.
    expect(task?.status).not.toBe("running");
    expect(sync.bibleDownloading.value).toBe(false);
  });

  it("também conclui a tarefa quando o catálogo não traz livros", async () => {
    isInstalled.mockResolvedValue(true);
    dbGet.mockResolvedValue([]);
    const sync = await mountSync();
    const { useBackgroundTasks } = await import("@/composables/useBackgroundTasks");

    await sync.downloadBibleVersions([1], versions, "pt");

    const task = useBackgroundTasks().tasks.value.find((t) => t.id === "sync-bible");
    expect(task?.status).not.toBe("running");
  });

  it("avisa as telas quando o conteúdo bíblico muda", async () => {
    isInstalled.mockResolvedValue(true);
    storedIds.mockResolvedValue(new Set(chapterKeys));
    dbGet.mockImplementation(async (key: string) => (key === "pt_bible_book" ? books : {}));
    const sync = await mountSync();
    const before = sync.bibleRevision.value;

    await sync.downloadBibleVersions([1], versions, "pt");
    expect(sync.bibleRevision.value).toBeGreaterThan(before);

    const afterDownload = sync.bibleRevision.value;
    await sync.saveBibleSelectionToDisk([1]);
    expect(sync.bibleRevision.value).toBeGreaterThan(afterDownload);
  });
});

describe("useSyncManager.ensureBibleBundle e o sinal de mudança", () => {
  it("avisa as telas quando o bundle termina de instalar em segundo plano", async () => {
    isInstalled.mockResolvedValue(false);
    install.mockResolvedValue(undefined);
    const sync = await mountSync();
    const before = sync.bibleRevision.value;

    await sync.ensureBibleBundle();

    expect(sync.bibleRevision.value).toBeGreaterThan(before);
  });
});

describe("useSyncManager.scanBibleVersionsDisk", () => {
  it("não mexe no progresso do scan de coletâneas por conta própria", async () => {
    storedIds.mockResolvedValue(new Set());
    dbGet.mockResolvedValue([{ id_bible_book: 1, chapters: 2 }]);
    const sync = await mountSync();

    await sync.scanBibleVersionsDisk(
      [{ id_bible_version: 1 }, { id_bible_version: 2 }] as never,
      "pt"
    );

    // A aba Bíblia chama isto sozinha; contar aqui deixava "(10/0)" na outra tela.
    expect(sync.scanProgress.value).toEqual({ done: 0, total: 0 });
  });

  it("conta quando o scan de coletâneas pede", async () => {
    storedIds.mockResolvedValue(new Set());
    dbGet.mockResolvedValue([{ id_bible_book: 1, chapters: 2 }]);
    const sync = await mountSync();

    await sync.scanBibleVersionsDisk(
      [{ id_bible_version: 1 }, { id_bible_version: 2 }] as never,
      "pt",
      { trackProgress: true }
    );

    expect(sync.scanProgress.value.done).toBe(2);
  });
});

describe("bundlePercentOf", () => {
  const dl = (received: number, total: number) => ({
    phase: "download" as const,
    current: received,
    total,
    bytesReceived: received,
    bytesTotal: total,
  });

  it("começa em zero, antes de saber o tamanho", () => {
    expect(bundlePercentOf({ phase: "download", current: 0, total: 1 })).toBe(0);
    expect(bundlePercentOf({ phase: "download", current: 500, total: 0 })).toBe(0);
  });

  it("cada fase ocupa o seu trecho", () => {
    expect(bundlePercentOf(dl(50, 100))).toBe(35);
    expect(bundlePercentOf(dl(100, 100))).toBe(70);
    expect(bundlePercentOf({ phase: "extract", current: 0, total: 10 })).toBe(70);
    expect(bundlePercentOf({ phase: "extract", current: 10, total: 10 })).toBe(80);
    expect(bundlePercentOf({ phase: "inject", current: 0, total: 10 })).toBe(80);
    expect(bundlePercentOf({ phase: "inject", current: 10, total: 10 })).toBe(100);
  });

  it("nunca recua ao longo de uma instalação inteira", () => {
    const steps = [
      { phase: "download" as const, current: 0, total: 1 },
      ...[10, 40, 70, 100].map((n) => dl(n, 100)),
      ...[0, 5, 10].map((n) => ({ phase: "extract" as const, current: n, total: 10 })),
      ...[0, 3, 10].map((n) => ({ phase: "inject" as const, current: n, total: 10 })),
    ];
    const seen = steps.map(bundlePercentOf);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(100);
  });
});
