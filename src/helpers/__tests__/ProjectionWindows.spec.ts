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
/** `isDesktop` e `sendKey` são mutáveis: um caso simula web, outro a entrega. */
const platformState = vi.hoisted(() => ({
  isDesktop: true,
  sendKey: vi.fn(
    async (_feature: string, _key?: string): Promise<{ ok: boolean; reason?: string }> => ({
      ok: true,
    })
  ),
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return platformState.isDesktop;
    },
    get windows() {
      return { sendKey: platformState.sendKey };
    },
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
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn() },
}));
/* Hoisted para o factory poder usá-lo: o Broadcast é quem leva o sinal de
   "projeção de Site abriu" para o Som de Fundo pausar. */
const broadcast = vi.hoisted(() => vi.fn());
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: (...args: unknown[]) => broadcast(...args) },
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in onAir ? onAir[key] : fallback) },
}));

import Telemetry from "@/helpers/Telemetry";
const windows = await import("@/helpers/ProjectionWindows");
const { MUSIC, RETURN, FILE, FILE_RETURN, ONLINE_VIDEO, ONLINE_VIDEO_RETURN, OPERATOR, BACKGROUND } = PROJECTION_TYPE;

const opened = () => openWindow.mock.calls.map(([o]) => ({ route: o.route, feature: o.feature }));
const lastOpen = () => openWindow.mock.calls.at(-1)?.[0] as OpenArgs;
const musicReturnOnScreen = () =>
  isWindowOpen.mockImplementation(async (feature: string) => feature === RETURN);

