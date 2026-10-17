import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import pt from "@/modules/media_library/lang/pt.json";
import es from "@/modules/media_library/lang/es.json";

const state = vi.hoisted(() => ({
  isDesktop: true,
  connected: true,
  /** Modo de projeção lido de Integrações; "pdf" é o default de produção. */
  modo: "pdf",
  items: vi.fn(),
  designUrl: vi.fn(),
  exportPdf: vi.fn(),
  /* Parâmetro declarado de propósito: é ele que o teste afirma (`close(true)`). */
  close: vi.fn((_force?: boolean) => Promise.resolve()),
  closeProjectionStage: vi.fn(() => Promise.resolve()),
  openSiteWindow: vi.fn((_url?: string, _source?: string) => Promise.resolve(true)),
  projectFile: vi.fn((_payload: unknown) => Promise.resolve(true)),
  snackbar: vi.fn(),
  yesno: vi.fn(),
  cachedPdfs: vi.fn(),
  clearCachedPdf: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return state.isDesktop;
    },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (_key: string, fallback: unknown) => state.modo ?? fallback,
    set: vi.fn(),
  },
}));
vi.mock("@/helpers/Path", () => ({
  default: { local: (p: string) => `file://${p}`, file: (p: string) => `file://${p}` },
}));
vi.mock("@/composables/useMedia", () => ({
  default: {
    close: (force?: boolean) => state.close(force),
    closeProjectionStage: () => state.closeProjectionStage(),
    projectFile: (payload: unknown) => state.projectFile(payload),
  },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  /* A origem (`"canva"`) precisa chegar ao mock: sem ela não há como afirmar
     de qual módulo veio a projeção. */
  openSiteWindow: (url?: string, source?: string) => state.openSiteWindow(url, source),
}));
vi.mock("@/helpers/Alert", () => ({
  default: { yesno: (...args: unknown[]) => state.yesno(...args) },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: {
    warning: (...args: unknown[]) => state.snackbar("warning", ...args),
    info: (...args: unknown[]) => state.snackbar("info", ...args),
    error: (...args: unknown[]) => state.snackbar("error", ...args),
    success: (...args: unknown[]) => state.snackbar("success", ...args),
  },
}));

import { ICONS } from "@/config/Icons";
import Telemetry from "@/helpers/Telemetry";
import CanvaTab from "../CanvaTab.vue";

const PASTA = { type: "folder" as const, id: "F1", name: "Cultos", thumb: null };
const DESIGN = { type: "design" as const, id: "D1", name: "Slide Páscoa", thumb: null, pageCount: 4 };
const COM_THUMB = {
  type: "image" as const,
  id: "I1",
  name: "Fundo",
  thumb: "https://document-export.canva.com/fundo.png",
  url: "https://document-export.canva.com/fundo.png",
};

function instalarApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { louvorjaApi?: unknown }).louvorjaApi = {
    canva: {
      status: async () => ({ ok: true, connected: state.connected, hasCredentials: true }),
      setCredentials: async () => ({ ok: true }),
      connect: async () => ({ ok: true }),
      disconnect: async () => ({ ok: true }),
      items: state.items,
      designUrl: state.designUrl,
      exportPdf: state.exportPdf,
      cachedPdfs: state.cachedPdfs,
      clearCachedPdf: state.clearCachedPdf,
      ...overrides,
    },
  };
}

/** i18n com as mensagens do módulo — o tm() fala `modules.media_library.*`. */
function i18nComModulo() {
  const i18n = makeI18n("pt");
  i18n.global.mergeLocaleMessage("pt", { modules: { media_library: pt } });
  i18n.global.mergeLocaleMessage("es", { modules: { media_library: es } });
  return i18n;
}

