import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Telemetry from "@/helpers/Telemetry";
import SiteLoader from "@/views/SiteLoader.vue";
/* O `?raw` devolve o SFC inteiro — é o que permite ler o CSS que o jsdom não renderiza. */
import FONTE from "../SiteLoader.vue?raw";
import { MAIN_BACKGROUND_ID } from "@/types/Settings";

const getSetting = vi.fn();
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn() },
}));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: (id: string) => getSetting(id),
}));

/** O canal que o main usa para abrir/fechar o ciclo do loader. */
type Aviso = ((_dados: { pronto: boolean; apresentou?: boolean | null }) => void) | null;
let aviso: Aviso = null;
let limpos = false;

function instalarApi(): void {
  aviso = null;
  limpos = false;
  (window as unknown as { louvorjaApi?: unknown }).louvorjaApi = {
    siteLoader: {
      onPronto: (cb: (_dados: { pronto: boolean; apresentou?: boolean | null }) => void) => {
        aviso = cb;
        return () => {
          limpos = true;
          aviso = null;
        };
      },
      aguardar: async () => ({ ok: true }),
    },
  };
}

/**
 * `script setup` — o `style` só se lê pelo nó, não pelo `attributes` (o jsdom
 * serializa o atalho `background` e engole os longhands).
 */
function montar() {
  return mount(SiteLoader);
}

/**
 * `URL.createObjectURL` não existe no jsdom. Substituir o objeto INTEIRO do
 * global (como este teste fazia) derrubava `new URL(...)` — que a tela usa
 * para resolver o logo. Define só os dois métodos, e apaga no `afterEach`.
 */
function instalarObjectUrl(create: ReturnType<typeof vi.fn>, revoke: ReturnType<typeof vi.fn>) {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
}

function removerObjectUrl() {
  const alvo = URL as unknown as Record<string, unknown>;
  delete alvo.createObjectURL;
  delete alvo.revokeObjectURL;
}

function estilo(wrapper: ReturnType<typeof mount>): CSSStyleDeclaration {
  return (wrapper.find(".site-loader").element as HTMLElement).style;
}

beforeEach(() => {
  instalarApi();
  getSetting.mockResolvedValue(null);
  vi.mocked(Telemetry.track).mockClear();
});

afterEach(() => {
  delete (window as unknown as { louvorjaApi?: unknown }).louvorjaApi;
  removerObjectUrl();
  vi.restoreAllMocks();
});

describe("SiteLoader", () => {
  it("mostra só a marca — nenhuma linha de texto no telão", async () => {
    const wrapper = montar();
    await flushPromises();

    expect(wrapper.find(".site-loader__logo").exists()).toBe(true);
    expect(wrapper.find(".site-loader__anel").exists()).toBe(true);
    /* Nada de título nem descrição: a tela vive segundos, texto seria ruído. */
    expect(wrapper.text().trim()).toBe("");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it("o logo resolve contra o DOCUMENTO, não contra a raiz do protocolo", async () => {
    const wrapper = montar();
    await flushPromises();

    const src = wrapper.find(".site-loader__logo").attributes("src") || "";
    expect(src.endsWith("logo.png")).toBe(true);
    /* Absoluto (`/logo.png`) quebraria em louvorja://app/index.html. */
    expect(src.startsWith("/logo.png")).toBe(false);
    expect(new URL(src).href).toBe(src);
  });

  it("usa o MESMO fundo da Opções → Geral → Imagem de Fundo", async () => {
    getSetting.mockResolvedValue({ id: MAIN_BACKGROUND_ID, color: "#123456" });
    const wrapper = montar();
    await flushPromises();

    expect(estilo(wrapper).backgroundColor).toBe("rgb(18, 52, 86)");
    /* Sem imagem não há o que desenhar por cima da cor. */
    expect(estilo(wrapper).backgroundImage).not.toContain("url(");
    expect(getSetting).toHaveBeenCalledWith(MAIN_BACKGROUND_ID);
  });

  it("com imagem de fundo, usa a posição configurada", async () => {
    const create = vi.fn(() => "blob:https://localhost/abc-123");
    const revoke = vi.fn();
    instalarObjectUrl(create, revoke);
    getSetting.mockResolvedValue({
      id: MAIN_BACKGROUND_ID,
      color: "#000000",
      position: "tile",
      image: new ArrayBuffer(4),
      mime: "image/png",
    });

    const wrapper = montar();
    await flushPromises();

    expect(create).toHaveBeenCalledTimes(1);
    expect(estilo(wrapper).backgroundImage).toContain("blob:https://localhost/abc-123");
    /* "tile" → ladrilho: repete e volta ao tamanho natural. */
    expect(estilo(wrapper).backgroundRepeat).toBe("repeat");
    expect(estilo(wrapper).backgroundPosition).toBe("0px 0px");

    wrapper.unmount();
    expect(revoke).toHaveBeenCalled();
  });

  it("sem registro de fundo, cai no preto padrão", async () => {
    getSetting.mockResolvedValue(null);
    const wrapper = montar();
    await flushPromises();

    expect(estilo(wrapper).backgroundColor).toBe("rgb(0, 0, 0)");
  });

  it("pronto:true dá o fade; pronto:false tira (janela reutilizada)", async () => {
    const wrapper = montar();
    await flushPromises();
    const tela = wrapper.find(".site-loader");

    expect(typeof aviso).toBe("function");
    aviso!({ pronto: true });
    await wrapper.vm.$nextTick();
    expect(tela.classes()).toContain("site-loader--saindo");

    aviso!({ pronto: false });
    await wrapper.vm.$nextTick();
    expect(tela.classes()).not.toContain("site-loader--saindo");
  });

  it("aviso sem campo pronto não apaga a tela", async () => {
    const wrapper = montar();
    await flushPromises();

    (aviso as unknown as (_d?: unknown) => void)?.({});
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".site-loader").classes()).not.toContain("site-loader--saindo");
  });

  it("ao desmontar, solta o ouvinte do main", async () => {
    const wrapper = montar();
    await flushPromises();
    expect(limpos).toBe(false);

    wrapper.unmount();

    expect(limpos).toBe(true);
  });

  it("sem porta do main, a tela ainda renderiza (não há o que esperar)", async () => {
    delete (window as unknown as { louvorjaApi?: unknown }).louvorjaApi;

    const wrapper = montar();
    await flushPromises();

    expect(wrapper.find(".site-loader__marca").exists()).toBe(true);
    expect(aviso).toBeNull();
  });
});