beforeEach(async () => {
  /*
   * A bandeira é estado do módulo e a spec importa o módulo uma vez só: sem
   * este reset um caso herda a projeção aberta do anterior.
   */
  await windows.closeSiteWindow();
  calls.length = 0;
  platformState.isDesktop = true;
  platformState.sendKey.mockReset();
  platformState.sendKey.mockResolvedValue({ ok: true });
  openWindow.mockClear();
  closeWindow.mockClear();
  vi.mocked(Telemetry.track).mockClear();
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
    const automatic = { music: windows.openProjectionWindows, file: windows.openFileProjectionWindows, video: windows.openVideoProjectionWindows }[media];
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

  it("música: um retorno de arquivo/vídeo que ficou na tela é FECHADO quando a opção está desligada", async () => {
    musicReturnOnScreen();
    calls.length = 0;
    await windows.openProjectionWindows();

    expect(calls).toEqual([`open:${MUSIC}`, `close:${RETURN}`]);
    expect(opened().map((o) => o.feature)).toEqual([MUSIC]);
  });

  it("arquivo: retorno só pela opção de arquivo; a opção geral de música não puxa retorno", async () => {
    await windows.openFileProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([FILE]);

    prefs = { [KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN]: true };
    openWindow.mockClear();
    await windows.openFileProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([FILE, FILE_RETURN]);

    /*
     * `options.open_return` é da música (Slides de Músicas): ligá-la não pode
     * puxar retorno para uma projeção de arquivo sem opção própria.
     */
    prefs = { [KEYS.OPTIONS.OPEN_RETURN]: true };
    openWindow.mockClear();
    calls.length = 0;
    await windows.openFileProjectionWindows();
    expect(calls).toEqual([`open:${FILE}`]);
  });

  it("arquivo: um retorno de música que ficou na tela é FECHADO, não reutilizado", async () => {
    musicReturnOnScreen();
    calls.length = 0;
    await windows.openFileProjectionWindows();

    expect(calls).toEqual([`open:${FILE}`, `close:${RETURN}`]);
    expect(opened().map((o) => o.feature)).not.toContain(FILE_RETURN);
  });

  it("vídeo on-line: só a projeção; retorno pela opção própria, nunca pela geral de música", async () => {
    await windows.openVideoProjectionWindows();
    expect(opened()).toEqual([{ route: PROJECTION_URL.FILE, feature: FILE }]);

    prefs = { [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN]: true };
    openWindow.mockClear();
    await windows.openVideoProjectionWindows();
    expect(opened().map((o) => o.feature)).toEqual([FILE, ONLINE_VIDEO_RETURN]);

    prefs = { [KEYS.OPTIONS.OPEN_RETURN]: true };
    openWindow.mockClear();
    calls.length = 0;
    await windows.openVideoProjectionWindows();
    expect(calls).toEqual([`open:${FILE}`]);
  });

  it("vídeo on-line: um retorno de música que ficou na tela é FECHADO, não reutilizado", async () => {
    musicReturnOnScreen();
    calls.length = 0;
    await windows.openVideoProjectionWindows();

    expect(calls).toEqual([`open:${FILE}`, `close:${RETURN}`]);
    expect(opened().map((o) => o.feature)).not.toContain(ONLINE_VIDEO_RETURN);
  });

  it("vídeo on-line: o operador entra com a opção ligada, embutido ou baixado — ele mostra a prévia dos dois", async () => {
    await windows.openVideoProjectionWindows();
    expect(opened().map((o) => o.feature)).not.toContain(OPERATOR);
    prefs = { [KEYS.OPTIONS.OPEN_OPERATOR]: true };
    await windows.openVideoProjectionWindows();
    expect(opened().map((o) => o.feature)).toContain(OPERATOR);
  });

  it("vídeo on-line: não fecha o operador que já estava aberto", async () => {
    isWindowOpen.mockImplementation(async (feature: string) => feature === OPERATOR);
    calls.length = 0;
    await windows.openVideoProjectionWindows();
    expect(calls).not.toContain(`close:${OPERATOR}`);
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

/** Evento de tecla mínimo — o que `takeSiteKey` lê. */
const tecla = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe("projeção de URL (Site) — teclas e exclusão mútua", () => {
  const URL_DO_SITE = "https://exemplo.com/enquete";
  /** Abre a URL e reestabelece o cenário em que a bandeira está ligada. */
  async function abrirSite(): Promise<void> {
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);
    expect(await windows.openSiteWindow(URL_DO_SITE, "liturgy")).toBe(true);
    expect(windows.isSiteProjectionActive()).toBe(true);
    isWindowOpen.mockReset();
    isWindowOpen.mockResolvedValue(false);
  }

  it("abrir marca a bandeira; fechar limpa — é ela que decide sem IPC", async () => {
    await abrirSite();
    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE}`);

    await windows.closeSiteWindow();

    expect(windows.isSiteProjectionActive()).toBe(false);
    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE}`);
    // `null` aqui é o que preserva o comportamento de mídia/bíblia.
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBeNull();
  });

  it("só com a projeção no ar a tecla é considerada", async () => {
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBeNull();
    await abrirSite();
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBe("ArrowRight");
    expect(windows.takeSiteKey(tecla("PageDown"))).toBe("PageDown");
    expect(windows.takeSiteKey(tecla("Home"))).toBe("Home");
  });

  it("combinação é atalho do app e tecla desconhecida não é nossa", async () => {
    await abrirSite();
    // Continuam sendo "música anterior/próxima" do app.
    expect(windows.takeSiteKey(tecla("ArrowLeft", { ctrlKey: true }))).toBeNull();
    expect(windows.takeSiteKey(tecla("ArrowUp", { metaKey: true }))).toBeNull();
    expect(windows.takeSiteKey(tecla("ArrowDown", { altKey: true }))).toBeNull();
    // Uma tecla qualquer não pode virar evento numa página alheia.
    expect(windows.takeSiteKey(tecla("Escape"))).toBeNull();
    expect(windows.takeSiteKey(tecla("a"))).toBeNull();
  });

  it("sem porta de envio (web/PWA) não se consome a tecla", async () => {
    await abrirSite();
    platformState.isDesktop = false;
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBeNull();
    platformState.isDesktop = true;
  });

  it("entrega a tecla para a janela de URL", async () => {
    await abrirSite();
    expect(await windows.forwardSiteKey("ArrowRight")).toBe(true);
    expect(platformState.sendKey).toHaveBeenCalledWith(PROJECTION_TYPE.SITE, "ArrowRight");
  });

  it("entrega que falhou com a janela morta repergunta e corrige a bandeira", async () => {
    /*
     * Sem isto a bandeira ficaria presa: macOS fecha a janela em fullscreen com
     * ESC sem avisar ninguém, e as setas passariam a ser engolidas por uma
     * janela que já não existe.
     */
    await abrirSite();
    platformState.sendKey.mockResolvedValueOnce({ ok: false, reason: "window" });
    isWindowOpen.mockResolvedValue(false);

    expect(await windows.forwardSiteKey("ArrowRight")).toBe(false);
    expect(windows.isSiteProjectionActive()).toBe(false);
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBeNull();
  });

  it("erro transitório não apaga a bandeira enquanto a janela existe", async () => {
    await abrirSite();
    platformState.sendKey.mockResolvedValueOnce({ ok: false, reason: "transitorio" });
    isWindowOpen.mockResolvedValue(true);

    expect(await windows.forwardSiteKey("ArrowRight")).toBe(false);
    expect(windows.isSiteProjectionActive()).toBe(true);
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBe("ArrowRight");
  });

  it("abrir mídia tira a URL da tela antes de entrar", async () => {
    await abrirSite();
    isWindowOpen.mockResolvedValue(false);

    await windows.openFileProjectionWindows();

    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE}`);
    expect(calls).toContain(`open:${PROJECTION_TYPE.FILE}`);
    expect(windows.isSiteProjectionActive()).toBe(false);
  });
});

describe("tela de retorno da projeção de URL", () => {
  const URL_DO_SITE = "https://exemplo.com/enquete";
  const ligarOpcao = () => {
    prefs[KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN] = true;
  };
  /** Abre já com a opção ligada e a janela de projeção no ar. */
  async function abrirComRetorno(): Promise<void> {
    ligarOpcao();
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");
    isWindowOpen.mockReset();
    isWindowOpen.mockResolvedValue(false);
  }

  it("com a opção ligada, abre a URL no telão E na tela de retorno", async () => {
    await abrirComRetorno();

    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE}`);
    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE_RETURN}`);
    // As duas carregam a mesma URL: o retorno é um espelho, como o do arquivo.
    const aberturas = opened();
    expect(aberturas.filter((o) => o.route === URL_DO_SITE)).toHaveLength(2);
  });

  it("com a opção desligada, só a projeção", async () => {
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");
    isWindowOpen.mockReset();
    isWindowOpen.mockResolvedValue(false);

    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE}`);
    expect(calls).not.toContain(`open:${PROJECTION_TYPE.SITE_RETURN}`);
  });

  it("com a opção desligada, um espelho de uma abertura anterior é FECHADO, não deixado órfão", async () => {
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_RETURN
    );
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE}`);
    expect(calls).not.toContain(`open:${PROJECTION_TYPE.SITE_RETURN}`);
    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_RETURN}`);
  });

  it("a tela de retorno usa o monitor da própria, senão o da retorno de música", async () => {
    ligarOpcao();
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    // `opened()` só devolve rota e feature; o monitor vem da chamada bruta.
    const retorno = openWindow.mock.calls
      .map(([opts]) => opts)
      .find((o) => o.feature === PROJECTION_TYPE.SITE_RETURN);
    // O papel do próprio site não está configurado nesta fixture; cai no da
    // tela de retorno de música (monitor 2) — mesma cadeia das outras telas.
    expect(retorno?.monitorId).toBe(2);
  });

  it("sem monitor nenhum de retorno, a projeção segue e o retorno fica de fora", async () => {
    ligarOpcao();
    delete monitors[PROJECTION_TYPE.RETURN];
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(calls).toContain(`open:${PROJECTION_TYPE.SITE}`);
    expect(calls).not.toContain(`open:${PROJECTION_TYPE.SITE_RETURN}`);
  });

  it("encerrar fecha as duas, senão a URL fica presa no palco", async () => {
    await abrirComRetorno();

    await windows.closeSiteWindow();

    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE}`);
    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_RETURN}`);
    expect(windows.isSiteProjectionActive()).toBe(false);
  });

  it("a mesma tecla vai também para o espelho da tela de retorno", async () => {
    // As duas janelas carregam a MESMA URL em instâncias independentes: sem
    // receber a tecla o espelho ficaria parado no slide inicial.
    await abrirComRetorno();

    expect(await windows.forwardSiteKey("ArrowRight")).toBe(true);

    expect(platformState.sendKey).toHaveBeenCalledWith(PROJECTION_TYPE.SITE, "ArrowRight");
    expect(platformState.sendKey).toHaveBeenCalledWith(PROJECTION_TYPE.SITE_RETURN, "ArrowRight");
  });

  it("espelho inexistente não derruba a entrega nem a bandeira", async () => {
    // Com a opção de retorno desligada a janela não existe e o main responde
    // `window` para ela. Isso não pode apagar a bandeira nem parar as teclas.
    await abrirComRetorno();
    platformState.sendKey.mockImplementation(async (feature: string) =>
      feature === PROJECTION_TYPE.SITE ? { ok: true } : { ok: false, reason: "window" }
    );

    expect(await windows.forwardSiteKey("ArrowRight")).toBe(true);
    expect(windows.isSiteProjectionActive()).toBe(true);
    expect(windows.takeSiteKey(tecla("ArrowRight"))).toBe("ArrowRight");
  });

  it("mídia assumindo a tela fecha as duas também", async () => {
    await abrirComRetorno();
    isWindowOpen.mockResolvedValue(false);

    await windows.openFileProjectionWindows();

    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_RETURN}`);
    expect(windows.isSiteProjectionActive()).toBe(false);
  });
});

describe("tela de loading da projeção de Site", () => {
  const URL_DO_SITE = "https://exemplo.com/enquete";
  const aguardar = vi.fn(async () => ({ ok: true }));
  type Janela = { louvorjaApi?: { siteLoader?: unknown } };
  let apiAnterior: unknown;

  const comLoader = () =>
    ((window as unknown as Janela).louvorjaApi = {
      siteLoader: { onPronto: () => () => {}, aguardar },
    });
  const semLoader = () => ((window as unknown as Janela).louvorjaApi = undefined);
  const aberturas = () => calls.filter((c) => c.startsWith("open:"));

  beforeEach(() => {
    apiAnterior = (window as unknown as Janela).louvorjaApi;
    comLoader();
    aguardar.mockClear();
    aguardar.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    (window as unknown as Janela).louvorjaApi = apiAnterior as never;
  });

  it("o loader abre ANTES da janela de Site, no mesmo monitor", async () => {
    monitors[PROJECTION_TYPE.SITE] = 7;
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );

    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    const ordem = aberturas();
    expect(ordem.indexOf(`open:${PROJECTION_TYPE.SITE_LOADER}`)).toBeLessThan(
      ordem.indexOf(`open:${PROJECTION_TYPE.SITE}`)
    );
    expect(ordem[0]).toBe(`open:${PROJECTION_TYPE.SITE_LOADER}`);
    expect(lastOpen().monitorId).toBe(7);
  });

  it("só depois de abrir TUDO ele avisa o main (uma vez)", async () => {
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );

    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(aguardar).toHaveBeenCalledTimes(1);
  });

  it("com a opção de retorno, os quatro abrem em ordem e é UM aviso só", async () => {
    prefs[KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN] = true;
    monitors[PROJECTION_TYPE.SITE] = 1;
    monitors[PROJECTION_TYPE.SITE_RETURN] = 2;
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        [
          PROJECTION_TYPE.SITE,
          PROJECTION_TYPE.SITE_RETURN,
          PROJECTION_TYPE.SITE_LOADER,
          PROJECTION_TYPE.SITE_LOADER_RETURN,
        ].includes(feature)
    );

    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(aberturas()).toEqual([
      `open:${PROJECTION_TYPE.SITE_LOADER}`,
      `open:${PROJECTION_TYPE.SITE}`,
      `open:${PROJECTION_TYPE.SITE_LOADER_RETURN}`,
      `open:${PROJECTION_TYPE.SITE_RETURN}`,
    ]);
    expect(aguardar).toHaveBeenCalledTimes(1);
  });

  it("site não abriu → loader fecha na hora e o main nunca é avisado", async () => {
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE_LOADER);

    expect(await windows.openSiteWindow(URL_DO_SITE, "liturgy")).toBe(false);

    expect(aguardar).not.toHaveBeenCalled();
    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_LOADER}`);
    expect(windows.isSiteProjectionActive()).toBe(false);
  });

  it("sem porta de desktop não nasce loader nenhum", async () => {
    semLoader();
    isWindowOpen.mockImplementation(async (feature: string) => feature === PROJECTION_TYPE.SITE);

    expect(await windows.openSiteWindow(URL_DO_SITE, "liturgy")).toBe(true);

    expect(aberturas().some((c) => c.includes("site_loader"))).toBe(false);
    expect(aguardar).not.toHaveBeenCalled();
  });

  it("encerrar a projeção fecha os loaders junto", async () => {
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );
    await windows.openSiteWindow(URL_DO_SITE, "liturgy");
    isWindowOpen.mockResolvedValue(false);
    calls.length = 0;

    await windows.closeSiteWindow();

    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_LOADER}`);
    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_LOADER_RETURN}`);
  });

  it("se o aviso ao main falhar, os loaders são fechados — a tela não pode prender", async () => {
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );
    aguardar.mockRejectedValueOnce(new Error("ipc fora"));

    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(calls).toContain(`close:${PROJECTION_TYPE.SITE_LOADER}`);
  });
});

