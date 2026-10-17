import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import RibbonScreenButton from "../RibbonScreenButton.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

type OpenArgs = {
  route: string;
  feature: string;
  monitorId: number | string | null;
  fullscreen: boolean;
  alwaysOnTop: boolean;
};

const openWindow = vi.fn(async (_opts: OpenArgs) => {});
const closeWindow = vi.fn(async (_feature: string) => {});
let openFeatures: string[] = [];

const DISPLAYS = [
  { id: 7, label: "Monitor 1", primary: true, bounds: { width: 1920, height: 1080 } },
  { id: 8, label: "Monitor 2", primary: false, bounds: { width: 1280, height: 720 } },
];

vi.mock("@/helpers/Projection", () => ({
  listDisplays: async () => DISPLAYS,
  getCategorizedDisplays: async () => ({
    primaryDisplay: DISPLAYS[0],
    secondaryDisplay: undefined,
    primaryLabel: null,
    secondaryLabel: null,
    otherDisplays: DISPLAYS.slice(1),
  }),
  getPreferredMonitor: async () => 7,
  setPreferredMonitor: async () => {},
  identifyDisplays: async () => {},
  isOpen: async (feature: string) => openFeatures.includes(feature),
  open: (opts: OpenArgs) => openWindow(opts),
  close: (feature: string) => closeWindow(feature),
  getFallbackFeature: () => null,
  isUsingFallback: async () => false,
  needsScreenAccess: async () => false,
  requestScreenAccess: async () => true,
}));

/* Sem isto o botão nem renderiza: `canOpenWebWindows` exige tela cheia. */
vi.mock("@/helpers/projection/webWindow", () => ({
  canOpenWebWindows: () => true,
}));

/** Projeção de fundo no ar? É o portão dos utilitários. */
let backgroundAberto = false;
vi.mock("@/helpers/ProjectionWindows", async (orig) => ({
  ...((await (orig() as Promise<Record<string, unknown>>)) as Record<string, unknown>),
  isBackgroundOpen: async () => backgroundAberto,
}));

const broadcastEnviado: { type: string; payload: unknown }[] = [];
const ouvintes = new Set<(m: { type: string; payload: unknown }) => void>();
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    /* Entrega local em laço: o aviso do botão volta para ele mesmo, como
       acontece entre janelas de verdade. */
    listen: (cb: (m: { type: string; payload: unknown }) => void) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    send: (type: string, payload: unknown) => {
      broadcastEnviado.push({ type, payload });
      for (const cb of ouvintes) cb({ type, payload });
    },
    getLastPayload: () => null,
  },
}));

const MenuStub = defineComponent({
  name: "LjMenu",
  props: { items: { type: Array, default: () => [] } },
  template: "<div />",
});

async function mountButton(props: Record<string, unknown>) {
  const wrapper = mountUi(RibbonScreenButton, {
    props,
    global: { stubs: { LjMenu: MenuStub } },
  });
  await flushPromises();
  return wrapper;
}

const main = (wrapper: Awaited<ReturnType<typeof mountButton>>) =>
  wrapper.find(".ribbon-btn--main");

beforeEach(() => {
  openWindow.mockClear();
  closeWindow.mockClear();
  openFeatures = [];
  backgroundAberto = false;
  broadcastEnviado.length = 0;
  ouvintes.clear();
});

/*
 * Este é o botão que os módulos entregam: o "Projetar" do timer, do contador,
 * do relógio, do quadro de mensagem e do desenho sai da ribbon, via
 * `type: "screen"` no manifest. Ele é caminho DIFERENTE do `Screen.vue` do
 * player — e foi por não estar coberto aqui que o utilitário continuava
 * abrindo janela fullscreen (um retângulo preto, sem fade) por cima do telão.
 */
describe("botão Projetar da ribbon", () => {
  const TIMER = { feature: "timer", route: "/projection/module?module=timer" };

  it("fora do fundo: abre a janela do utilitário como sempre", async () => {
    const wrapper = await mountButton(TIMER);

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow.mock.calls[0][0]).toMatchObject({ feature: "timer", route: TIMER.route });
    expect(broadcastEnviado).toHaveLength(0);
  });

  it("com o fundo aberto: nenhum utilitário abre janela", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton(TIMER);

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("com o fundo aberto: o clique avisa que a camada deve aparecer", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton(TIMER);

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(broadcastEnviado).toContainEqual({
      type: "module_projection_open",
      payload: { module: "timer" },
    });
    expect(main(wrapper).classes()).toContain("ribbon-btn--active");
  });

  it("com o fundo aberto: clicar de novo desliga a camada", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton(TIMER);

    await main(wrapper).trigger("click");
    await flushPromises();
    await main(wrapper).trigger("click");
    await flushPromises();

    /*
     * O aviso de fechar é o mesmo que o ESC da janela usa: quem consome o
     * INTENT de desligar é a autoridade, que publica o VALOR do módulo — e
     * valor não é visibilidade. Mandar aquele deixaria o utilitário preso.
     */
    expect(broadcastEnviado).toContainEqual({
      type: "module_projection_close",
      payload: { module: "timer" },
    });
    expect(openWindow).not.toHaveBeenCalled();
    expect(main(wrapper).classes()).not.toContain("ribbon-btn--active");
  });

  it("com o fundo aberto e a janela antiga no ar, fecha a janela antes de acender a camada", async () => {
    /*
     * O fundo pode ser ligado DEPOIS do utilitário estar projetado: a janela
     * antiga continua no ar e, com a camada acesa, o mesmo módulo apareceria
     * duas vezes — a janela opaca por cima, exatamente o retângulo que a
     * camada existe para evitar.
     */
    backgroundAberto = true;
    openFeatures = ["timer"];
    const wrapper = await mountButton(TIMER);

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(closeWindow).toHaveBeenCalledWith("timer");
    expect(openWindow).not.toHaveBeenCalled();
    expect(broadcastEnviado).toContainEqual({
      type: "module_projection_open",
      payload: { module: "timer" },
    });
  });

  it("o botão reflete a camada, não a existência da janela", async () => {
    backgroundAberto = true;
    openFeatures = [];
    const wrapper = await mountButton(TIMER);

    /* Utilitário que já estava no ar: o botão nasce desligado e é o clique que
       liga — o valor que o módulo emite é fluxo, não estado. */
    expect(main(wrapper).classes()).not.toContain("ribbon-btn--active");

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(main(wrapper).classes()).toContain("ribbon-btn--active");
  });

  it("a playlist continua abrindo janela com o fundo ligado", async () => {
    backgroundAberto = true;
    const wrapper = await mountButton({ feature: "file", route: "/projection/file" });

    await main(wrapper).trigger("click");
    await flushPromises();

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(broadcastEnviado).toHaveLength(0);
  });
});
