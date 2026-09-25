import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTION_TYPE, PROJECTION_URL } from "@/constants/Projection";
import { KEYS } from "@/constants/UserDataKeys";

type OpenArgs = {
  route: string;
  feature: string;
  monitorId: number | null;
  fullscreen: boolean;
  alwaysOnTop: boolean;
};

const calls: string[] = [];
const openWindow = vi.fn(async (opts: OpenArgs) => {
  calls.push(`open:${opts.feature}`);
});
const closeWindow = vi.fn(async (feature: string) => {
  calls.push(`close:${feature}`);
});
const isWindowOpen = vi.fn(async (_feature: string) => false);

vi.mock("@/helpers/Projection", () => ({
  open: (opts: OpenArgs) => openWindow(opts),
  close: (feature: string) => closeWindow(feature),
  isOpen: (feature: string) => isWindowOpen(feature),
}));

/** Monitor de cada feature; ausente = a feature não tem onde abrir. */
let monitors: Record<string, number> = {};
vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    displays: {
      getPreferred: async (feature: string) => (feature in monitors ? { id: monitors[feature] } : null),
    },
  },
}));

let prefs: Record<string, unknown> = {};
vi.mock("@/helpers/UserData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in prefs ? prefs[key] : fallback) },
}));

let onAir: Record<string, unknown> = {};
vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in onAir ? onAir[key] : fallback) },
}));

const windows = await import("@/helpers/ProjectionWindows");
const { MUSIC, RETURN, FILE, FILE_RETURN, ONLINE_VIDEO, ONLINE_VIDEO_RETURN, OPERATOR, BACKGROUND } = PROJECTION_TYPE;

const opened = () => openWindow.mock.calls.map(([o]) => ({ route: o.route, feature: o.feature }));
const lastOpen = () => openWindow.mock.calls.at(-1)?.[0] as OpenArgs;
const musicReturnOnScreen = () =>
  isWindowOpen.mockImplementation(async (feature: string) => feature === RETURN);

beforeEach(() => {
  calls.length = 0;
  openWindow.mockClear();
  closeWindow.mockClear();
  isWindowOpen.mockReset();
  isWindowOpen.mockResolvedValue(false);
  monitors = {
    [MUSIC]: 1,
    [RETURN]: 2,
    [FILE]: 1,
    [FILE_RETURN]: 2,
    [ONLINE_VIDEO]: 1,
    [ONLINE_VIDEO_RETURN]: 2,
    [OPERATOR]: 3,
  };
  prefs = {};
});

afterEach(() => vi.useRealTimers());

