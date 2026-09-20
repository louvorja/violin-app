/**
 * useSyncManager.catalog.spec.ts — no primeiro uso do desktop a Verificação
 * Inicial escaneia o disco álbum por álbum, o que abre o JSON de cada álbum e de
 * cada música (~2 mil). O catálogo tem que estar local antes: um único bundle,
 * e nunca uma enxurrada de GETs que ninguém pediu.
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
  default: { get: h.dbGet, getStoredIdsForPrefix: h.storedIds },
}));

const CATALOG: Record<string, unknown> = {
  pt_categories: [{ id_category: 1, order: 1, albums: [{ id_album: 7 }] }],
  pt_hymnal: [],
  pt_doxology_albums: [],
  pt_bible_version: [],
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
  h.storedIds.mockResolvedValue(new Set());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Verificação Inicial (desktop, primeiro uso)", () => {
  it("baixa o bundle geral uma vez, antes de ler qualquer lista do catálogo", async () => {
    const sync = await mountSync();

    await sync.runScan("pt");

    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.events[0]).toBe("bundle");
    expect(h.events.indexOf("get:pt_categories")).toBeGreaterThan(h.events.indexOf("bundle"));
    // O bundle é o banco completo: a Bíblia vem junto e não precisa do seu ZIP.
    expect(h.bibleInstall).not.toHaveBeenCalled();
  });

  it("com o catálogo já instalado, não baixa nada", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    const sync = await mountSync();

    await sync.runScan("pt");

    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(catalogReads()).toContain("album_7");
  });

  it("se o bundle falha, o scan automático não abre álbum nem música", async () => {
    h.fullInstall.mockRejectedValue(new Error("rede caiu"));
    const sync = await mountSync();

    const result = await sync.runScan("pt");

    expect(result.cachedAlbums.size).toBe(0);
    expect(catalogReads().filter((k) => /^(album|music)_/.test(k))).toEqual([]);
  });

  it("não tenta de novo dentro da pausa depois de uma falha", async () => {
    h.fullInstall.mockRejectedValue(new Error("rede caiu"));
    const sync = await mountSync();

    await sync.runScan("pt");
    await sync.runScan("pt");

    expect(h.fullInstall).toHaveBeenCalledTimes(1);
  });

  it("na web, que não escaneia o disco, nunca baixa o bundle geral", async () => {
    h.platform.isDesktop = false;
    h.platform.storage = undefined;
    const sync = await mountSync();

    await sync.runScan("pt");

    expect(h.fullInstall).not.toHaveBeenCalled();
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
