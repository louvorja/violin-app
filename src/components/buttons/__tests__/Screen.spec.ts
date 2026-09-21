import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import Screen from "../Screen.vue";
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
      getPreferred: async (feature: string) => (feature in monitors ? { id: monitors[feature] } : null),
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

const main = (wrapper: Awaited<ReturnType<typeof mountButton>>) => wrapper.find(".screen-btn__main");
const lastOpen = () => openWindow.mock.calls.at(-1)?.[0] as OpenArgs;

beforeEach(() => {
  openWindow.mockClear();
  closeWindow.mockClear();
  setPreferred.mockClear();
  openFeatures = [];
  monitors = { [MUSIC]: 7, [FILE]: 7, [ONLINE_VIDEO]: 7 };
  prefs = {};
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

    expect(lastOpen()).toMatchObject({ feature: "bible", route: "/projection/bible", fullscreen: true });
  });
});
