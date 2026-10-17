import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import Screen from "../Screen.vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { PROJECTION_TYPE, PROJECTION_URL } from "@/constants/Projection";
import { KEYS } from "@/constants/UserDataKeys";

type OpenArgs = {
  route: string;
  feature: string;
  monitorId: number | string | null;
  fullscreen: boolean;
  alwaysOnTop: boolean;
};

const openWindow = vi.fn(async (_opts: OpenArgs) => {});
const closeWindow = vi.fn(async (_feature: string) => {});
const setPreferred = vi.fn();
/** Features com janela aberta agora. */
let openFeatures: string[] = [];
/** Monitor que cada feature resolve (o main resolve por papel; aqui, direto). */
let monitors: Record<string, number> = {};

const DISPLAYS = [
  { id: 7, label: "Monitor 1", primary: true, bounds: { width: 1920, height: 1080 } },
  { id: 8, label: "Monitor 2", primary: false, bounds: { width: 1280, height: 720 } },
];

vi.mock("@/helpers/Projection", () => ({
  listDisplays: async () => DISPLAYS,
  getCategorizedDisplays: async () => ({
    primaryDisplay: undefined,
    secondaryDisplay: undefined,
    primaryLabel: null,
    secondaryLabel: null,
    otherDisplays: DISPLAYS,
  }),
  getPreferredMonitor: async (feature: string) => monitors[feature] ?? null,
  setPreferredMonitor: async (feature: string, id: number | null) => {
    setPreferred(feature, id);
    if (id == null) delete monitors[feature];
    else monitors[feature] = id;
  },
  identifyDisplays: async () => {},
  isOpen: async (feature: string) => openFeatures.includes(feature),
  open: (opts: OpenArgs) => openWindow(opts),
  close: (feature: string) => closeWindow(feature),
  getFallbackFeature: () => null,
  isUsingFallback: async () => false,
  needsScreenAccess: async () => false,
  requestScreenAccess: async () => true,
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    displays: {
      getPreferred: async (feature: string) =>
        feature in monitors ? { id: monitors[feature] } : null,
    },
  },
}));

let prefs: Record<string, unknown> = {};
vi.mock("@/helpers/UserData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in prefs ? prefs[key] : fallback) },
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback ?? false },
}));
vi.mock("@/helpers/Popup", () => ({ default: { open: vi.fn(), exit: vi.fn(), close: vi.fn() } }));

/** Features com a janela de fundo no ar — o portão dos utilitários. */
let backgroundAberto = false;
vi.mock("@/helpers/ProjectionWindows", async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  isBackgroundOpen: async () => backgroundAberto,
}));

const broadcastEnviado: { type: string; payload: unknown }[] = [];
let estadoDosModulos: Record<string, { active: boolean }> = {};
const ouvintes = new Set<(m: { type: string; payload: unknown }) => void>();
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    /* Entrega local em laço: o que o botão emite volta para ele mesmo, como
       acontece entre janelas de verdade. */
    listen: (cb: (m: { type: string; payload: unknown }) => void) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    send: (type: string, payload: unknown) => {
      broadcastEnviado.push({ type, payload });
      const mod = (payload as { module?: string } | null)?.module;
      const at = (payload as { active?: boolean } | null)?.active;
      if (type === "module_projection_value" && mod && typeof at === "boolean") {
        estadoDosModulos[mod] = { active: at };
      }
      for (const cb of ouvintes) cb({ type, payload });
    },
    getLastPayload: (type: string, mod?: string) =>
      type === "module_projection_value" && mod ? (estadoDosModulos[mod] ?? null) : null,
  },
}));

const { openMediaWindow } = await import("@/helpers/ProjectionWindows");
const { MUSIC, FILE, ONLINE_VIDEO } = PROJECTION_TYPE;

const MenuStub = defineComponent({
  name: "LjMenu",
  props: { items: { type: Array, default: () => [] } },
  template: "<div />",
});
const TooltipStub = { template: "<div><slot /></div>" };

type MenuItem = { label?: string; hint?: string; action?: () => void };

async function mountButton(props: Record<string, unknown>) {
  const wrapper = mountUi(Screen, {
    props,
    global: { stubs: { LjMenu: MenuStub, LjTooltip: TooltipStub } },
  });
  await flushPromises();
  return wrapper;
}