describe("openMediaWindow — a tabela de janelas por mídia", () => {
  it.each([
    ["music", "projection", PROJECTION_URL.MUSIC, MUSIC],
    ["music", "return", PROJECTION_URL.RETURN, RETURN],
    ["file", "projection", PROJECTION_URL.FILE, FILE],
    ["file", "return", PROJECTION_URL.FILE_RETURN, FILE_RETURN],
    ["video", "projection", PROJECTION_URL.FILE, FILE],
    ["video", "return", PROJECTION_URL.FILE_RETURN, ONLINE_VIDEO_RETURN],
    ["music", "operator", PROJECTION_URL.OPERATOR, OPERATOR],
    ["file", "operator", PROJECTION_URL.OPERATOR, OPERATOR],
    ["video", "operator", PROJECTION_URL.OPERATOR, OPERATOR],
  ] as const)("%s / %s abre %s com a chave %s", async (media, kind, route, feature) => {
    await windows.openMediaWindow(kind, media);
    expect(opened()).toEqual([{ route, feature }]);
  });

  it("vídeo e arquivo nunca abrem as rotas de música, que ficariam em PRÓX 1/0 e em branco", async () => {
    for (const media of ["file", "video"] as const) {
      for (const kind of ["projection", "return"] as const) await windows.openMediaWindow(kind, media);
    }
    const routes = opened().map((o) => o.route);
    expect(routes).not.toContain(PROJECTION_URL.MUSIC);
    expect(routes).not.toContain(PROJECTION_URL.RETURN);
  });

  it("sem monitor próprio, arquivo e vídeo usam o da música (projeção) e o do retorno de música (retorno)", async () => {
    monitors = { [MUSIC]: 7, [RETURN]: 8 };
    for (const media of ["file", "video"] as const) {
      await windows.openMediaWindow("projection", media);
      expect(lastOpen().monitorId).toBe(7);
      await windows.openMediaWindow("return", media);
      expect(lastOpen().monitorId).toBe(8);
    }
  });

  it("segue a tela cheia e o 'sempre no topo' de cada mídia; o operador nunca", async () => {
    prefs = {
      [KEYS.OPTIONS.FULLSCREEN]: true,
      [KEYS.OPTIONS.ALWAYS_ON_TOP]: false,
      [KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN]: false,
      [KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP]: true,
      [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.FULLSCREEN]: false,
      [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.ALWAYS_ON_TOP]: false,
    };
    const expected = { music: [true, false], file: [false, true], video: [false, false] } as const;
    for (const media of ["music", "file", "video"] as const) {
      await windows.openMediaWindow("projection", media);
      expect([lastOpen().fullscreen, lastOpen().alwaysOnTop]).toEqual(expected[media]);
    }
    await windows.openMediaWindow("operator", "video");
    expect([lastOpen().fullscreen, lastOpen().alwaysOnTop]).toEqual([false, false]);
  });

  it("automático sem monitor para o papel não abre nada, mas o operador abre", async () => {
    monitors = {};
    await windows.openMediaWindow("projection", "video");
    await windows.openMediaWindow("return", "file");
    expect(openWindow).not.toHaveBeenCalled();
    await windows.openMediaWindow("operator", "music");
    expect(opened()).toEqual([{ route: PROJECTION_URL.OPERATOR, feature: OPERATOR }]);
  });

  it("pedido pelo operador abre mesmo sem monitor, para o main explicar a recusa em vez de o clique parecer morto", async () => {
    monitors = {};
    await windows.openMediaWindow("return", "music", { explicit: true });
    expect(openWindow).toHaveBeenCalledOnce();
    expect(lastOpen().monitorId).toBeNull();
  });

  it("o monitor escolhido à mão no menu do botão vale mais que o do papel, inclusive no navegador, onde o papel não dá id", async () => {
    await windows.openMediaWindow("projection", "video", { explicit: true, monitorId: 9 });
    expect(lastOpen().monitorId).toBe(9);

    monitors = {};
    await windows.openMediaWindow("projection", "video", { explicit: true, monitorId: "screen-2" });
    expect(lastOpen().monitorId).toBe("screen-2");
  });

  it("sem monitor escolhido à mão (nulo ou ausente), vale o do papel", async () => {
    await windows.openMediaWindow("projection", "video", { explicit: true, monitorId: null });
    expect(lastOpen().monitorId).toBe(1);
    await windows.openMediaWindow("projection", "video", { explicit: true });
    expect(lastOpen().monitorId).toBe(1);
  });
});

