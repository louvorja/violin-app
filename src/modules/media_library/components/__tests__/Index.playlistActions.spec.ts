/**
 * Clique no card da biblioteca: o que cada um dos dois faz.
 *
 * O card tem duas ações que uma vez eram a mesma coisa:
 *
 * - **clicar no card** projeta o arquivo AVULSO (não entra na playlist);
 * - **ícone "+"** enfileira sem projetar.
 *
 * A separação é o que este spec trava — junto com o `@click.stop` do ícone, que
 * é a diferença entre "enfileirar" e "enfileirar e projetar".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const projectFile = vi.fn(async (_payload: unknown) => true);
const registerDelegate = vi.fn();
const unregisterDelegate = vi.fn();
const userdataSet = vi.fn((_key: string, _value: unknown) => {});
const snackbar = vi.fn();

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
  default: { get: (_k: string, f?: unknown) => f ?? false, set: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { show: (...a: unknown[]) => snackbar(...a), warning: vi.fn(), error: vi.fn() },
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
  BROADCAST_TYPE: new Proxy({}, { get: (_t, chave) => String(chave) }),
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeProjectionWindows: vi.fn(async () => {}),
  openProjectionWindows: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Path", () => ({ default: { local: (p: string) => `louvorja://${p}` } }));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (p: string) => p }));
/* A biblioteca vem do IndexedDB por `getAll`; o resto é tabela de categorias. */
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async () => []),
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
    projectFile: (payload: unknown) => projectFile(payload),
    close: vi.fn(async () => {}),
    registerNavigationDelegate: (d: unknown) => registerDelegate(d),
    unregisterNavigationDelegate: () => unregisterDelegate(),
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
/* O módulo usa a `tm` do container para os textos — sem ela o template nem
   renderiza. */
vi.mock("@/components/ModuleContainer.vue", () => ({
  default: {
    methods: { tm: (key: string) => key },
    template: "<div><slot /></div>",
  },
}));
vi.mock("@/components/CategoryManagerDialog.vue", () => ({
  default: { template: "<div />" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}));
vi.mock("./CanvaTab.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/ui", () => {
  /*
   * Repassa o evento DOM no emit: é assim que o `LjButton` real funciona, e é
   * o que permite `@click.stop` — sem o evento, o modificador quebra.
   */
  const LjButton = {
    props: ["title"],
    template: `<button type="button" :data-title="title" @click="$emit('click', $event)"><slot /></button>`,
  };
  const pass = { template: "<span><slot /></span>" };
  return {
    LjButton,
    LjDialog: pass,
    LjDivider: pass,
    LjEmpty: pass,
    LjIcon: pass,
    LjInput: { template: "<input />" },
    LjTabs: pass,
  };
});

import Index from "../Index.vue";

/* Chave real da playlist em `modules.media_library`. */
const PLAYLIST_KEY = "modules.media_library.playlist";

const ARQUIVO = {
  id: "f1",
  name: "anuncio.png",
  path: "anuncio.png",
  type: "image" as const,
  categoryId: "",
  size: 10,
  createdAt: 1,
};

let wrapper: VueWrapper;

async function montar(): Promise<VueWrapper> {
  wrapper = mount(Index);
  await flushPromises();
  return wrapper;
}

/** Os cards da grade (a playlist é a outra lista da tela). */
const card = (w: VueWrapper) => w.find(".media-grid-item");
/** O "+" do card: o primeiro botão da fileira de ações. */
const botaoMais = (w: VueWrapper) => w.find(".media-grid-item-actions button");

beforeEach(async () => {
  projectFile.mockClear();
  registerDelegate.mockClear();
  unregisterDelegate.mockClear();
  userdataSet.mockClear();
  snackbar.mockClear();
  vi.clearAllMocks();
  projectFile.mockResolvedValue(true);

  /* Um arquivo na biblioteca, sem playlist salva. */
  const idb = await import("@/helpers/IndexedDB");
  (idb.default.getAll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([ARQUIVO]);
  await montar();
});

describe("card da biblioteca: projetar x enfileirar", () => {
  it("clicar no card projeta o arquivo", async () => {
    await card(wrapper).trigger("click");
    await flushPromises();

    expect(projectFile).toHaveBeenCalledTimes(1);
    expect(projectFile.mock.calls[0][0]).toMatchObject({
      type: "image",
      title: "anuncio.png",
    });
  });

  it("clicar no card NÃO põe o arquivo na playlist", async () => {
    await card(wrapper).trigger("click");
    await flushPromises();

    /* A playlist é persistida inteira de uma vez; nada disso pode mudar. */
    const gravouPlaylist = userdataSet.mock.calls.filter(([chave]) => chave === PLAYLIST_KEY);
    expect(gravouPlaylist).toEqual([]);
    expect(wrapper.find(".media-playlist-item").exists()).toBe(false);
  });

  it("projeção avulsa não registra as setas para percorrer a lista", async () => {
    await card(wrapper).trigger("click");
    await flushPromises();

    /* Sem lista no ar, a seta volta a ser do PDF e do deck de música. */
    expect(registerDelegate).not.toHaveBeenCalled();
    expect(unregisterDelegate).toHaveBeenCalled();
  });

  it("o ícone + enfileira sem projetar", async () => {
    expect(botaoMais(wrapper).attributes("data-title")).toBe("add_to_playlist");

    await botaoMais(wrapper).trigger("click");
    await flushPromises();

    expect(projectFile).not.toHaveBeenCalled();
    expect(wrapper.find(".media-playlist-item").exists()).toBe(true);
  });

  it("o ícone + não dispara a projeção do card (click.stop)", async () => {
    /*
     * Sem o `.stop`, o clique no ícone também sobe para o card e o item é
     * enfileirado E projetado — que era o comportamento antes de separá-los.
     */
    await botaoMais(wrapper).trigger("click");
    await flushPromises();

    expect(projectFile).not.toHaveBeenCalled();
  });

  it("o ícone + confirma a entrada na playlist", async () => {
    await botaoMais(wrapper).trigger("click");
    await flushPromises();

    /* A chave já existia sem uso: o clique deixou de adicionar, então a
       confirmação é o que diz que o item entrou. */
    expect(snackbar).toHaveBeenCalledWith("added_to_playlist");
  });
});