const main = (wrapper: Awaited<ReturnType<typeof mountButton>>) =>
  wrapper.find(".screen-btn__main");
const lastOpen = () => openWindow.mock.calls.at(-1)?.[0] as OpenArgs;

beforeEach(() => {
  openWindow.mockClear();
  closeWindow.mockClear();
  setPreferred.mockClear();
  openFeatures = [];
  monitors = { [MUSIC]: 7, [FILE]: 7, [ONLINE_VIDEO]: 7 };
  prefs = {};
  backgroundAberto = false;
  broadcastEnviado.length = 0;
  estadoDosModulos = {};
  ouvintes.clear();
});

/*
 * Utilitários (timer, contador, relógio…) com a Projeção de Fundo ligada.
 *
 * Sem o portão, `/projection/module` abria uma JANELA fullscreen por cima do
 * telão: um retângulo preto, sem fade. Com o fundo aberto, o utilitário é uma
 * camada dele — e o botão precisa refletir isso, senão ficaria dizendo "não
 * projetado" com o utilitário na tela.
 */
describe("utilitário com a projeção de fundo ligada", () => {
  const TIMER = "/projection/module?module=timer";

  it("não abre janela: quem projeta é a camada do fundo", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton({ module: "timer" });

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).not.toHaveBeenCalled();
  });

  it("o botão reflete a camada, não a janela", async () => {
    /* O módulo já está no ar e a camada é a que o projeta — o botão tem que
       dizer "ligado" mesmo sem janela nenhuma. */
    backgroundAberto = true;
    const wrapper = await mountButton({ module: "timer" });

    /* O módulo emite valor desde que abre — isso NÃO pode ligar o botão. */
    estadoDosModulos.timer = { active: true };
    expect(main(wrapper).classes()).not.toContain("screen-btn__main--active");

    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: "timer" });
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(main(wrapper).classes()).toContain("screen-btn__main--active");
  });

  it("o clique em Projetar avisa a camada do fundo", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton({ module: "timer" });

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(broadcastEnviado).toContainEqual({
      type: "module_projection_open",
      payload: { module: "timer" },
    });
  });

  it("fechar desliga o módulo em vez de fechar janela", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton({ module: "timer" });
    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: "timer" });
    await flushPromises();

    await main(wrapper).trigger("click"); // está ligado: o clique fecha
    await flushPromises();

    expect(closeWindow).not.toHaveBeenCalled();
    /*
     * O aviso de fechar é o mesmo que o ESC da janela usa. Mandar o INTENT de
     * desligar não chega à camada: quem consome aquele é a autoridade, que
     * publica o VALOR do módulo — e valor não é visibilidade. O utilitário
     * ficaria preso no telão.
     */
    expect(broadcastEnviado).toContainEqual({
      type: "module_projection_close",
      payload: { module: "timer" },
    });
    expect(broadcastEnviado).not.toContainEqual({
      type: "module_projection_intent",
      payload: { module: "timer", active: false },
    });
  });

  it("fora do fundo ligado, o botão continua perguntando pela janela", async () => {
    /* Sem fundo, quem responde é a janela: um utilitário com a janela fechada
       por engano não pode parecer ligado. */
    backgroundAberto = false;
    const wrapper = await mountButton({ module: "timer" });
    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: "timer" });
    await flushPromises();

    expect(main(wrapper).classes()).not.toContain("screen-btn__main--active");
  });

  it("sem o fundo ligado, continua abrindo a janela própria", async () => {
    backgroundAberto = false;
    const wrapper = await mountButton({ module: "timer" });

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(lastOpen()).toMatchObject({ route: TIMER, feature: "timer" });
  });
});