async function mountTab() {
  const wrapper = mount(CanvaTab, { global: { plugins: [i18nComModulo()] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  state.isDesktop = true;
  state.connected = true;
  state.modo = "pdf";
  state.items.mockReset().mockResolvedValue({ ok: true, items: [PASTA, DESIGN], continuation: null });
  state.designUrl.mockReset().mockResolvedValue({ ok: true, url: "https://www.canva.com/design/D1/view" });
  state.exportPdf
    .mockReset()
    .mockResolvedValue({ ok: true, path: "/dados/canva/D1.pdf", pageCount: 4 });
  state.snackbar.mockClear();
  state.projectFile.mockClear();
  state.yesno.mockReset();
  state.cachedPdfs.mockReset().mockResolvedValue({});
  state.clearCachedPdf.mockReset().mockResolvedValue({ ok: true });
  state.close.mockClear();
  state.closeProjectionStage.mockClear();
  state.openSiteWindow.mockClear();
  instalarApi();
});

describe("Aba Canva — disponibilidade", () => {
  it("no web avisa que ela só existe no desktop", async () => {
    state.isDesktop = false;
    delete (window as unknown as { louvorjaApi?: unknown }).louvorjaApi;

    const wrapper = await mountTab();

    expect(wrapper.text()).toContain("aplicativo desktop");
    expect(wrapper.find(".canva-grid").exists()).toBe(false);
  });

  it("desconectado mostra o CTA que abre a tela de Integrações", async () => {
    state.connected = false;
    const wrapper = await mountTab();

    expect(state.items).not.toHaveBeenCalled();
    const abrir = wrapper.findAll("button").find((b) => b.text().includes("Abrir Integrações"));
    expect(abrir).toBeTruthy();

    const ouvinte = vi.fn();
    window.addEventListener("louvorja:open-integrations", ouvinte);
    try {
      await abrir!.trigger("click");
      expect(ouvinte).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("louvorja:open-integrations", ouvinte);
    }
  });
});

describe("Aba Canva — listagem", () => {
  it("lista a raiz e separa pasta de design", async () => {
    const wrapper = await mountTab();

    expect(state.items).toHaveBeenCalledWith({ folderId: "root", continuation: null });
    expect(wrapper.text()).toContain("Cultos");
    expect(wrapper.text()).toContain("Slide Páscoa");
    expect(wrapper.text()).toContain("Pasta");
    expect(wrapper.text()).toContain("Design · 4 páginas");
  });

  it("entrar numa pasta navega; Voltar volta", async () => {
    const wrapper = await mountTab();
    /* Enfileirado DEPOIS do mount: o próximo load é o da pasta. */
    state.items.mockResolvedValueOnce({ ok: true, items: [DESIGN], continuation: null });

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Cultos")!.trigger("click");
    await flushPromises();

    expect(state.items).toHaveBeenLastCalledWith({ folderId: "F1", continuation: null });
    expect(wrapper.text()).toContain("Projetos");
    expect(wrapper.text()).toContain("Cultos");

    await wrapper.findAll("button").find((b) => b.text().trim() === "Voltar")!.trigger("click");
    await flushPromises();
    expect(state.items).toHaveBeenLastCalledWith({ folderId: "root", continuation: null });
  });

  it("carrega mais quando há continuation", async () => {
    state.items.mockResolvedValueOnce({ ok: true, items: [PASTA], continuation: "TOKEN-2" });
    const wrapper = await mountTab();
    state.items.mockResolvedValueOnce({ ok: true, items: [DESIGN], continuation: null });

    const mais = wrapper.findAll("button").find((b) => b.text().trim() === "Carregar mais");
    expect(mais).toBeTruthy();
    await mais!.trigger("click");
    await flushPromises();

    expect(state.items).toHaveBeenLastCalledWith({ folderId: "root", continuation: "TOKEN-2" });
    expect(wrapper.findAll(".canva-item")).toHaveLength(2);
  });

  it("mostra o erro do main em vez de sumir com a grade", async () => {
    state.items.mockResolvedValueOnce({ ok: false, code: "canva_403", message: "Escopo ausente" });
    const wrapper = await mountTab();

    expect(wrapper.text()).toContain("Escopo ausente");
    expect(wrapper.find(".canva-grid").exists()).toBe(false);
    /* Sem "vazio" junto do erro: as duas mensagens brigariam pela mesma tela. */
    expect(wrapper.text()).not.toContain("Nada por aqui");
  });
});

describe("Aba Canva — projeção", () => {
  it("modo PDF (default): exporta no main e projeta pelo leitor do app", async () => {
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(state.exportPdf).toHaveBeenCalledWith("D1");
    expect(state.projectFile).toHaveBeenCalledWith({
      url: "file:///dados/canva/D1.pdf",
      type: "pdf",
      title: "Slide Páscoa",
      /* O que o Canva declara: a projeção compara com o que o pdf.js abriu. */
      pageCount: 4,
    });
    /* No modo PDF a página do Canva não entra em cena. */
    expect(state.designUrl).not.toHaveBeenCalled();
    expect(state.openSiteWindow).not.toHaveBeenCalled();
  });

  it("modo PDF com falha na exportação mostra o motivo e não projeta", async () => {
    state.exportPdf.mockResolvedValueOnce({
      ok: false,
      code: "export_failed",
      message: "O Canva não conseguiu exportar este design.",
    });
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("O Canva não conseguiu exportar este design.");
    expect(state.projectFile).not.toHaveBeenCalled();
  });

  it("modo 'Projeção do Canva': pede um view_url novo e fecha a mídia antes de abrir a URL", async () => {
    state.modo = "site";
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(state.designUrl).toHaveBeenCalledWith("D1");
    expect(state.close).toHaveBeenCalledWith(true);
    expect(state.closeProjectionStage).toHaveBeenCalledTimes(1);
    expect(state.openSiteWindow).toHaveBeenCalledWith("https://www.canva.com/design/D1/view", "canva");
    /* A ordem importa: fechar pela MESMA fila antes de abrir. */
    expect(state.openSiteWindow.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.closeProjectionStage.mock.invocationCallOrder[0]
    );
    expect(state.exportPdf).not.toHaveBeenCalled();
  });

  it("modo 'Projeção do Canva' com falha no link não abre janela nenhuma", async () => {
    state.modo = "site";
    state.designUrl.mockResolvedValueOnce({ ok: false, code: "no_view_url", message: "Sem link." });
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Sem link.");
    expect(state.openSiteWindow).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
  });
});

describe("Aba Canva — estados de carregamento", () => {
  it("não mostra o CTA de conexão antes do status chegar", async () => {
    let liberar!: () => void;
    const pendente = new Promise<CanvaStatus>((resolve) => {
      liberar = () => resolve({ ok: true, connected: false, hasCredentials: true });
    });
    instalarApi({ status: () => pendente });

    const wrapper = mount(CanvaTab, { global: { plugins: [i18nComModulo()] } });
    await nextTick();

    /* Sem o guard de `pronto`, o primeiro frame dizia "conecte sua conta". */
    expect(wrapper.text()).toContain("Verificando a conexão");
    expect(wrapper.text()).not.toContain("Conecte sua conta Canva");

    liberar();
    await flushPromises();
    expect(wrapper.text()).toContain("Conecte sua conta Canva");
  });

  /*
   * O loader do export existe para quem vai exportar. Design já no disco
   * resolve em milissegundos e o aviso piscaria na tela por um frame.
   */
  it("design em cache: o loader do export não aparece", async () => {
    state.items.mockResolvedValue({
      ok: true,
      items: [{ ...DESIGN, id: "D9", name: "Deck", updatedAt: 1_700_000_000 }],
      continuation: null,
    });
    state.cachedPdfs.mockResolvedValue({ D9: 1_700_000_000 });
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Deck")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Exportando o design do Canva");
    expect(state.projectFile).toHaveBeenCalledTimes(1);
  });

  it("design sem cache: o loader aparece já no clique", async () => {
    let soltar!: (_r: unknown) => void;
    state.exportPdf.mockReturnValueOnce(
      new Promise((resolve) => {
        soltar = resolve;
      })
    );
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("Exportando o design do Canva");

    soltar({ ok: true, path: "/dados/canva/D1.pdf", pageCount: 4 });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Exportando o design do Canva");
  });

  it("em cache, mas o main reexporta: o loader chega depois da folga", async () => {
    /*
     * O selo diz que há cache (é o que a aba sabe) e o main reexporta mesmo
     * assim — qualidade diferente da que gerou aquele PDF, por exemplo. Sem a
     * folga, o operador ficaria sem aviso nenhum por minutos.
     */
    state.items.mockResolvedValue({
      ok: true,
      items: [{ ...DESIGN, id: "D9", name: "Deck", updatedAt: 1_700_000_000 }],
      continuation: null,
    });
    state.cachedPdfs.mockResolvedValue({ D9: 1_700_000_000 });
    let soltar!: (_r: unknown) => void;
    state.exportPdf.mockReturnValueOnce(
      new Promise((resolve) => {
        soltar = resolve;
      })
    );
    vi.useFakeTimers();
    try {
      const wrapper = await mountTab();
      await wrapper.findAll("button").find((b) => b.attributes("title") === "Deck")!.trigger("click");
      await nextTick();

      /* A folga é o que segura o pisca-pisca do caso feliz. */
      expect(wrapper.text()).not.toContain("Exportando o design do Canva");
      await vi.advanceTimersByTimeAsync(400);
      expect(wrapper.text()).toContain("Exportando o design do Canva");

      soltar({ ok: true, path: "/dados/canva/D9.pdf", pageCount: 3 });
      await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.text()).not.toContain("Exportando o design do Canva");
    } finally {
      vi.useRealTimers();
    }
  });

  it("miniatura quebrada vira ícone, sem encolher o card", async () => {
    state.items.mockResolvedValueOnce({ ok: true, items: [COM_THUMB], continuation: null });
    const wrapper = await mountTab();

    expect(wrapper.find("img.canva-thumb").exists()).toBe(true);
    await wrapper.find("img.canva-thumb").trigger("error");
    await nextTick();

    expect(wrapper.find("img.canva-thumb").exists()).toBe(false);
    expect(wrapper.find(".canva-thumb--icon").exists()).toBe(true);
  });
});