describe("currentMediaKind — que mídia está no ar", () => {
  const CONFIG = KEYS.MODULES.MEDIA.CONFIG;

  beforeEach(() => {
    onAir = {};
  });

  it.each([
    ["nada tocando", {}, "music"],
    ["música com slides", { [CONFIG.AUDIO]: "louvorja://files/musics/a.opus" }, "music"],
    ["player embutido do YouTube", { [CONFIG.IS_YOUTUBE]: true }, "video"],
    ["vídeo on-line baixado", { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://onlinevideo/x.mp4" }, "video"],
    [
      "vídeo on-line tocando enquanto baixa",
      { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://onlinestream/x/audio" },
      "video",
    ],
    ["vídeo de arquivo da liturgia", { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://local/videos/culto.mp4" }, "file"],
  ])("%s → %s", (_nome, state, kind) => {
    onAir = state;
    expect(windows.currentMediaKind()).toBe(kind);
  });
});

describe("mediaWindowPlan — a tabela é pública e é a mesma que abre as janelas", () => {
  it.each([
    ["music", MUSIC, PROJECTION_URL.MUSIC],
    ["file", FILE, PROJECTION_URL.FILE],
    ["video", FILE, PROJECTION_URL.FILE],
  ] as const)("%s: a janela do plano é a que openMediaWindow abre", async (media, feature, route) => {
    expect(windows.mediaWindowPlan("projection", media)).toMatchObject({ feature, route });
    await windows.openMediaWindow("projection", media);
    expect(opened()).toEqual([{ route, feature }]);
  });

  it("no vídeo, a janela é a do arquivo mas o monitor tem opção própria, antes da da música", () => {
    expect(windows.mediaWindowPlan("projection", "video").monitors).toEqual([ONLINE_VIDEO, MUSIC]);
  });
});

describe("openMediaWindow — o retorno de música sai do caminho do arquivo e do vídeo", () => {
  it.each(["file", "video"] as const)("%s: o retorno de música sai antes de o retorno da mídia entrar", async (media) => {
    await windows.openMediaWindow("return", media);
    expect(calls).toEqual([`close:${RETURN}`, `open:${media === "file" ? FILE_RETURN : ONLINE_VIDEO_RETURN}`]);
  });

  it.each(["file", "video"] as const)("%s: sem onde pôr o retorno, o de música em PRÓX 1/0 sai mesmo assim", async (media) => {
    monitors = {};
    musicReturnOnScreen();
    await windows.openMediaWindow("return", media);
    expect(calls).toEqual([`close:${RETURN}`]);
  });

  it.each(["file", "video"] as const)("%s: sem onde pôr o retorno e sem retorno de música, nada acontece", async (media) => {
    monitors = {};
    await windows.openMediaWindow("return", media);
    expect(closeWindow).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("o retorno de música em si nunca fecha o retorno de música", async () => {
    await windows.openMediaWindow("return", "music");
    expect(closeWindow).not.toHaveBeenCalled();
  });
});

describe("a abertura automática e o menu do player abrem exatamente a mesma janela", () => {
  it.each(["music", "file", "video"] as const)("%s: automático e sob demanda pedem os mesmos argumentos à plataforma", async (media) => {
    prefs = {
      [KEYS.OPTIONS.OPEN_RETURN]: true,
      [KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN]: true,
      [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN]: true,
      [KEYS.OPTIONS.OPEN_OPERATOR]: true,
    };
    const automatic = { music: windows.openProjectionWindows, file: windows.openFileProjectionWindows, video: () => windows.openVideoProjectionWindows({ withOperator: true }) }[media];
    await automatic();
    const auto = openWindow.mock.calls.map(([o]) => o);

    openWindow.mockClear();
    for (const kind of ["projection", "return", "operator"] as const) {
      await windows.openMediaWindow(kind, media, { explicit: true });
    }
    const manual = openWindow.mock.calls.map(([o]) => o);

    expect(manual).toEqual(auto);
  });
});

describe("as aberturas automáticas", () => {
  it("música: projeção; retorno e operador só com as opções ligadas", async () => {
    await windows.openProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([MUSIC]);
    prefs = { [KEYS.OPTIONS.OPEN_RETURN]: true, [KEYS.OPTIONS.OPEN_OPERATOR]: true };
    openWindow.mockClear();
    await windows.openProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([MUSIC, RETURN, OPERATOR]);
  });

  it("arquivo: retorno pela opção de arquivo, pela opção geral ou por um retorno de música já na tela", async () => {
    await windows.openFileProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([FILE]);

    for (const key of [KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, KEYS.OPTIONS.OPEN_RETURN]) {
      prefs = { [key]: true };
      openWindow.mockClear();
      await windows.openFileProjectionWindows();
      expect(opened().map((o) => o.feature)).toEqual([FILE, FILE_RETURN]);
    }

    prefs = {};
    musicReturnOnScreen();
    openWindow.mockClear();
    calls.length = 0;
    await windows.openFileProjectionWindows();
    expect(calls).toEqual([`open:${FILE}`, `close:${RETURN}`, `open:${FILE_RETURN}`]);
  });

  it("vídeo on-line: só a projeção; retorno pela opção ou por um retorno de música já na tela (PRÓX 1/0)", async () => {
    await windows.openVideoProjectionWindows();
    expect(opened()).toEqual([{ route: PROJECTION_URL.FILE, feature: FILE }]);

    prefs = { [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN]: true };
    openWindow.mockClear();
    await windows.openVideoProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([FILE, ONLINE_VIDEO_RETURN]);

    prefs = {};
    musicReturnOnScreen();
    openWindow.mockClear();
    calls.length = 0;
    await windows.openVideoProjectionWindows();
    expect(calls).toEqual([`open:${FILE}`, `close:${RETURN}`, `open:${ONLINE_VIDEO_RETURN}`]);
  });

  it("vídeo on-line: o operador só entra quando pedido e habilitado", async () => {
    prefs = { [KEYS.OPTIONS.OPEN_OPERATOR]: true };
    await windows.openVideoProjectionWindows();
    expect(opened().map((o) => o.feature)).not.toContain(OPERATOR);
    await windows.openVideoProjectionWindows({ withOperator: true });
    expect(opened().map((o) => o.feature)).toContain(OPERATOR);
  });

  it("vídeo on-line embutido: fecha o operador que ficou aberto de uma mídia anterior, senão ele trava mostrando o conteúdo velho", async () => {
    isWindowOpen.mockImplementation(async (feature: string) => feature === OPERATOR);
    calls.length = 0;
    await windows.openVideoProjectionWindows();
    expect(calls).toContain(`close:${OPERATOR}`);
  });

  it.each([
    ["música", () => windows.openProjectionWindows()],
    ["arquivo", () => windows.openFileProjectionWindows()],
    ["vídeo on-line", () => windows.openVideoProjectionWindows()],
  ])("%s: com a projeção de fundo aberta, não abre janela nenhuma", async (_nome, automatic) => {
    isWindowOpen.mockImplementation(async (feature: string) => feature === BACKGROUND);
    await automatic();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

it("libera apenas janelas de arquivo e vídeo antes de os slides assumirem o palco", async () => {
  await windows.closeFileProjectionWindows();
  expect(closeWindow.mock.calls.map(([feature]) => feature)).toEqual([
    FILE, FILE_RETURN, ONLINE_VIDEO, ONLINE_VIDEO_RETURN,
  ]);
  expect(closeWindow).not.toHaveBeenCalledWith(MUSIC);
  expect(closeWindow).not.toHaveBeenCalledWith(OPERATOR);
});

it("ao entrar vídeo, fecha somente as janelas de música e retorno", async () => {
  await windows.closeMusicProjectionWindows();
  expect(closeWindow.mock.calls.map(([feature]) => feature)).toEqual([MUSIC, RETURN]);
  expect(closeWindow).not.toHaveBeenCalledWith(FILE);
  expect(closeWindow).not.toHaveBeenCalledWith(OPERATOR);
});

it.each([
  ["música", () => windows.closeMusicProjectionWindows(), "music", MUSIC],
  ["arquivo", () => windows.closeFileProjectionWindows(), "file", FILE],
] as const)("%s só reabre a feature depois que o close nativo foi confirmado", async (_name, closeStage, media, feature) => {
  const closing = (() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  })();
  closeWindow.mockImplementationOnce(() => closing.promise);

  const close = closeStage();
  await vi.waitFor(() => expect(closeWindow).toHaveBeenCalled());
  const open = windows.openMediaWindow("projection", media);
  await Promise.resolve();
  expect(openWindow).not.toHaveBeenCalled();

  closing.resolve();
  await Promise.all([close, open]);
  expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ feature }));
});

it("vídeo espera uma janela MUSIC já abrindo antes de fechá-la", async () => {
  let finishOpen!: () => void;
  openWindow.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOpen = resolve; }));
  const music = windows.openProjectionWindows();
  await vi.waitFor(() => expect(openWindow).toHaveBeenCalledOnce());
  const closeMusic = windows.closeMusicProjectionWindows();
  expect(closeWindow).not.toHaveBeenCalled();
  finishOpen();
  await Promise.all([music, closeMusic]);
  expect(closeWindow.mock.calls.map(([feature]) => feature)).toEqual([MUSIC, RETURN]);
});

it("MUSIC que termina de abrir após o limite é fechada sem bloquear o novo vídeo", async () => {
  let finishOpen!: () => void;
  openWindow.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOpen = resolve; }));
  const music = windows.openProjectionWindows();
  await vi.waitFor(() => expect(openWindow).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  const closeMusic = windows.closeMusicProjectionWindows();
  await vi.advanceTimersByTimeAsync(2500);
  await closeMusic;
  expect(closeWindow).toHaveBeenCalledTimes(2);

  finishOpen();
  await music;
  await vi.waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(4));
});
