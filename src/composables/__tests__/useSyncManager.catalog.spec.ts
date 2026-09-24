/**
 * useSyncManager.catalog.spec.ts — o boot só verifica o marker local. Instalar o
 * ZIP geral e abrir milhares de registros do catálogo exigem uma ação explícita.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, ref } from "vue";

const h = vi.hoisted(() => ({
  events: [] as string[],
  platform: { isDesktop: true, storage: undefined as unknown },
  hasBundleMarker: vi.fn(),
  fullInstall: vi.fn(),
  bibleIsInstalled: vi.fn(),
  bibleInstall: vi.fn(),
  dbGet: vi.fn(),
  dbGetLocal: vi.fn(),
  storedIds: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));
vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/BundleInstaller", () => ({
  default: { hasBundleMarker: h.hasBundleMarker, install: h.fullInstall },
}));
vi.mock("@/helpers/BibleBundleInstaller", () => ({
  default: { isInstalled: h.bibleIsInstalled, install: h.bibleInstall },
}));
vi.mock("@/helpers/Database", () => ({
  default: { get: h.dbGet, getLocal: h.dbGetLocal, getStoredIdsForPrefix: h.storedIds },
}));

const CATALOG: Record<string, unknown> = {
  pt_categories: [{ id_category: 1, order: 1, albums: [{ id_album: 7 }] }],
  pt_hymnal: [],
  pt_doxology_albums: [],
  pt_bible_version: [{ id_bible_version: 1 }],
  pt_bible_book: [{ id_bible_book: 1, chapters: 2 }],
  album_7: { url_image: null, musics: [{ id_music: 1 }, { id_music: 2 }] },
  music_1: { url_music: "/musics/pt/A/1.opus" },
  music_2: { url_music: "/musics/pt/A/2.opus" },
};

// Estado de módulo (catálogo pronto, última falha) precisa recomeçar a cada caso.
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

const catalogReads = () => h.dbGet.mock.calls.map(([key]) => key as string);
const localCatalogReads = () => h.dbGetLocal.mock.calls.map(([key]) => key as string);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  h.events.length = 0;
  h.platform.isDesktop = true;
  h.platform.storage = { checkLocal: vi.fn(async () => ({})) };
  for (const fn of [h.hasBundleMarker, h.fullInstall, h.bibleIsInstalled, h.bibleInstall]) {
    fn.mockReset();
  }
  h.dbGet.mockReset();
  h.dbGetLocal.mockReset();
  h.storedIds.mockReset();

  h.hasBundleMarker.mockResolvedValue(false);
  h.bibleIsInstalled.mockResolvedValue(false);
  h.fullInstall.mockImplementation(async () => {
    h.events.push("bundle");
  });
  h.bibleInstall.mockResolvedValue(undefined);
  h.dbGet.mockImplementation(async (key: string) => {
    h.events.push(`get:${key}`);
    return CATALOG[key] ?? null;
  });
  h.dbGetLocal.mockImplementation(async (key: string) => {
    h.events.push(`local:${key}`);
    return CATALOG[key] ?? null;
  });
  h.storedIds.mockResolvedValue(new Set());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Verificação Inicial leve", () => {
  it("no primeiro boot consulta apenas o marker, sem ZIP nem leitura do catálogo", async () => {
    const sync = await mountSync();

    const result = await sync.runScan("pt");

    expect(result).toMatchObject({ catalogAvailable: false, detailed: false });
    expect(h.hasBundleMarker).toHaveBeenCalledTimes(1);
    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.bibleInstall).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(h.dbGetLocal).not.toHaveBeenCalled();
  });

  it("mesmo com marker não inicia a varredura detalhada automaticamente", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    const sync = await mountSync();

    const result = await sync.runScan("pt");

    expect(result).toMatchObject({ catalogAvailable: true, detailed: false });
    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(h.dbGetLocal).not.toHaveBeenCalled();
  });

  it("pedir detalhes sem catálogo falha de modo recuperável e não instala sozinho", async () => {
    const sync = await mountSync();

    const result = await sync.runScan("pt", { detailed: true });

    expect(result).toMatchObject({ catalogAvailable: false, detailed: false });
    expect(result.categories).toEqual([]);
    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(h.dbGetLocal).not.toHaveBeenCalled();
  });

  it("só após ação explícita instala o catálogo geral", async () => {
    const sync = await mountSync();
    await sync.runScan("pt");

    expect(await sync.downloadBundle()).toBe(true);

    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.bibleInstall).not.toHaveBeenCalled();
    expect(await sync.runScan("pt", { detailed: true })).toMatchObject({
      catalogAvailable: true,
      detailed: true,
    });
  });

  it("a varredura autorizada lê somente o catálogo local", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    const sync = await mountSync();

    const result = await sync.runScan("pt", { detailed: true });

    expect(result).toMatchObject({ catalogAvailable: true, detailed: true });
    expect(localCatalogReads()).toContain("pt_categories");
    expect(localCatalogReads()).toContain("album_7");
    expect(localCatalogReads()).toContain("music_1");
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("na web também mantém o boot leve", async () => {
    h.platform.isDesktop = false;
    h.platform.storage = undefined;
    const sync = await mountSync();

    const result = await sync.runScan("pt");

    expect(result).toMatchObject({ catalogAvailable: true, detailed: false });
    expect(h.hasBundleMarker).not.toHaveBeenCalled();
    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
  });
});

describe("bundle da Bíblia e bundle geral em andamento", () => {
  it("o catálogo espera o bundle só da Bíblia terminar e baixa o seu", async () => {
    const bible = deferred();
    h.bibleInstall.mockImplementation(async () => {
      h.events.push("bible:start");
      await bible.promise;
      h.events.push("bible:end");
    });
    const sync = await mountSync();

    const ensuringBible = sync.ensureBibleBundle();
    await vi.waitFor(() => expect(h.events).toContain("bible:start"));
    const ensuringCatalog = sync.ensureCatalogBundle();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.fullInstall).not.toHaveBeenCalled();

    bible.resolve();
    expect(await ensuringBible).toBe(true);
    expect(await ensuringCatalog).toBe(true);

    expect(h.events).toEqual(["bible:start", "bible:end", "bundle"]);
    expect(h.bibleInstall).toHaveBeenCalledTimes(1);
    expect(h.fullInstall).toHaveBeenCalledTimes(1);
  });

  it("a Bíblia aproveita o bundle geral que já está descendo", async () => {
    const full = deferred();
    h.fullInstall.mockImplementation(async () => {
      h.events.push("bundle:start");
      await full.promise;
    });
    const sync = await mountSync();

    const ensuringCatalog = sync.ensureCatalogBundle();
    await vi.waitFor(() => expect(h.events).toContain("bundle:start"));
    const ensuringBible = sync.ensureBibleBundle();
    full.resolve();

    expect(await ensuringCatalog).toBe(true);
    expect(await ensuringBible).toBe(true);
    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.bibleInstall).not.toHaveBeenCalled();
  });

  it("depois do bundle geral a Bíblia não baixa mais nada", async () => {
    const sync = await mountSync();

    await sync.ensureCatalogBundle();
    h.bibleIsInstalled.mockClear();

    expect(await sync.ensureBibleBundle()).toBe(true);
    expect(h.bibleInstall).not.toHaveBeenCalled();
  });
});

describe("abrir o Sincronizar (desktop, primeiro uso)", () => {
  // A tela pode buscar as pequenas listas necessárias, mas nunca instala o ZIP
  // geral implicitamente. Detalhes escolhidos continuam sob demanda.
  const openSyncScreen = (sync: Awaited<ReturnType<typeof mountSync>>) =>
    Promise.all([
      sync.loadCatalog("pt"),
      sync.loadBibleVersions("pt"),
      sync.scanBibleVersionsDisk([{ id_bible_version: 1 }] as never, "pt"),
    ]);

  it("lê só as listas pedidas e não instala o bundle geral", async () => {
    const sync = await mountSync();

    await openSyncScreen(sync);

    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.events).toContain("get:pt_categories");
    expect(h.events).toContain("get:pt_bible_version");
    expect(catalogReads().filter((key) => /^(album|music)_/.test(key))).toEqual([]);
  });

  it("um marker existente também não provoca reinstalação", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    const sync = await mountSync();

    await openSyncScreen(sync);

    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("atualizar o catálogo é um pedido de rede de propósito e não espera o bundle", async () => {
    const sync = await mountSync();

    await sync.loadCatalog("pt", { fresh: true });

    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.events).toContain("get:pt_categories");
  });

  it("sem catálogo offline, as listas continuam recuperáveis pela rede", async () => {
    const sync = await mountSync();

    const { categories } = await sync.loadCatalog("pt");

    expect(categories).toHaveLength(1);
    expect(h.events).toContain("get:pt_categories");
    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("uma seleção explícita busca somente seus metadados sob demanda", async () => {
    const sync = await mountSync();

    await sync.collectFiles(new Set([7]), false, []);

    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(catalogReads()).toContain("album_7");
    expect(catalogReads()).toContain("music_1");
    expect(catalogReads()).toContain("music_2");
  });

  it("na web não baixa o bundle geral para ler as listas", async () => {
    h.platform.isDesktop = false;
    h.platform.storage = undefined;
    const sync = await mountSync();

    await openSyncScreen(sync);

    expect(h.fullInstall).not.toHaveBeenCalled();
  });
});