describe("Aba Canva — falhas não escondem o que já carregou", () => {
  it("Carregar mais que falha mantém a grade na tela", async () => {
    state.items.mockResolvedValueOnce({
      ok: true,
      items: [PASTA, DESIGN],
      continuation: "TOKEN-2",
    });
    const wrapper = await mountTab();
    state.items.mockResolvedValueOnce({ ok: false, code: "canva_429", message: "Muitas consultas." });

    await wrapper.findAll("button").find((b) => b.text().trim() === "Carregar mais")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Muitas consultas.");
    expect(wrapper.findAll(".canva-item")).toHaveLength(2);
  });

  it("clicar de novo em Projetos recarrega — é o 'tentar de novo' da tela", async () => {
    state.items.mockResolvedValueOnce({ ok: false, code: "canva_403", message: "Escopo ausente" });
    const wrapper = await mountTab();
    expect(wrapper.text()).toContain("Escopo ausente");

    await wrapper.findAll("button").find((b) => b.text().trim() === "Projetos")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Escopo ausente");
    expect(wrapper.findAll(".canva-item")).toHaveLength(2);
  });
});

describe("Aba Canva — aviso de sessão do SITE", () => {
  it("modo site sem cookies na partição, aponta para Integrações", async () => {
    state.modo = "site";
    instalarApi({
      status: async () => ({ ok: true, connected: true, hasCredentials: true, webSession: false }),
    });
    const wrapper = await mountTab();

    expect(wrapper.text()).toContain("Ative em Opções → Integrações");
  });

  it("modo PDF não avisa nada: o design não usa cookie nenhum", async () => {
    state.modo = "pdf";
    instalarApi({
      status: async () => ({ ok: true, connected: true, hasCredentials: true, webSession: false }),
    });
    const wrapper = await mountTab();

    expect(wrapper.text()).not.toContain("Ative em Opções → Integrações");
    expect(wrapper.text()).not.toContain("Sem a sessão do Canva");
  });

  it("com a sessão ativa, some", async () => {
    state.modo = "site";
    instalarApi({
      status: async () => ({ ok: true, connected: true, hasCredentials: true, webSession: true }),
    });
    const wrapper = await mountTab();

    expect(wrapper.text()).not.toContain("Ative em Opções → Integrações");
  });
});

