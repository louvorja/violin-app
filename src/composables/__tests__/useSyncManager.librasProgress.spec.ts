/**
 * A barra da tela de Acessibilidade lê a tarefa de background (para sobreviver
 * a fechar/reabrir o menu). Ela precisa do MESMO id que o download registra e
 * de `_done/_total`: só a porcentagem deixava a barra presa em "0 de 0".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, ref } from "vue";

const h = vi.hoisted(() => ({
  musicCacheId: vi.fn((id: number, region?: string) => `music_${id}_${region || "default"}`),
  bibleCacheId: vi.fn(
    (abbr: string, book: number, ch: number, region?: string) =>
      `bible_${abbr}_${book}_${ch}_${region || "default"}`
  ),
  getCached: vi.fn(),
  translateMusic: vi.fn(),
  translateBibleChapter: vi.fn(),
  dbGet: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));
vi.mock("@/helpers/Platform", () => ({ default: {} }));
vi.mock("@/helpers/BundleInstaller", () => ({ default: {} }));
vi.mock("@/helpers/BibleBundleInstaller", () => ({ default: {} }));
vi.mock("@/helpers/Database", () => ({
  default: { get: h.dbGet, getLocal: vi.fn(), getStoredIdsForPrefix: vi.fn() },
  setDatabaseTimingReporter: vi.fn(),
}));
vi.mock("@/helpers/Libras", () => ({
  default: {
    musicCacheId: h.musicCacheId,
    bibleCacheId: h.bibleCacheId,
    getCached: h.getCached,
    translateMusic: h.translateMusic,
    translateBibleChapter: h.translateBibleChapter,
    downloadAllBundles: vi.fn(),
    setCached: vi.fn(),
  },
}));

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
  h.getCached.mockResolvedValue(null);
  h.translateMusic.mockReset();
  h.translateBibleChapter.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const version = {
  id_bible_version: 1,
  abbreviation: "GN",
  name: "Gênesis",
} as never;
const books = [{ id_bible_book: 1, chapters: 1, name: "Gênesis" }] as never;

describe("progresso da Libras nas tarefas em background", () => {
  it("registra a música como 'libras-music' com done/total e avança dentro do item", async () => {
    h.dbGet.mockImplementation(async (id: string) =>
      id.startsWith("album_") ? { musics: [{ id_music: 1, name: "Hino 1" }] } : { name: "Hino 1" }
    );
    const { sync, tasks } = await mountSync();
    const vistos: number[] = [];
    const progresso = () => tasks.tasks.value.find((t) => t.id === "libras-music")?.progress ?? -1;

    h.translateMusic.mockImplementation(async (_id, _music, _lang, onProgress) => {
      onProgress?.("translate", 0, 2);
      vistos.push(progresso());
      onProgress?.("translate", 2, 2);
      vistos.push(progresso());
      onProgress?.("download", 0, 2);
      vistos.push(progresso());
      onProgress?.("download", 1, 2);
      vistos.push(progresso());
      return { id: "music_1" };
    });

    await sync.startLibrasMusicDownloads([], [], new Set([1]), "default");

    const task = tasks.tasks.value.find((t) => t.id === "libras-music");
    expect(task).toBeTruthy();
    expect(task?._total).toBe(1);
    expect(task?._done).toBe(1);
    // Slides (translate) e bundles (download) movem a barra sem regredir.
    expect(vistos[0]).toBe(0);
    expect(vistos[1]).toBeCloseTo(20);
    expect(vistos[2]).toBeCloseTo(20);
    expect(vistos[3]).toBeCloseTo(60);
    expect([...vistos].sort((a, b) => a - b)).toEqual(vistos);
  });

  it("guarda a fração do progresso para o ETA ter amostras", async () => {
    h.dbGet.mockImplementation(async (id: string) =>
      id.startsWith("album_") ? { musics: [{ id_music: 1, name: "Hino 1" }] } : { name: "Hino 1" }
    );
    const { sync, tasks } = await mountSync();
    let durante: number | undefined;
    h.translateMusic.mockImplementation(async (_id, _music, _lang, onProgress) => {
      onProgress?.("translate", 1, 100);
      durante = tasks.tasks.value.find((t) => t.id === "libras-music")?.progress;
      return { id: "music_1" };
    });

    await sync.startLibrasMusicDownloads([], [], new Set([1]), "default");

    // 0,2% de um item — longe de 0, arredondado, mas suficiente para amostras.
    expect(durante).toBeCloseTo(0.2);
  });

  it("registra a bíblia como 'libras-bible' (o id que a tela procura)", async () => {
    h.dbGet.mockResolvedValue({ 1: "No princípio..." });
    h.translateBibleChapter.mockImplementation(async () => ({ id: "bible_GN_1_1" }));

    const { sync, tasks } = await mountSync();
    await sync.startLibrasBibleDownloads([1], [version], books, "pt", "default");

    const task = tasks.tasks.value.find((t) => t.id === "libras-bible");
    expect(task).toBeTruthy();
    expect(task?._total).toBe(1);
    expect(task?._done).toBe(1);
    expect(tasks.tasks.value.some((t) => t.id === "sync-bible-libras")).toBe(false);
  });
});

describe("librasItemFraction", () => {
  it("reserva a tradução e os bundles em trechos que não regridem", async () => {
    vi.resetModules();
    const { librasItemFraction } = await import("@/composables/useSyncManager");

    expect(librasItemFraction("translate", 0, 2)).toBe(0);
    expect(librasItemFraction("translate", 1, 2)).toBeCloseTo(0.1);
    expect(librasItemFraction("translate", 2, 2)).toBeCloseTo(0.2);
    expect(librasItemFraction("download", 0, 2)).toBeCloseTo(0.2);
    expect(librasItemFraction("download", 1, 2)).toBeCloseTo(0.6);
    expect(librasItemFraction("download", 2, 2)).toBeCloseTo(1);
  });
});

describe("progresso do cartão da Bíblia (Sincronizar)", () => {
  it("reserva 5% ao bundle e continua dos capítulos sem regredir", async () => {
    vi.resetModules();
    const { syncBibleBundleProgress, syncBibleChaptersProgress } =
      await import("@/composables/useSyncManager");

    expect(syncBibleBundleProgress(0)).toBe(0);
    expect(syncBibleBundleProgress(100)).toBe(5);
    expect(syncBibleChaptersProgress(0, 100)).toBe(5);
    expect(syncBibleChaptersProgress(1, 1189)).toBeCloseTo(5 + 95 / 1189);
    expect(syncBibleChaptersProgress(1189, 1189)).toBe(100);
    expect(syncBibleChaptersProgress(0, 0)).toBe(5);
  });
});
