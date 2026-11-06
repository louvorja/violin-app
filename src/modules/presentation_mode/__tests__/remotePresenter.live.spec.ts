import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

/**
 * Aba Apresentação do celular com qualquer conteúdo do modo apresentação,
 * não só PDF e PowerPoint: o que está no ar (letra, versículo, imagem, anúncio)
 * e o Iniciar/Parar do módulo.
 */

const respostas: Record<string, unknown>[] = [];
const appdata: Record<string, unknown> = {};
const screenOn = ref({ main: false, stage: false });
const startOutputs = vi.fn(async () => {});
const stopOutputs = vi.fn(async () => {});

const live = {
  current: ref<string | null>(null),
  title: ref(""),
  music: {
    slides: ref<{ lyric?: string }[]>([]),
    slideIndex: ref(0),
    slide: ref<{ lyric?: string } | null>(null),
  },
  bible: ref<{ text: string } | null>(null),
  file: ref<{ type: string; url: string; title: string } | null>(null),
  announcement: ref<{ nome?: string; texto?: string } | null>(null),
};

vi.mock("@/helpers/Platform", () => ({
  default: {
    httpServer: {
      respond: (_id: string, payload: Record<string, unknown>) => {
        respostas.push(payload);
        return true;
      },
    },
  },
}));
vi.mock("@/helpers/AppData", () => ({ default: { get: (k: string) => appdata[k] } }));
vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll: async () => [] } }));
vi.mock("../composables/useLiveContent", () => ({ useLiveContent: () => live }));
vi.mock("../composables/usePdfDeck", () => ({
  usePdfDeck: () => ({
    active: ref(false),
    page: ref(0),
    total: ref(0),
    aspect: ref(16 / 9),
    url: ref(null),
  }),
}));
vi.mock("../composables/usePptxNative", () => ({
  usePptxNative: () => ({
    active: ref(false),
    available: ref(false),
    opening: ref(false),
    state: ref({ black: false }),
  }),
}));
vi.mock("../composables/useLiveZoom", () => ({ useLiveZoom: () => ({}) }));
vi.mock("../composables/usePowerPoint", () => ({
  isPowerPoint: () => false,
  livePowerPointPath: ref(null),
  missingFontNames: () => [],
  powerPointInfo: new Map(),
}));
vi.mock("../composables/openInPresentationMode", () => ({ presentInPresentationMode: vi.fn() }));
vi.mock("../composables/useOutputs", () => ({
  screenOn,
  setScreen: vi.fn(),
  startOutputs: () => startOutputs(),
  stopOutputs: () => stopOutputs(),
}));

const { handlePresenterHttp } = await import("../remotePresenter");
const { KEYS } = await import("@/constants/UserDataKeys");

async function estado(): Promise<Record<string, unknown>> {
  respostas.length = 0;
  await handlePresenterHttp({ requestId: "r1", action: "state" });
  return respostas[0];
}

beforeEach(() => {
  for (const k of Object.keys(appdata)) delete appdata[k];
  screenOn.value = { main: false, stage: false };
  live.current.value = null;
  live.title.value = "";
  live.music.slides.value = [];
  live.music.slideIndex.value = 0;
  live.music.slide.value = null;
  live.bible.value = null;
  live.file.value = null;
  live.announcement.value = null;
  startOutputs.mockClear();
  stopOutputs.mockClear();
});

describe("celular: o que está no ar no modo apresentação", () => {
  it("música: a letra do slide atual e o número do slide", async () => {
    live.current.value = "music";
    live.title.value = "Vinde, Povo do Senhor";
    live.music.slides.value = [{}, {}, { lyric: "Vinde, povo do Senhor\nadorai-O com louvor" }];
    live.music.slideIndex.value = 2;
    live.music.slide.value = live.music.slides.value[2];
    const s = await estado();
    expect(s.kind).toBe("music");
    expect(s.title).toBe("Vinde, Povo do Senhor");
    expect(s.live).toEqual({
      text: "Vinde, povo do Senhor\nadorai-O com louvor",
      page: 3,
      total: 3,
      image: "",
    });
  });

  it("Bíblia: o texto do versículo, sem as marcas de formatação", async () => {
    live.current.value = "bible";
    live.title.value = "João 3:16";
    live.bible.value = { text: "Porque Deus <b>amou</b> o mundo" };
    const s = await estado();
    expect((s.live as { text: string }).text).toBe("Porque Deus amou o mundo");
  });

  it("imagem: avisa que há imagem para o celular pedir; vídeo não", async () => {
    live.current.value = "file";
    live.file.value = { type: "image", url: "louvorja://local/fotos/culto.jpg", title: "culto" };
    expect((await estado()).live).toMatchObject({ image: expect.stringMatching(/^[0-9a-z]+$/) });

    live.file.value = { type: "video", url: "louvorja://local/videos/abertura.mp4", title: "abertura" };
    expect((await estado()).live).toMatchObject({ image: "" });
  });

  it("anúncio: o texto do anúncio", async () => {
    live.current.value = "announcements";
    live.announcement.value = { nome: "Aviso", texto: "Reunião às 19h" };
    expect((await estado()).live).toMatchObject({ text: "Reunião às 19h" });
  });

  it("letra muito grande é cortada para caber na resposta", async () => {
    live.current.value = "bible";
    live.bible.value = { text: "a".repeat(5_000) };
    expect(((await estado()).live as { text: string }).text.length).toBe(1_500);
  });
});

describe("celular: Iniciar e Parar do modo apresentação", () => {
  it("valem o que os botões do módulo valem", async () => {
    appdata[KEYS.MODULES.PRESENTATION_MODE.CAN_START] = false;
    appdata[KEYS.MODULES.PRESENTATION_MODE.CAN_STOP] = true;
    expect(await estado()).toMatchObject({ canStart: false, canStop: true });
  });

  it("com o módulo nunca aberto, o que está ligado decide", async () => {
    expect(await estado()).toMatchObject({ canStart: true, canStop: false });
    screenOn.value = { main: true, stage: false };
    expect(await estado()).toMatchObject({ canStart: false, canStop: true });
  });

  it("Iniciar e Parar chamam as mesmas funções dos botões do módulo", async () => {
    respostas.length = 0;
    await handlePresenterHttp({ requestId: "a", action: "start" });
    await handlePresenterHttp({ requestId: "b", action: "stop" });
    expect(startOutputs).toHaveBeenCalledOnce();
    expect(stopOutputs).toHaveBeenCalledOnce();
    expect(respostas).toEqual([{ status: "ok" }, { status: "ok" }]);
  });

  it("imagem no ar sem imagem de verdade responde erro, sem tentar desenhar", async () => {
    live.current.value = "music";
    respostas.length = 0;
    await handlePresenterHttp({ requestId: "c", action: "live-image", width: 640 });
    expect(respostas).toEqual([{ status: "error" }]);
  });
});