describe("Aba Canva — qualidade do export", () => {
  it("pro recusado → snackbar avisando que saiu em Regular", async () => {
    state.exportPdf.mockResolvedValueOnce({
      ok: true,
      path: "/dados/canva/D1.pdf",
      pageCount: 4,
      quality: "regular",
      qualityFallback: true,
    });
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(state.snackbar).toHaveBeenCalledWith(
      "warning",
      expect.stringContaining("Export em Pro indisponível"),
      expect.objectContaining({ key: "canva-quality-fallback" })
    );
    /* O PDF é bom mesmo assim: projeta, só avisa. */
    expect(state.projectFile).toHaveBeenCalledTimes(1);
  });

  it("sem fallback não há snackbar nenhum", async () => {
    const wrapper = await mountTab();

    await wrapper.findAll("button").find((b) => b.attributes("title") === "Slide Páscoa")!.trigger("click");
    await flushPromises();

    expect(state.snackbar).not.toHaveBeenCalled();
    expect(state.projectFile).toHaveBeenCalledTimes(1);
  });
});

describe("Aba Canva — telemetria", () => {
  const eventos = (nome: string) =>
    vi.mocked(Telemetry.track).mock.calls.filter(([evento]) => evento === nome);
  const props = (nome: string) => eventos(nome)[0]?.[1] as Record<string, unknown>;

  const clicarNoDesign = async (wrapper: Awaited<ReturnType<typeof mountTab>>) => {
    await wrapper
      .findAll("button")
      .find((b) => b.attributes("title") === "Slide Páscoa")!
      .trigger("click");
    await flushPromises();
  };

  beforeEach(() => vi.mocked(Telemetry.track).mockClear());

  it("abrir a aba é o sinal de que alguém foi usar o Canva", async () => {
    await mountTab();

    expect(eventos("canva_tab_opened")).toHaveLength(1);
  });

  it("a lista registra contagem e duração — nada de id nem título", async () => {
    await mountTab();

    expect(props("canva_designs_loaded")).toMatchObject({
      view: "folder",
      count: 2,
      continuation: false,
    });
    expect(typeof props("canva_designs_loaded").duration_ms).toBe("number");
    expect(JSON.stringify(props("canva_designs_loaded"))).not.toContain("Páscoa");
  });

  it("clicar num design: intenção + resultado do export, com a origem declarada", async () => {
    const wrapper = await mountTab();
    await clicarNoDesign(wrapper);

    expect(props("canva_project_requested")).toMatchObject({ mode: "pdf" });
    expect(props("canva_export_completed")).toMatchObject({ ok: true, page_count: 4 });
    expect(typeof props("canva_export_completed").duration_ms).toBe("number");
  });

  it("export falho registra o CÓDIGO, nunca a mensagem", async () => {
    state.exportPdf.mockResolvedValueOnce({
      ok: false,
      code: "export_failed",
      message: "https://segredo/canva",
    });
    const wrapper = await mountTab();
    await clicarNoDesign(wrapper);

    expect(props("canva_export_completed")).toMatchObject({
      ok: false,
      reason: "export_failed",
    });
    expect(JSON.stringify(props("canva_export_completed"))).not.toContain("segredo");
  });

  it("o resultado nunca leva URL, design id ou título", async () => {
    const wrapper = await mountTab();
    await clicarNoDesign(wrapper);

    const lidas = props("canva_export_completed");
    const proibidas = ["url", "route", "design_id", "id", "title", "view_url"];
    expect(Object.keys(lidas).filter((k) => proibidas.includes(k))).toEqual([]);
  });

  it("a origem declarada para a janela de site é canva", async () => {
    state.modo = "site";
    const wrapper = await mountTab();
    await clicarNoDesign(wrapper);

    expect(state.openSiteWindow).toHaveBeenCalledWith(
      "https://www.canva.com/design/D1/view",
      "canva"
    );
  });

  it("modo site: intenção, e a falha de link que nunca chega ao site_projected", async () => {
    state.modo = "site";
    state.designUrl.mockResolvedValueOnce({ ok: false, code: "no_view_url", message: "Sem link." });
    const wrapper = await mountTab();
    await clicarNoDesign(wrapper);

    expect(props("canva_project_requested")).toMatchObject({ mode: "site" });
    expect(props("canva_site_link_failed")).toMatchObject({ reason: "no_view_url" });
    expect(eventos("canva_site_link_failed")[0][1]).not.toHaveProperty("message");
  });
});

