/**
 * Miniatura dos vídeos da Biblioteca.
 *
 * `buildThumbPath` não gera miniatura: devolve `louvorja://local/<arquivo>`. Para
 * **imagem** isso funciona — o arquivo é a própria imagem. Para **vídeo** punha um
 * MP4 no `src` de um `<img>` (ícone quebrado) e, como o campo ficava
 * preenchido, o vídeo nunca entrava na fila que gera a miniatura de verdade. Como
 * o importo gera e guarda uma miniatura real, ao reabrir o módulo ela era
 * sobrescrita e o card passava a mostrar o ícone quebrado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const userdataSet = vi.fn();
const idbPut = vi.fn(async () => {});

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
vi.mock("@/helpers/Path", () => ({ default: { local: (p: string) => `louvorja://local${p}` } }));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (p: string) => p }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async () => []),
    put: (...a: unknown[]) => idbPut(...(a as [])),
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
  default: { methods: { tm: (key: string) => key }, template: "<div><slot /></div>" },
}));
vi.mock("@/components/CategoryManagerDialog.vue", () => ({ default: { template: "<div />" } }));
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
    LjTabs: pass,
  };
});

import Index from "../Index.vue";

/** Arquivo da biblioteca; `thumb` é o que veio gravado no IndexedDB. */
function arquivo(extra: Record<string, unknown> = {}) {
  return {
    id: "f1",
    name: "oferta.mp4",
    path: "/Users/operator/video/oferta.mp4",
    type: "video" as const,
    categoryId: "",
    addedAt: 2,
    ...extra,
  };
}

/** Vídeos criados pela geração de miniatura (o `<video>` do componente). */
let videosCriados = 0;

/* Fora do beforeEach: espiar `createElement` duas vezes faria a segunda
   envelopar a primeira, e a terceira chamaria a segunda… até estourar a pilha. */
const createElementReal = document.createElement.bind(document);

beforeEach(() => {
  vi.restoreAllMocks();
  userdataSet.mockClear();
  idbPut.mockClear();
  videosCriados = 0;

  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, opts?: ElementCreationOptions) => {
      if (String(tag).toLowerCase() === "video") videosCriados++;
      return createElementReal(tag, opts);
    }
  );
});

async function abrirCom(lista: Array<Record<string, unknown>>): Promise<VueWrapper> {
  const idb = await import("@/helpers/IndexedDB");
  (idb.default.getAll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(lista);
  const w = mountUi(Index);
  await flushPromises();
  return w;
}

const card = (w: VueWrapper) => w.find(".media-grid-item");
const imgMiniatura = (w: VueWrapper) => w.find(".media-grid-item-thumb");
const iconeTipo = (w: VueWrapper) => w.find(".media-grid-item-thumb--icon");

describe("miniatura no reabrir do módulo", () => {
  it("não troca a miniatura guardada de um vídeo pelo caminho do arquivo", async () => {
    /* O bug: a miniatura de verdade (data URL) era sobrescrita por
       `louvorja://local/<arquivo>` — e um MP4 no `src` de um `<img>` quebra. */
    const guardada = "data:image/jpeg;base64,AAAAAAAA";
    const w = await abrirCom([arquivo({ thumb: guardada })]);

    expect(imgMiniatura(w).attributes("src")).toBe(guardada);
    expect(iconeTipo(w).exists()).toBe(false);
    /* E o vídeo com miniatura não vai para a fila: não há o que gerar. */
    expect(videosCriados).toBe(0);
  });

  it("vídeo sem miniatura entra na fila em vez de receber o caminho do arquivo", async () => {
    const w = await abrirCom([arquivo()]);

    /* Sem miniatura guardada, o card mostra o ícone do tipo…
       …e a fila gera uma de verdade. */
    expect(iconeTipo(w).exists()).toBe(true);
    await flushPromises();
    expect(videosCriados).toBeGreaterThan(0);
  });

  it("imagem sem miniatura continua usando o próprio arquivo", async () => {
    /* buildThumbPath é a intenção original para imagem: evita embutir a imagem
       inteira no banco. Não pode regredir junto com a correção do vídeo. */
    const w = await abrirCom([
      arquivo({ type: "image", name: "capa.png", path: "/Users/operator/img/capa.png" }),
    ]);

    expect(imgMiniatura(w).attributes("src")).toBe("louvorja://local/Users/operator/img/capa.png");
    expect(videosCriados).toBe(0);
  });

  it("imagem que já tem miniatura guardada mantém a que tem", async () => {
    const guardada = "louvorja://local/Users/operator/img/antiga.png";
    const w = await abrirCom([
      arquivo({
        type: "image",
        name: "capa.png",
        path: "/Users/operator/img/capa.png",
        thumb: guardada,
      }),
    ]);

    expect(imgMiniatura(w).attributes("src")).toBe(guardada);
  });
});

describe("auto-cura: miniatura que não carrega", () => {
  it("miniatura quebrada de vídeo limpa o campo e enfileira outra", async () => {
    /* Um thumb envenenado (MP4 gravado por um renomear) fica preso para sempre
       sem isto: o card mostra o ícone quebrado e nada tentaria de novo. */
    const w = await abrirCom([
      arquivo({ thumb: "louvorja://local/Users/operator/video/oferta.mp4" }),
    ]);

    await imgMiniatura(w).trigger("error");
    await flushPromises();

    /* O campo some (o `v-if` cai para o ícone do tipo)… */
    expect(iconeTipo(w).exists()).toBe(true);
    /* …e a regeneração entra na fila. */
    expect(videosCriados).toBeGreaterThan(0);
  });

  it("imagem que não carrega limpa o campo e não tenta gerar nada", async () => {
    const w = await abrirCom([
      arquivo({ type: "image", name: "capa.png", path: "/Users/operator/img/capa.png" }),
    ]);

    await imgMiniatura(w).trigger("error");
    await flushPromises();

    /* Arquivo movido não tem miniatura a fazer: vira o ícone do tipo. */
    expect(iconeTipo(w).exists()).toBe(true);
    expect(videosCriados).toBe(0);
  });
});
