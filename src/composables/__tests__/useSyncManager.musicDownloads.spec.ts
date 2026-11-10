import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, ref, type App } from "vue";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true, storage: undefined as unknown },
  catalog: {} as Record<string, unknown>,
  files: new Map<string, "own" | "classic">(),
  get: vi.fn(),
  getLocal: vi.fn(),
  checkLocal: vi.fn(),
  removeFiles: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
}));
vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/Database", () => ({
  default: { get: h.get, getLocal: h.getLocal },
  setDatabaseTimingReporter: vi.fn(),
}));
vi.mock("@/helpers/BundleInstaller", () => ({
  default: { hasBundleMarker: vi.fn(async () => true) },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn() },
}));

const apps: App[] = [];
const categories = [{ id_category: 1, albums: [{ id_album: 7 }] }];
const cover = "/images/shared-cover.jpg";
const background = "/images/shared-background.jpg";
const audio = (id: number) => `/musics/pt/${id}.opus`;
const instrumental = (id: number) => `/musics/pt/${id}-pb.opus`;
const entry = (remote: string) => ({ remote, local: remote.slice(1), expectedSize: 0 });

async function mountSync() {
  vi.resetModules();
  const { createPinia, setActivePinia } = await import("pinia");
  setActivePinia(createPinia());
  const { useSyncManager } = await import("@/composables/useSyncManager");
  let sync!: ReturnType<typeof useSyncManager>;
  const app = createApp({
    setup() {
      sync = useSyncManager();
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  apps.push(app);
  return sync;
}

function album(ids: number[]) {
  h.catalog.album_7 = {
    url_image: cover,
    musics: ids.map((id_music) => ({ id_music })),
  };
}

beforeEach(() => {
  h.catalog = {
    music_1: { url_music: audio(1), url_image: cover, lyric: [{ url_image: background }] },
    music_2: { url_music: audio(2), url_image: cover, lyric: [{ url_image: background }] },
  };
  album([1, 2]);
  h.files.clear();
  h.platform.isDesktop = true;
  h.get.mockReset();
  h.getLocal.mockReset().mockImplementation(async (key: string) => h.catalog[key] ?? null);
  h.checkLocal
    .mockReset()
    .mockImplementation(async (remotes: string[]) =>
      Object.fromEntries(remotes.map((remote) => [remote, h.files.get(remote) ?? false]))
    );
  h.removeFiles.mockReset().mockImplementation(async (remotes: string[]) => {
    for (const remote of remotes) h.files.delete(remote);
  });
  h.platform.storage = { checkLocal: h.checkLocal, removeFiles: h.removeFiles };
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  vi.restoreAllMocks();
});

describe("músicas baixadas e imagens compartilhadas", () => {
  it.each([true, false])(
    "apagar o hinário antigo preserva o atual e imagens não recriam download parcial (desktop=%s)",
    async (desktop) => {
      h.platform.isDesktop = desktop;
      for (const remote of [audio(1), audio(2), cover, background]) h.files.set(remote, "own");
      const sync = await mountSync();
      const initial = await sync.scanCache("pt", [], [1], [2]);
      expect(initial.hymnalCached).toBe(true);
      expect(initial.hymnal1996Cached).toBe(true);

      const oldFiles = await sync.collectHymnalFileList([2], { localOnly: true });
      await sync.removeFilesFromCache(oldFiles);

      expect(h.removeFiles).toHaveBeenCalledExactlyOnceWith([audio(2)]);
      expect(h.files.has(cover)).toBe(true);
      expect(h.files.has(background)).toBe(true);
      let result = await sync.scanCache("pt", [], [1], [2]);
      expect(result.hymnalCached).toBe(true);
      expect(result.hymnal1996Cached).toBe(false);
      expect(result.partialHymnal1996).toBeNull();

      // Navegar ou baixar novamente imagens compartilhadas não baixa uma música.
      h.files.delete(background);
      h.files.set(background, "own");
      result = await sync.scanCache("pt", [], [1], [2], { force: true });
      expect(result.hymnalCached).toBe(true);
      expect(result.hymnal1996Cached).toBe(false);
      expect(result.partialHymnal1996).toBeNull();
      expect(h.get).not.toHaveBeenCalled();
    }
  );

  it("imagens disponíveis sem áudio não contam como músicas nem iniciam parcial", async () => {
    h.files.set(cover, "own");
    h.files.set(background, "own");
    const sync = await mountSync();
    const result = await sync.scanCache("pt", categories, [1, 2], [1, 2]);

    expect(result.cachedAlbums.size).toBe(0);
    expect(result.partialAlbums?.size).toBe(0);
    expect(result.hymnalCached).toBe(false);
    expect(result.partialHymnal).toBeNull();
    expect(result.hymnal1996Cached).toBe(false);
    expect(result.partialHymnal1996).toBeNull();
  });

  it("conta músicas completas, exigindo vocal e instrumental declarados", async () => {
    h.catalog.music_1 = {
      url_music: audio(1),
      url_instrumental_music: instrumental(1),
      url_image: cover,
      lyric: [{ url_image: background }],
    };
    for (const remote of [audio(1), cover, background]) h.files.set(remote, "own");
    const sync = await mountSync();

    let result = await sync.scanCache("pt", categories, [1, 2]);
    expect(result.partialAlbums?.get(7)).toEqual({ have: 0, total: 2 });
    expect(result.partialHymnal).toEqual({ have: 0, total: 2 });

    h.files.set(instrumental(1), "own");
    result = await sync.scanCache("pt", categories, [1, 2], [], { force: true });
    expect(result.partialAlbums?.get(7)).toEqual({ have: 1, total: 2 });
    expect(result.partialHymnal).toEqual({ have: 1, total: 2 });
  });

  it("deduplica IDs, mas conta duas músicas que compartilham um arquivo de áudio", async () => {
    album([1, 1, 2, 3]);
    h.catalog.music_2 = { url_music: audio(1) };
    h.catalog.music_3 = { url_music: audio(3) };
    h.files.set(audio(1), "own");
    const sync = await mountSync();

    const result = await sync.scanCache("pt", categories, [1, 1, 2, 3]);

    expect(result.partialAlbums?.get(7)).toEqual({ have: 2, total: 3 });
    expect(result.partialHymnal).toEqual({ have: 2, total: 3 });
    const files = await sync.collectAlbumFileList(7, { localOnly: true });
    expect(files.filter((file) => file.remote === audio(1))).toHaveLength(1);
  });

  it("áudios completos bastam mesmo sem capa ou fundo no cache", async () => {
    h.files.set(audio(1), "own");
    h.files.set(audio(2), "own");
    const sync = await mountSync();

    const result = await sync.scanCache("pt", categories, [1, 2]);
    const files = await sync.collectAlbumFileList(7, { localOnly: true });

    expect(result.cachedAlbums).toEqual(new Set([7]));
    expect(result.hymnalCached).toBe(true);
    expect(result.partialAlbums?.size).toBe(0);
    expect(await sync.originOfFileList(files)).toBe("own");
    expect(await sync.isFileListComplete(files)).toBe(true);
  });

  it("inclui músicas instrumentais e exclui do total as que não têm áudio", async () => {
    album([1, 2, 3]);
    h.catalog.music_1 = { url_instrumental_music: instrumental(1) };
    h.catalog.music_2 = { url_image: cover, lyric: [{ url_image: background }] };
    h.catalog.music_3 = { url_music: audio(3) };
    h.files.set(instrumental(1), "own");
    const sync = await mountSync();

    let result = await sync.scanCache("pt", categories, [1, 2, 3]);
    expect(result.partialAlbums?.get(7)).toEqual({ have: 1, total: 2 });
    expect(result.partialHymnal).toEqual({ have: 1, total: 2 });

    h.files.set(audio(3), "own");
    result = await sync.scanCache("pt", categories, [1, 2, 3], [], { force: true });
    expect(result.cachedAlbums).toEqual(new Set([7]));
    expect(result.hymnalCached).toBe(true);
  });

  it("coleção sem áudio não aparece como download completo", async () => {
    album([1]);
    h.catalog.music_1 = { url_image: cover };
    h.files.set(cover, "own");
    const sync = await mountSync();

    const result = await sync.scanCache("pt", categories, [1]);
    const files = await sync.collectAlbumFileList(7, { localOnly: true });

    expect(result.cachedAlbums.size).toBe(0);
    expect(result.hymnalCached).toBe(false);
    expect(result.partialHymnal).toBeNull();
    expect(await sync.originOfFileList(files)).toBe(false);
    expect(await sync.isFileListComplete(files)).toBe(false);
  });

  it("reconhece áudio do acervo clássico sem exigir imagens locais", async () => {
    album([1]);
    h.files.set(audio(1), "classic");
    const sync = await mountSync();

    const result = await sync.scanCache("pt", categories, [1]);
    const files = await sync.collectAlbumFileList(7, { localOnly: true });

    expect(result.cachedAlbums).toEqual(new Set([7]));
    expect(result.classicAlbums).toEqual(new Set([7]));
    expect(result.hymnalCached).toBe(true);
    expect(await sync.originOfFileList(files)).toBe("classic");
  });

  it("apaga os áudios pedidos mesmo quando outra música usa o mesmo arquivo", async () => {
    h.catalog.music_2 = { url_music: audio(1), url_instrumental_music: instrumental(2) };
    for (const remote of [audio(1), instrumental(2), cover, background]) h.files.set(remote, "own");
    const sync = await mountSync();
    const removing = await sync.collectHymnalFileList([2], { localOnly: true });
    await sync.removeFilesFromCache(removing);

    expect(h.removeFiles).toHaveBeenCalledExactlyOnceWith([audio(1), instrumental(2)]);
    expect(h.files.has(audio(1))).toBe(false);
    expect(h.files.has(cover)).toBe(true);
    expect(h.files.has(background)).toBe(true);
  });

  it("encaminha os áudios selecionados para exclusão, sem as imagens", async () => {
    const sync = await mountSync();

    await sync.removeFilesFromCache([
      entry(audio(1)),
      entry(audio(2)),
      entry(cover),
      entry(background),
    ]);

    expect(h.removeFiles).toHaveBeenCalledExactlyOnceWith([audio(1), audio(2)]);
  });

  it("uma lista só de imagens nunca chega à operação de exclusão", async () => {
    const sync = await mountSync();

    await sync.removeFilesFromCache([entry(cover), entry(background)]);

    expect(h.removeFiles).not.toHaveBeenCalled();
  });
});