describe("Aba Canva — selo de cache", () => {
  const DESIGN_CACHE = {
    type: "design",
    id: "D9",
    name: "Deck Páscoa",
    thumb: null,
    pageCount: 3,
    updatedAt: 1_700_000_000,
  };
  /* API antiga (ou payload estranho) sem `updated_at`: aí confia no arquivo. */
  const SEM_DATA = {
    type: "design",
    id: "D9",
    name: "Deck Páscoa",
    thumb: null,
    pageCount: 3,
  };

  const comItens = async (itens: unknown[], mapa: Record<string, number>) => {
    state.items.mockResolvedValue({ ok: true, items: itens, continuation: null });
    state.cachedPdfs.mockResolvedValue(mapa);
    return mountTab();
  };

  it("acende o selo quando o PDF está guardado E ainda vale", async () => {
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    const selo = wrapper.find(".canva-cache");
    expect(selo.exists()).toBe(true);
    expect(selo.attributes("aria-label")).toBe("Em cache");
    expect(wrapper.findAll(".canva-cell")).toHaveLength(1);
  });

  it("some quando o design foi editado no Canva (updated_at diferente)", async () => {
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_600_000_000 });

    expect(wrapper.find(".canva-cache").exists()).toBe(false);
  });

  it("sem PDF guardado não há selo", async () => {
    const wrapper = await comItens([DESIGN_CACHE], {});

    expect(wrapper.find(".canva-cache").exists()).toBe(false);
  });

  it("pasta e imagem nunca têm selo — não é PDF", async () => {
    const wrapper = await comItens([PASTA, COM_THUMB], {
      F1: 1_700_000_000,
      I1: 1_700_000_000,
    });

    expect(wrapper.find(".canva-cache").exists()).toBe(false);
  });

  it("sem `updated_at` no item, confia no arquivo", async () => {
    const wrapper = await comItens([SEM_DATA], { D9: 1_600_000_000 });

    expect(wrapper.find(".canva-cache").exists()).toBe(true);
  });

  it("no modo site o selo some: o cache não é consumido ali", async () => {
    state.modo = "site";
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    expect(wrapper.find(".canva-cache").exists()).toBe(false);
  });

  it("clicar pergunta; em sim apaga, some, e NÃO projeta", async () => {
    state.yesno.mockImplementation((_opts: unknown, cb: (_v: string) => void) => cb("yes"));
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    await wrapper.find(".canva-cache").trigger("click");
    await flushPromises();

    expect(state.yesno).toHaveBeenCalledTimes(1);
    expect(state.clearCachedPdf).toHaveBeenCalledWith("D9");
    expect(wrapper.find(".canva-cache").exists()).toBe(false);
    /* Irmão do card: apagar o cache não pode disparar `abrir`. */
    expect(state.exportPdf).not.toHaveBeenCalled();
    expect(state.projectFile).not.toHaveBeenCalled();
    expect(state.openSiteWindow).not.toHaveBeenCalled();
  });

  it("em não, mantém o PDF guardado", async () => {
    state.yesno.mockImplementation((_opts: unknown, cb: (_v: string) => void) => cb("no"));
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    await wrapper.find(".canva-cache").trigger("click");
    await flushPromises();

    expect(state.clearCachedPdf).not.toHaveBeenCalled();
    expect(wrapper.find(".canva-cache").exists()).toBe(true);
  });

  it("falha ao apagar vira aviso, e o selo continua", async () => {
    state.clearCachedPdf.mockResolvedValue({
      ok: false,
      code: "cache_remove_failed",
      message: "EPERM",
    });
    state.yesno.mockImplementation((_opts: unknown, cb: (_v: string) => void) => cb("yes"));
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    await wrapper.find(".canva-cache").trigger("click");
    await flushPromises();

    expect(state.snackbar).toHaveBeenCalledWith(
      "warning",
      expect.stringContaining("EPERM")
    );
    expect(wrapper.find(".canva-cache").exists()).toBe(true);
  });

  it("a lista busca o mapa de cache uma vez, junto dos itens", async () => {
    await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    expect(state.cachedPdfs).toHaveBeenCalledTimes(1);
    expect(state.items).toHaveBeenCalledTimes(1);
  });

  it("o selo é IRMÃO do card — nenhum `button` dentro de `button`", async () => {
    const wrapper = await comItens([DESIGN_CACHE], { D9: 1_700_000_000 });

    const card = wrapper.find(".canva-item");
    const selo = wrapper.find(".canva-cache");

    expect(card.element.parentElement).toBe(selo.element.parentElement);
    /* `closest` inclui o próprio elemento — o que importa é NÃO estar dentro. */
    expect(card.element.contains(selo.element)).toBe(false);
    expect(card.attributes("title")).toBe("Deck Páscoa");
  });
});

