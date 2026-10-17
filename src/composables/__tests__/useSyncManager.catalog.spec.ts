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
  needsRefresh: vi.fn(),
  installedVersion: vi.fn(),
  remoteConfig: vi.fn(),
  fullInstall: vi.fn(),
  bibleIsInstalled: vi.fn(),
  bibleInstall: vi.fn(),
  dbGet: vi.fn(),
  dbGetLocal: vi.fn(),
  storedIds: vi.fn(),
  track: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));
vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/BundleInstaller", () => ({
  default: {
    hasBundleMarker: h.hasBundleMarker,
    catalogNeedsRefreshForApp: h.needsRefresh,
    getInstalledBundleVersion: h.installedVersion,
    fetchRemoteConfig: h.remoteConfig,
    install: h.fullInstall,
  },
}));
vi.mock("@/helpers/BibleBundleInstaller", () => ({
  default: { isInstalled: h.bibleIsInstalled, install: h.bibleInstall },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: h.track, captureException: h.captureException },
}));
vi.mock("@/helpers/Database", () => ({
  default: { get: h.dbGet, getLocal: h.dbGetLocal, getStoredIdsForPrefix: h.storedIds },
  setDatabaseTimingReporter: vi.fn(),
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
  for (const fn of [
    h.hasBundleMarker,
    h.needsRefresh,
    h.fullInstall,
    h.bibleIsInstalled,
    h.bibleInstall,
  ]) {
    fn.mockReset();
  }
  h.needsRefresh.mockResolvedValue(false);
  h.installedVersion.mockReset().mockResolvedValue(185);
  h.remoteConfig.mockReset().mockResolvedValue({ version_number: 185 });
  h.dbGet.mockReset();
  h.dbGetLocal.mockReset();
  h.storedIds.mockReset();
  h.track.mockReset();
  h.captureException.mockReset();

  h.hasBundleMarker.mockResolvedValue(false);
  h.bibleIsInstalled.mockResolvedValue(false);
  h.fullInstall.mockImplementation(async () => {
    h.events.push("bundle");
    h.hasBundleMarker.mockResolvedValue(true);
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

  it("verificar o acervo não retém os detalhes locais de todos os álbuns e músicas", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    h.platform.isDesktop = false;
    h.platform.storage = {
      checkLocal: vi.fn(async (paths: string[]) =>
        Object.fromEntries(paths.map((path) => [path, "own"]))
      ),
    };
    const sync = await mountSync();

    const result = await sync.scanCache("pt", CATALOG.pt_categories as never, []);

    expect(result.cachedAlbums).toEqual(new Set([7]));
    expect(h.dbGetLocal).toHaveBeenCalledWith("album_7", { remember: false });
    expect(h.dbGetLocal).toHaveBeenCalledWith("music_1", { remember: false });
    expect(h.dbGetLocal).toHaveBeenCalledWith("music_2", { remember: false });
    expect(h.dbGet).not.toHaveBeenCalled();
  });

  it("álbum com parte dos arquivos no disco aparece como parcial, com a contagem", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    h.platform.isDesktop = false;
    let first = true;
    h.platform.storage = {
      // Só o primeiro arquivo pedido existe; os demais faltam.
      checkLocal: vi.fn(async (paths: string[]) =>
        Object.fromEntries(
          paths.map((path, i) => {
            const present = first && i === 0;
            return [path, present ? "own" : false];
          })
        )
      ),
    };
    const sync = await mountSync();

    const result = await sync.scanCache("pt", CATALOG.pt_categories as never, []);
    first = false;

    expect(result.cachedAlbums).toEqual(new Set());
    const partial = result.partialAlbums?.get(7);
    expect(partial).toBeDefined();
    expect(partial!.have).toBe(1);
    expect(partial!.total).toBeGreaterThan(1);
  });

  it("álbum sem nenhum arquivo no disco não é parcial", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    h.platform.isDesktop = false;
    h.platform.storage = {
      checkLocal: vi.fn(async (paths: string[]) =>
        Object.fromEntries(paths.map((path) => [path, false]))
      ),
    };
    const sync = await mountSync();

    const result = await sync.scanCache("pt", CATALOG.pt_categories as never, []);

    expect(result.cachedAlbums).toEqual(new Set());
    expect(result.partialAlbums?.size ?? 0).toBe(0);
  });

  it.each([true, false])(
    "metadado ausente não vira álbum completo (desktop=%s)",
    async (desktop) => {
      h.hasBundleMarker.mockResolvedValue(true);
      h.platform.isDesktop = desktop;
      h.dbGetLocal.mockImplementation(async (key: string) =>
        key === "music_2" ? null : (CATALOG[key] ?? null)
      );
      h.platform.storage = {
        checkLocal: vi.fn(async (paths: string[]) =>
          Object.fromEntries(paths.map((path) => [path, "own"]))
        ),
      };
      const sync = await mountSync();
      const result = await sync.scanCache("pt", CATALOG.pt_categories as never, [1, 2]);
      expect(result.cachedAlbums.size).toBe(0);
      expect(result.hymnalCached).toBe(false);
      expect(h.dbGet).not.toHaveBeenCalled();
      expect(h.fullInstall).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    "fundos e capas sem áudio não fazem outros álbuns parecerem parciais (desktop=%s)",
    async (desktop) => {
      h.hasBundleMarker.mockResolvedValue(true);
      h.platform.isDesktop = desktop;
      h.dbGetLocal.mockImplementation(async (key: string) =>
        key === "music_1"
          ? {
              ...(CATALOG.music_1 as object),
              url_image: "/images/capa.jpg",
              lyric: [{ url_image: "/images/hasd_609.jpg" }],
            }
          : (CATALOG[key] ?? null)
      );
      const present = new Set(["/images/capa.jpg", "/images/hasd_609.jpg"]);
      h.platform.storage = {
        checkLocal: vi.fn(async (paths: string[]) =>
          Object.fromEntries(paths.map((path) => [path, present.has(path) ? "own" : false]))
        ),
      };
      const sync = await mountSync();
      let result = await sync.scanCache("pt", CATALOG.pt_categories as never, []);
      expect(result.cachedAlbums.size).toBe(0);
      expect(result.partialAlbums?.size).toBe(0);
      present.add("/musics/pt/A/1.opus");
      result = await sync.scanCache("pt", CATALOG.pt_categories as never, [], [], { force: true });
      expect(result.partialAlbums?.get(7)).toEqual({ have: 3, total: 4 });
      present.clear();
      result = await sync.scanCache("pt", CATALOG.pt_categories as never, [], [], { force: true });
      expect(result.partialAlbums?.size).toBe(0);
    }
  );
});

describe("lista de arquivos se recupera sozinha", () => {
  const never = () => new Promise<never>(() => {});

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["album_7", "music_2"])("recupera %s pelo bundle sem GET individual", async (missing) => {
    h.hasBundleMarker.mockResolvedValue(true);
    let repaired = false;
    h.dbGetLocal.mockImplementation(async (key: string) =>
      !repaired && key === missing ? null : (CATALOG[key] ?? null)
    );
    h.fullInstall.mockImplementation(async () => {
      repaired = true;
    });
    const sync = await mountSync();
    const files = await sync.collectFiles(new Set([7]), false, []);
    expect(files.map((f) => f.remote)).toEqual(["/musics/pt/A/1.opus", "/musics/pt/A/2.opus"]);
    expect(h.fullInstall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ catalogOnly: true, force: true })
    );
    expect(h.dbGet).not.toHaveBeenCalled();
  });

  it("interrompe com o registro ausente quando o bundle não repara, sem fila incompleta nem tempestade de GETs", async () => {
    h.dbGetLocal.mockImplementation(async (key: string) =>
      key === "music_2" ? null : (CATALOG[key] ?? null)
    );
    h.fullInstall.mockRejectedValue(new Error("offline"));
    const sync = await mountSync();
    await expect(sync.collectAlbumFileList(7)).rejects.toThrow(
      "Catálogo local incompleto: music_2"
    );
    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.dbGet).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(h.track).toHaveBeenCalledWith(
        "sync_catalog_recovery_failed",
        expect.objectContaining({
          dataset: "music_2",
          bundle_installed: false,
          error_name: "CatalogIncompleteError",
        })
      )
    );
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Catálogo local incompleto: music_2" }),
      expect.objectContaining({ source: "sync_catalog_recovery_failed", dataset: "music_2" })
    );
  });

  it("continuar hinário também recupera o catálogo pelo pacote", async () => {
    let repaired = false;
    h.dbGetLocal.mockImplementation(async (key: string) =>
      repaired ? (CATALOG[key] ?? null) : null
    );
    h.fullInstall.mockImplementation(async () => {
      repaired = true;
    });
    const sync = await mountSync();
    expect(await sync.collectHymnalFileList([1, 2])).toHaveLength(2);
    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.dbGet).not.toHaveBeenCalled();
  });

  it("uso em disco lê o hinário correto, sem renovar catálogo nem buscar metadados", async () => {
    const sizeOfPaths = vi.fn(async (paths: string[]) => ({
      bytes: 100 * paths.length,
      count: paths.length,
    }));
    h.platform.storage = { sizeOfPaths };
    const sync = await mountSync();
    expect(await sync.refreshDiskUsage(new Set(), true, false, [], [1, 2])).toMatchObject({
      bytes: 200,
      fileCount: 2,
    });
    expect(sizeOfPaths).toHaveBeenCalledWith(["/musics/pt/A/1.opus", "/musics/pt/A/2.opus"]);
    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
  });

  it("renovação do catálogo pendurada não segura a lista: segue com o catálogo do disco", async () => {
    h.needsRefresh.mockResolvedValue(true);
    h.fullInstall.mockImplementation(never);
    const sync = await mountSync();
    vi.useFakeTimers();

    const pending = sync.collectFiles(new Set([7]), false, []);
    await vi.advanceTimersByTimeAsync(50_000);
    const files = await pending;

    expect(files.length).toBeGreaterThan(0);
    expect(localCatalogReads()).toContain("album_7");
  });

  it("montagem que para de andar reinstala o catálogo e tenta de novo uma vez", async () => {
    let firstRead = true;
    h.dbGetLocal.mockImplementation(async (key: string) => {
      if (key === "album_7" && firstRead) {
        firstRead = false;
        return never();
      }
      return CATALOG[key] ?? null;
    });
    const sync = await mountSync();
    vi.useFakeTimers();

    const pending = sync.collectFiles(new Set([7]), false, []);
    await vi.advanceTimersByTimeAsync(100_000);
    const files = await pending;

    expect(h.fullInstall).toHaveBeenCalledWith(
      expect.objectContaining({ catalogOnly: true, force: true })
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it("se parar de novo, falha em vez de ficar preparando para sempre", async () => {
    h.dbGetLocal.mockImplementation(async (key: string) =>
      key === "album_7" ? never() : (CATALOG[key] ?? null)
    );
    const sync = await mountSync();
    vi.useFakeTimers();

    const outcome = sync.collectFiles(new Set([7]), false, []).then(
      () => "ok",
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(400_000);

    expect(await outcome).toBe("collect_stalled");
  });

  it("download do pacote sem progresso é abandonado e o pedido seguinte não fica preso nele", async () => {
    h.needsRefresh.mockResolvedValue(true);
    h.fullInstall.mockImplementationOnce(never);
    const sync = await mountSync();
    vi.useFakeTimers();

    const stuck = sync.refreshCatalogAfterUpdate();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(await stuck).toBe(false);

    const next = sync.downloadBundle({ catalogOnly: true, force: true });
    await vi.advanceTimersByTimeAsync(50);

    expect(await next).toBe(true);
    expect(h.fullInstall).toHaveBeenCalledTimes(2);
  });

  it("informa o andamento da montagem para a tela mostrar números reais", async () => {
    const sync = await mountSync();
    const seen: Array<[number, number]> = [];

    await sync.collectFiles(new Set([7]), false, [], false, [], (done, total) =>
      seen.push([done, total])
    );

    expect(seen[0]).toEqual([0, 2]);
    expect(seen.at(-1)).toEqual([2, 2]);
  });
});

describe("catálogo renovado a cada versão do app", () => {
  it("atualiza banco publicado sem trocar a versão do app, uma vez, usando a versão real do pacote", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    h.remoteConfig.mockResolvedValue({ version_number: 186 });
    const sync = await mountSync();
    expect(await sync.refreshCatalogAfterUpdate()).toBe(true);
    expect(h.fullInstall).toHaveBeenCalledWith(
      expect.objectContaining({ catalogOnly: true, version: 186 })
    );
    expect(await sync.refreshCatalogAfterUpdate()).toBe(false);
    expect(h.remoteConfig).toHaveBeenCalledTimes(1);
  });

  it("não troca o catálogo por uma versão anterior devolvida pelo fallback", async () => {
    h.hasBundleMarker.mockResolvedValue(true);
    h.remoteConfig.mockResolvedValue({ version_number: 184 });
    const sync = await mountSync();
    expect(await sync.refreshCatalogAfterUpdate()).toBe(false);
    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("reinstala se o marcador for removido depois de uma instalação na mesma sessão", async () => {
    const sync = await mountSync();
    await sync.ensureCatalogBundle();
    h.hasBundleMarker.mockResolvedValue(false);
    await sync.ensureCatalogBundle();
    expect(h.fullInstall).toHaveBeenCalledTimes(2);
  });
  it("catálogo de outra versão: reinstala o pacote de catálogo por cima, sem a Bíblia", async () => {
    h.needsRefresh.mockResolvedValue(true);
    const sync = await mountSync();

    const refreshed = await sync.refreshCatalogAfterUpdate();

    expect(refreshed).toBe(true);
    expect(h.fullInstall).toHaveBeenCalledTimes(1);
    expect(h.fullInstall).toHaveBeenCalledWith(
      expect.objectContaining({ catalogOnly: true, force: true })
    );
    expect(h.bibleInstall).not.toHaveBeenCalled();
  });

  it("catálogo da versão atual (ou ainda inexistente): não baixa nada", async () => {
    h.needsRefresh.mockResolvedValue(false);
    const sync = await mountSync();

    expect(await sync.refreshCatalogAfterUpdate()).toBe(false);
    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("listar arquivos para baixar espera o catálogo da versão atual chegar", async () => {
    h.needsRefresh.mockResolvedValueOnce(true).mockResolvedValue(false);
    const sync = await mountSync();

    const files = await sync.collectAlbumFileList(7);

    expect(h.events.indexOf("bundle")).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf("bundle")).toBeLessThan(h.events.indexOf("local:album_7"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("a leitura local do scan nunca dispara a renovação", async () => {
    h.needsRefresh.mockResolvedValue(true);
    const sync = await mountSync();

    await sync.collectAlbumFileList(7, { localOnly: true });

    expect(h.needsRefresh).not.toHaveBeenCalled();
    expect(h.fullInstall).not.toHaveBeenCalled();
  });

  it("falha na rede mantém o catálogo e não insiste no mesmo boot", async () => {
    h.needsRefresh.mockResolvedValue(true);
    h.fullInstall.mockRejectedValue(new Error("offline"));
    const sync = await mountSync();

    expect(await sync.refreshCatalogAfterUpdate()).toBe(false);
    expect(await sync.refreshCatalogAfterUpdate()).toBe(false);

    expect(h.fullInstall).toHaveBeenCalledTimes(1);
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
    const ensuringCatalog = sync.downloadBundle();
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

    const ensuringCatalog = sync.downloadBundle();
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

    await sync.downloadBundle();
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

  it("uma seleção explícita lê os metadados locais sem GET por música", async () => {
    const sync = await mountSync();

    await sync.collectFiles(new Set([7]), false, []);

    expect(h.fullInstall).not.toHaveBeenCalled();
    expect(localCatalogReads()).toContain("album_7");
    expect(localCatalogReads()).toContain("music_1");
    expect(localCatalogReads()).toContain("music_2");
  });

  it("na web não baixa o bundle geral para ler as listas", async () => {
    h.platform.isDesktop = false;
    h.platform.storage = undefined;
    const sync = await mountSync();

    await openSyncScreen(sync);

    expect(h.fullInstall).not.toHaveBeenCalled();
  });
});

it("catálogo menor não marca Bíblia instalada e mantém o download bíblico independente", async () => {
  const sync = await mountSync();
  await sync.ensureCatalogBundle();
  expect(h.fullInstall).toHaveBeenCalledWith(expect.objectContaining({ catalogOnly: true }));
  expect(h.bibleInstall).not.toHaveBeenCalled();
  await sync.ensureBibleBundle();
  expect(h.bibleInstall).toHaveBeenCalledTimes(1);
});

it("pedido bíblico espera o catálogo em andamento e depois baixa seus capítulos", async () => {
  const pending = deferred();
  h.fullInstall.mockImplementation(() => pending.promise);
  const sync = await mountSync();
  const catalog = sync.ensureCatalogBundle();
  await vi.waitFor(() => expect(h.fullInstall).toHaveBeenCalledTimes(1));
  const bible = sync.ensureBibleBundle();
  await Promise.resolve();
  expect(h.bibleInstall).not.toHaveBeenCalled();
  pending.resolve();
  expect(await catalog).toBe(true);
  expect(await bible).toBe(true);
  expect(h.bibleInstall).toHaveBeenCalledTimes(1);
});
