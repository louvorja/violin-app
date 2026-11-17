/**
 * "Adicionar tudo à playlist" no menu de contexto do chip de categoria.
 *
 * O chip em si é testado em `src/components/__tests__/CategoryChip.spec.ts`;
 * aqui interessa o efeito na Biblioteca: a categoria inteira entra na playlist,
 * na ordem da grade, sem duplicar o que já estava lá.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { DB_TABLE } from "@/constants/DbTables";

const snackbar = vi.fn();
const userdataSet = vi.fn((_key: string, _value: unknown) => {});
const idbGetAll = vi.fn(async (_store: string): Promise<unknown[]> => []);

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    isMac: false,
    isWeb: false,
    api: { shell: { openPath: vi.fn(async () => ({ ok: false, error: "sem" })) } },
    displays: { getPreferred: async () => null },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (_key: string, fallback?: unknown) => fallback,
    set: (key: string, value: unknown) => userdataSet(key, value),
  },
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback ?? false, set: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: {
    show: (...args: unknown[]) => snackbar(...args),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("@/helpers/Alert", () => ({
  default: { confirm: vi.fn(async () => false), error: vi.fn() },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), log: vi.fn() },
}));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: vi.fn(async () => null),
  NET_TIMEOUT: { DEFAULT: 1 },
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: vi.fn(), listen: () => () => {}, getLastPayload: () => null },
}));
vi.mock("@/helpers/BroadcastTypes", () => ({
  BROADCAST_TYPE: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeProjectionWindows: vi.fn(async () => {}),
  openSiteWindow: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Path", () => ({
  default: {
    local: (path: string) => `louvorja://${path}`,
    media: (path: string) => (path.startsWith("louvorja://") ? path : `louvorja://${path}`),
  },
}));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (path: string) => path }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: (...args: unknown[]) => idbGetAll(String(args[0])),
    put: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/ImageConvert", () => ({
  isHeic: () => false,
  ensureRenderableImage: vi.fn(),
  heicToJpeg: vi.fn(),
}));
vi.mock("@/composables/useViewport", () => ({ useViewport: () => ({ width: 1400 }) }));
vi.mock("@/composables/useBroadcastListener", () => ({ useBroadcastListener: vi.fn() }));
vi.mock("@/composables/useMedia", () => ({
  default: {
    projectFile: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    registerNavigationDelegate: vi.fn(),
    unregisterNavigationDelegate: vi.fn(),
    stopAudioFile: vi.fn(),
  },
}));
vi.mock("@/composables/useFileProjection", () => ({
  useFileProjection: () => ({
    isProjecting: { value: false },
    currentType: { value: null },
    currentItemName: { value: "" },
    currentIndex: { value: 0 },
    playlistLength: { value: 0 },
    start: vi.fn(),
    stop: vi.fn(),
    stopProjection: vi.fn(),
  }),
}));
vi.mock("@/components/ModuleContainer.vue", () => ({
  default: {
    methods: { tm: (key: string) => key },
    template: "<div><slot /></div>",
  },
}));
vi.mock("@/components/CategoryManagerDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/CategoryDragGhost.vue", () => ({
  default: { template: "<div class='category-drag-ghost' />" },
}));
vi.mock("./CanvaTab.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/ui", () => {
  const pass = { template: "<span><slot /></span>" };
  return {
    LjButton: {
      props: ["title"],
      template: `<button type="button" :data-title="title" @click="$emit('click', $event)"><slot /></button>`,
    },
    LjDialog: pass,
    LjDivider: pass,
    LjEmpty: pass,
    LjIcon: pass,
    LjInput: { template: "<input />" },
    LjSelect: { template: "<select />" },
    LjTabs: pass,
  };
});

import Index from "../Index.vue";
import CategoryChipsBar from "@/components/CategoryChipsBar.vue";

const PLAYLIST_KEY = "modules.media_library.playlist";

const CATEGORIAS = [
  { id: "cat1", name: "Culto", icon: "folder", iconType: "icon" as const, color: "#4CAF50" },
  { id: "cat2", name: "Ensaios", icon: "music", iconType: "icon" as const, color: "#2196F3" },
];

/* A ordem no IndexedDB é `addedAt` desc; cat1 tem foto + vídeo. */
const ARQUIVOS = [
  {
    id: "f4",
    name: "ensaio.png",
    path: "ensaio.png",
    type: "image" as const,
    categoryId: "cat2",
    addedAt: 4,
  },
  {
    id: "f1",
    name: "foto.png",
    path: "foto.png",
    type: "image" as const,
    categoryId: "cat1",
    addedAt: 3,
  },
  {
    id: "f2",
    name: "video.mp4",
    path: "video.mp4",
    type: "video" as const,
    categoryId: "cat1",
    addedAt: 2,
  },
  {
    id: "f3",
    name: "avulso.png",
    path: "avulso.png",
    type: "image" as const,
    categoryId: "",
    addedAt: 1,
  },
];

let wrapper: VueWrapper;

async function montar(): Promise<VueWrapper> {
  idbGetAll.mockImplementation(async (store: string) =>
    store === DB_TABLE.MEDIA_LIBRARY_CATEGORY
      ? CATEGORIAS.map((category) => ({ ...category }))
      : ARQUIVOS.map((file) => ({ ...file }))
  );
  wrapper = mount(Index);
  await flushPromises();
  return wrapper;
}

/** Emite o evento do menu do chip (é o que o `CategoryChip` faz ao clicar). */
async function adicionarTudo(categoryId: string): Promise<void> {
  wrapper.findComponent(CategoryChipsBar).vm.$emit("add-all", categoryId);
  await flushPromises();
}

const nomesDaPlaylist = (): string[] =>
  wrapper.findAll(".media-playlist-item-name").map((name) => name.text());

beforeEach(async () => {
  vi.clearAllMocks();
  snackbar.mockClear();
  await montar();
});

afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});

describe("Biblioteca de Mídia: adicionar a categoria inteira à playlist", () => {
  it("passa o rótulo do menu para a barra de categorias", () => {
    expect(wrapper.findComponent(CategoryChipsBar).props("addAllLabel")).toBe(
      "add_all_to_playlist"
    );
  });

  it("enfileira todos os itens da categoria, na ordem da grade", async () => {
    await adicionarTudo("cat1");

    expect(nomesDaPlaylist()).toEqual(["foto.png", "video.mp4"]);
    expect(userdataSet).toHaveBeenCalledWith(PLAYLIST_KEY, [
      { id: "f1", name: "foto.png", path: "foto.png", type: "image" },
      { id: "f2", name: "video.mp4", path: "video.mp4", type: "video" },
    ]);
    expect(snackbar).toHaveBeenCalledWith("added_all_to_playlist");
  });

  it("não mexe na playlist de outra categoria", async () => {
    await adicionarTudo("cat2");

    expect(nomesDaPlaylist()).toEqual(["ensaio.png"]);
  });

  it("trata o chip Sem categoria como uma categoria", async () => {
    await adicionarTudo("");

    expect(nomesDaPlaylist()).toEqual(["avulso.png"]);
  });

  it("é idempotente: repetir não duplica o que já está na playlist", async () => {
    await adicionarTudo("cat1");
    await adicionarTudo("cat1");

    expect(nomesDaPlaylist()).toEqual(["foto.png", "video.mp4"]);
    expect(userdataSet.mock.calls.filter(([chave]) => chave === PLAYLIST_KEY)).toHaveLength(1);
    expect(snackbar).toHaveBeenLastCalledWith("all_in_playlist");
  });
});