describe("telemetria da projeção de Site", () => {
  const URL_DO_SITE = "https://exemplo.com/culto";
  const eventos = () =>
    vi
      .mocked(Telemetry.track)
      .mock.calls.filter(([evento]) => evento === "site_projected");
  const props = () => eventos()[0][1] as Record<string, unknown>;

  beforeEach(() => {
    (window as unknown as { louvorjaApi?: unknown }).louvorjaApi = {
      siteLoader: { onPronto: () => () => {}, aguardar: async () => ({ ok: true }) },
    };
  });

  afterEach(() => {
    delete (window as unknown as { louvorjaApi?: unknown }).louvorjaApi;
  });

  it("sucesso registra origem, resultado e o que abriu", async () => {
    prefs[KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN] = false;
    monitors[PROJECTION_TYPE.SITE] = 1;
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );

    expect(await windows.openSiteWindow(URL_DO_SITE, "liturgy")).toBe(true);

    expect(eventos()).toHaveLength(1);
    expect(props()).toMatchObject({
      source: "liturgy",
      ok: true,
      has_loader: true,
      has_return: false,
    });
    expect(typeof props().duration_ms).toBe("number");
  });

  it("com a opção de retorno ligada, o espelho entra no evento", async () => {
    prefs[KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN] = true;
    monitors[PROJECTION_TYPE.SITE] = 1;
    monitors[PROJECTION_TYPE.SITE_RETURN] = 2;
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        [
          PROJECTION_TYPE.SITE,
          PROJECTION_TYPE.SITE_RETURN,
          PROJECTION_TYPE.SITE_LOADER,
          PROJECTION_TYPE.SITE_LOADER_RETURN,
        ].includes(feature)
    );

    await windows.openSiteWindow(URL_DO_SITE, "liturgy");

    expect(props()).toMatchObject({ ok: true, has_return: true });
  });

  it("janela que não abriu registra ok:false com a origem", async () => {
    isWindowOpen.mockResolvedValue(false);

    expect(await windows.openSiteWindow(URL_DO_SITE, "canva")).toBe(false);

    expect(props()).toMatchObject({ source: "canva", ok: false, has_loader: false });
  });

  it("url vazia não é projeção de Site nenhuma", async () => {
    await windows.openSiteWindow("", "liturgy");

    expect(eventos()).toHaveLength(0);
  });

  it("nunca manda URL, design nem título — só origem, resultado e duração", async () => {
    isWindowOpen.mockResolvedValue(false);

    await windows.openSiteWindow(
      "https://www.canva.com/api/design/JWT-SEGREDO/view",
      "canva"
    );

    expect(Object.keys(props()).sort()).toEqual([
      "duration_ms",
      "has_loader",
      "has_return",
      "ok",
      "source",
    ]);
    expect(JSON.stringify(props())).not.toContain("JWT-SEGREDO");
    expect(JSON.stringify(props())).not.toContain("canva.com");
  });
});

describe("sinal de projeção de Site para o Som de Fundo", () => {
  const sites = () =>
    broadcast.mock.calls.filter(([tipo]) => tipo === "site_projection");

  beforeEach(() => broadcast.mockClear());

  it("abriu → avisa com a ORIGEM (e nunca com a URL)", async () => {
    prefs[KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN] = false;
    monitors[PROJECTION_TYPE.SITE] = 1;
    isWindowOpen.mockImplementation(
      async (feature: string) =>
        feature === PROJECTION_TYPE.SITE || feature === PROJECTION_TYPE.SITE_LOADER
    );

    await windows.openSiteWindow("https://exemplo.com/culto", "canva");

    expect(sites()).toHaveLength(1);
    expect(sites()[0][1]).toEqual({ source: "canva" });
    expect(JSON.stringify(sites()[0][1])).not.toContain("exemplo.com");
  });

  it("não abriu → não há o que pausar, e ninguém é avisado", async () => {
    isWindowOpen.mockResolvedValue(false);

    await windows.openSiteWindow("https://exemplo.com/culto", "liturgy");

    expect(sites()).toHaveLength(0);
  });
});