/*
 * O que o jsdom não vê: `conic-gradient`, `mask` e as variáveis de cor. Em vez
 * de fingir que renderiza, o contrato do CSS é lido na fonte — é o mesmo
 * truque dos testes de contrato do main, e é o que garante as três cores da
 * marca (amarelo/azul/preto) e a ausência de texto.
 */
describe("SiteLoader — contrato visual", () => {
  it("o anel gira nas três cores da marca", () => {
    expect(FONTE).toContain("--site-loader-amarelo: #fbcf02");
    expect(FONTE).toContain("--site-loader-azul: #00b8fd");
    expect(FONTE).toContain("--site-loader-preto: #060605");
    expect(FONTE).toContain("conic-gradient(");
    expect(FONTE).toContain("animation: site-loader-girar");
  });

  it("o anel é uma faixa: máscara abre o centro para o logo aparecer", () => {
    expect(FONTE).toContain("mask: radial-gradient(");
    expect(FONTE).toContain("transparent calc(100% - var(--site-loader-grossura))");
  });

  it("não sobrou chamada de i18n nem chave de texto antiga", () => {
    expect(FONTE).not.toContain("$t(");
    expect(FONTE).not.toContain("site_loading");
    expect(FONTE).not.toContain("role=\"status\"");
  });
});

describe("SiteLoader — telemetria da apresentação", () => {
  const eventos = () =>
    vi.mocked(Telemetry.track).mock.calls.filter(([evento]) => evento === "canva_site_presented");
  const props = () => eventos()[0]?.[1] as Record<string, unknown>;

  it("apresentação confirmada registra o resultado e o tempo coberto", async () => {
    montar();
    await flushPromises();

    aviso!({ pronto: true, apresentou: true });

    expect(eventos()).toHaveLength(1);
    expect(props().presented).toBe(true);
    expect(typeof props().loader_ms).toBe("number");
  });

  it("apresentação que NÃO confirmou também é registro — é o modo Site falhando", async () => {
    montar();
    await flushPromises();

    aviso!({ pronto: true, apresentou: false });

    expect(props().presented).toBe(false);
  });

  it("Site de liturgia (sem gesto) não vira evento de Canva", async () => {
    montar();
    await flushPromises();

    aviso!({ pronto: true, apresentou: null });

    expect(eventos()).toHaveLength(0);
  });

  it("início do ciclo (pronto: false) não registra nada", async () => {
    montar();
    await flushPromises();

    aviso!({ pronto: false });

    expect(eventos()).toHaveLength(0);
  });

  it("um só evento por ciclo, mesmo se o main avisar de novo", async () => {
    montar();
    await flushPromises();

    aviso!({ pronto: true, apresentou: true });
    aviso!({ pronto: true, apresentou: true });

    expect(eventos()).toHaveLength(1);
  });
});