describe("Aba Canva — link do design (caminho sem API)", () => {
  const LINK = "https://www.canva.com/design/DAG1/view?utm_source=x";

  const eventos = (nome: string) =>
    vi.mocked(Telemetry.track).mock.calls.filter(([evento]) => evento === nome);

  const colar = async (wrapper: Awaited<ReturnType<typeof mountTab>>, valor: string) => {
    await wrapper.find('input[type="url"]').setValue(valor);
    await wrapper.find("form.canva-url").trigger("submit");
    await flushPromises();
  };

  beforeEach(() => vi.mocked(Telemetry.track).mockClear());

  it("é o primeiro bloco da aba, mesmo sem conta conectada", async () => {
    state.connected = false;
    const wrapper = await mountTab();

    expect(wrapper.find("form.canva-url").exists()).toBe(true);
    expect(wrapper.find('input[type="url"]').exists()).toBe(true);
    expect(wrapper.findAll("button").find((b) => b.text().trim() === "Projetar")).toBeTruthy();

    /* Acima do aviso de configurar — quem não tem API usa primeiro este. */
    const html = wrapper.html();
    expect(html.indexOf("canva-url")).toBeLessThan(html.indexOf("Abrir Integrações"));
    expect(state.items).not.toHaveBeenCalled();
  });

  it("com a conta conectada continua acima da grade", async () => {
    const wrapper = await mountTab();

    const html = wrapper.html();
    expect(html.indexOf("canva-url")).toBeLessThan(html.indexOf("canva-grid"));
  });

  it("botão fica desabilitado com o campo vazio", async () => {
    const wrapper = await mountTab();

    const botao = wrapper.findAll("button").find((b) => b.text().trim() === "Projetar")!;
    expect(botao.attributes("disabled")).toBeDefined();
  });

  it("link que não é do Canva mostra o aviso e não abre janela", async () => {
    const wrapper = await mountTab();
    await colar(wrapper, "https://exemplo.com/design/qualquer");

    expect(wrapper.find(".canva-url").text()).toContain("não é o link de um design do Canva");
    expect(state.close).not.toHaveBeenCalled();
    expect(state.openSiteWindow).not.toHaveBeenCalled();
  });

  it("endereço do Canva fora de um design também é recusado", async () => {
    const wrapper = await mountTab();
    await colar(wrapper, "https://www.canva.com/folders/abc");

    expect(wrapper.find(".canva-url").text()).toContain("não é o link de um design do Canva");
    expect(state.openSiteWindow).not.toHaveBeenCalled();
  });

  it("link válido projeta pelo caminho de site, com a origem declarada", async () => {
    const wrapper = await mountTab();
    await colar(wrapper, LINK);

    expect(wrapper.find(".lj-field__error").exists()).toBe(false);
    expect(state.close).toHaveBeenCalledWith(true);
    expect(state.closeProjectionStage).toHaveBeenCalled();
    expect(state.openSiteWindow).toHaveBeenCalledWith(LINK, "canva");
    expect(eventos("canva_project_requested")[0]?.[1]).toMatchObject({
      mode: "site",
      via: "url",
    });
    /* Sem API no caminho: nenhum export nem pedido de link da lista. */
    expect(state.exportPdf).not.toHaveBeenCalled();
    expect(state.designUrl).not.toHaveBeenCalled();
  });

  it("cola sem https e o campo avisa no próximo teclado", async () => {
    const wrapper = await mountTab();
    await colar(wrapper, "www.canva.com/design/DAG2/view");

    expect(state.openSiteWindow).toHaveBeenCalledWith("https://www.canva.com/design/DAG2/view", "canva");

    await wrapper.find('input[type="url"]').setValue("x");
    expect(wrapper.find(".lj-field__error").exists()).toBe(false);
  });

  it("o botão fica na mesma linha do input e leva o ícone de projeção", async () => {
    const wrapper = await mountTab();
    const linha = wrapper.find(".canva-url-row");

    expect(linha.find('input[type="url"]').exists()).toBe(true);
    const botao = linha.findAll("button").find((b) => b.text().trim() === "Projetar");
    expect(botao).toBeTruthy();
    expect(botao!.find(".lj-icon").attributes("aria-label")).toBe(ICONS.PROJECTION.START);
  });
});