describe("botão 'Abrir no monitor' do player abre a janela da mídia no ar", () => {
  it.each([
    ["music", PROJECTION_URL.MUSIC, MUSIC],
    ["file", PROJECTION_URL.FILE, FILE],
    ["video", PROJECTION_URL.FILE, FILE],
  ])("%s: abre %s como %s", async (media, route, feature) => {
    const wrapper = await mountButton({ media });
    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(lastOpen()).toMatchObject({ route, feature });
  });

  it("com vídeo no ar nunca abre a projeção de música, que não mostra vídeo e ficava preta em tela cheia", async () => {
    const wrapper = await mountButton({ media: "video" });
    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow.mock.calls.map(([o]) => o.route)).not.toContain(PROJECTION_URL.MUSIC);
    expect(openWindow.mock.calls.map(([o]) => o.feature)).not.toContain(MUSIC);
  });

  it("é a mesma abertura do menu do player e da abertura automática, argumento por argumento", async () => {
    const wrapper = await mountButton({ media: "video" });
    await main(wrapper).trigger("click");
    await flushPromises();
    const doBotao = lastOpen();

    openWindow.mockClear();
    await openMediaWindow("projection", "video", { explicit: true });
    expect(lastOpen()).toEqual(doBotao);
  });

  it("segue a tela cheia e o 'sempre no topo' da mídia, não uma tela cheia fixa", async () => {
    prefs = {
      [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.FULLSCREEN]: false,
      [KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.ALWAYS_ON_TOP]: false,
    };
    const wrapper = await mountButton({ media: "video" });
    await main(wrapper).trigger("click");
    await flushPromises();

    expect(lastOpen()).toMatchObject({ fullscreen: false, alwaysOnTop: false });
  });

  it("com a projeção do vídeo aberta, o botão a fecha em vez de abrir outra", async () => {
    openFeatures = [FILE];
    const wrapper = await mountButton({ media: "video" });
    expect(main(wrapper).classes()).toContain("screen-btn__main--active");

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(closeWindow).toHaveBeenCalledWith(FILE);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("uma projeção de música aberta não conta como a do vídeo: o botão abre a do vídeo", async () => {
    openFeatures = [MUSIC];
    const wrapper = await mountButton({ media: "video" });
    expect(main(wrapper).classes()).not.toContain("screen-btn__main--active");

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(closeWindow).not.toHaveBeenCalled();
    expect(lastOpen()).toMatchObject({ route: PROJECTION_URL.FILE, feature: FILE });
  });

  it("quando a mídia muda, o botão passa a valer para a nova", async () => {
    openFeatures = [FILE];
    const wrapper = await mountButton({ media: "video" });
    expect(main(wrapper).classes()).toContain("screen-btn__main--active");

    await wrapper.setProps({ media: "music" });
    await flushPromises();

    expect(main(wrapper).classes()).not.toContain("screen-btn__main--active");
  });
});

describe("menu de monitores do botão do player", () => {
  const menuItems = (wrapper: Awaited<ReturnType<typeof mountButton>>) =>
    wrapper.findComponent(MenuStub).props("items") as MenuItem[];

  it("escolher um monitor grava a preferência da opção de monitor do vídeo e abre a janela do vídeo nele", async () => {
    const wrapper = await mountButton({ media: "video" });
    const monitor2 = menuItems(wrapper).find((item) => item.label === "Monitor 2") as MenuItem;
    monitor2.action?.();
    await flushPromises();

    expect(setPreferred).toHaveBeenCalledWith(ONLINE_VIDEO, 8);
    expect(lastOpen()).toMatchObject({ route: PROJECTION_URL.FILE, feature: FILE, monitorId: 8 });
  });

  it("escolher um monitor com a janela aberta troca de monitor: fecha a do vídeo e abre de novo", async () => {
    openFeatures = [FILE];
    const wrapper = await mountButton({ media: "video" });
    const monitor2 = menuItems(wrapper).find((item) => item.label === "Monitor 2") as MenuItem;
    monitor2.action?.();
    await flushPromises();

    expect(closeWindow).toHaveBeenCalledWith(FILE);
    expect(lastOpen()).toMatchObject({ feature: FILE, monitorId: 8 });
  });
});

describe("botão genérico, sem mídia (outros módulos)", () => {
  it("continua abrindo a feature e a rota que recebeu", async () => {
    const wrapper = await mountButton({ feature: "bible", route: "/projection/bible" });
    await main(wrapper).trigger("click");
    await flushPromises();

    expect(lastOpen()).toMatchObject({
      feature: "bible",
      route: "/projection/bible",
      fullscreen: true,
    });
  });
});
