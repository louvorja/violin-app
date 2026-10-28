/**
 * Áudio na Biblioteca de Mídia.
 *
 * O áudio NÃO é projetado: ele entra no player de mídia (`openAudio`), que abre
 * com título e controles. `projectFile` rejeitaria o tipo, e chamá-lo seria o
 * bug. O clique continua sendo "tocar avulso"; o "+" continua enfileirando.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  arquivos: [
    {
      id: "a1",
      name: "fundo.mp3",
      path: "blob:audio",
      type: "audio",
      addedAt: 3,
      categoryId: "",
      data: new ArrayBuffer(8),
      mime: "audio/mpeg",
    },
    {
      id: "v1",
      name: "clipe.mp4",
      path: "clipe.mp4",
      type: "video",
      addedAt: 2,
      categoryId: "",
    },
    {
      id: "i1",
      name: "foto.png",
      path: "foto.png",
      type: "image",
      addedAt: 1,
      categoryId: "",
    },
  ],
}));

const openAudio = vi.fn(async (_params: unknown) => {});
const stopAudioFile = vi.fn();
const projectFile = vi.fn(async (_payload: unknown) => true);
const userdataSet = vi.fn((_key: string, _value: unknown) => {});

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    isMac: false,
    isWeb: false,
    api: { shell: { openPath: vi.fn(async () => ({ ok: false })) } },
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
  default: { show: vi.fn(), warning: vi.fn(), error: vi.fn() },
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
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async (tabela: string) => (tabela === "media_library" ? h.arquivos : [])),
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
/** Guarda o listener do ribbon para simular as ações da fita. */
const h_ribbon = vi.hoisted(() => ({ cb: null as null | ((_p: unknown) => void) }));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (tipo: unknown, cb: (_p: unknown) => void) => {
    if (String(tipo) === "MODULE_RIBBON_ACTION") h_ribbon.cb = cb;
  },
}));
vi.mock("@/composables/useMedia", () => ({
  default: {
    projectFile: (payload: unknown) => projectFile(payload),
    openAudio: (params: unknown) => openAudio(params),
    stopAudioFile: () => stopAudioFile(),
    close: vi.fn(async () => {}),
    registerNavigationDelegate: vi.fn(),
    unregisterNavigationDelegate: vi.fn(),
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
vi.mock("@/components/CategoryManagerDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("./CanvaTab.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/ui", () => {
  const LjButton = {
    props: ["title"],
    emits: ["click"],
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

const PLAYLIST_KEY = "modules.media_library.playlist";

let wrapper: VueWrapper;

const cards = (w: VueWrapper) => w.findAll(".media-grid-item");

beforeEach(async () => {
  vi.clearAllMocks();
  projectFile.mockResolvedValue(true);
  openAudio.mockResolvedValue(undefined);
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
    "blob:novo";

  wrapper = mount(Index);
  await flushPromises();
});

describe("áudio: player de mídia", () => {
  it("clicar no card de áudio toca no player MINIMIZADO e NÃO projeta", async () => {
    expect(cards(wrapper)).toHaveLength(3);

    await cards(wrapper)[0].trigger("click");
    await flushPromises();

    expect(openAudio).toHaveBeenCalledTimes(1);
    expect(openAudio.mock.calls[0][0]).toMatchObject({
      mediaType: "audio",
      title: "fundo.mp3",
      /* Minimizado: a janela do player não abre por cima do operador. */
      minimized: true,
      /* O telão é preservado: um PDF/versículo continua na tela. */
      preserveFileProjection: true,
    });
    expect(projectFile).not.toHaveBeenCalled();
  });

  it("clicar numa imagem continua projetando (nada muda para os outros tipos)", async () => {
    await cards(wrapper)[2].trigger("click");
    await flushPromises();

    expect(projectFile).toHaveBeenCalledTimes(1);
    expect(openAudio).not.toHaveBeenCalled();
  });

  it("Parar cala o áudio de arquivo (o player não é desta janela)", async () => {
    h_ribbon.cb?.({ module: "media_library", action: "stop" });
    await flushPromises();

    expect(stopAudioFile).toHaveBeenCalledTimes(1);
  });

  it("o + enfileira o áudio sem tocar", async () => {
    await wrapper.find(".media-grid-item-actions button").trigger("click");
    await flushPromises();

    expect(openAudio).not.toHaveBeenCalled();
    const gravou = userdataSet.mock.calls.filter(([chave]) => chave === PLAYLIST_KEY);
    expect(gravou).toHaveLength(1);
    expect(wrapper.find(".media-playlist-item").exists()).toBe(true);
  });
});
