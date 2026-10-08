import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import { KEYS } from "@/constants/UserDataKeys";

const state = vi.hoisted(() => ({
  isDesktop: true,
  /** "Projetar como" — o default de produção é exportar em PDF. */
  projectAs: "pdf",
  /** Qualidade do export em PDF — default `regular`. */
  exportQuality: "regular",
  setUserData: vi.fn(),
  status: {
    ok: true,
    available: true,
    hasCredentials: false,
    connected: false,
    encrypted: true,
    keyOk: true,
    profile: "",
    redirectUri: "http://127.0.0.1:5530/auth/canva",
    port: 5530,
  } as CanvaStatus,
  setCredentials: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  webLogin: vi.fn(),
  webLogout: vi.fn(),
  exportPdf: vi.fn(),
  onLoginWall: vi.fn(() => () => {}),
  message: vi.fn(),
  yesno: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return state.isDesktop;
    },
  },
}));
vi.mock("@/helpers/Alert", () => ({
  default: { message: (...args: unknown[]) => state.message(...args), yesno: (...args: unknown[]) => state.yesno(...args) },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { success: (...args: unknown[]) => state.success(...args) },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    /* Espelha só as duas chaves que a tela lê; o resto cai no default. */
    get: (key: string, fallback: unknown) => {
      if (key.endsWith(".export_quality")) return state.exportQuality ?? fallback;
      if (key.endsWith(".project_as")) return state.projectAs ?? fallback;
      return fallback;
    },
    set: (key: string, value: unknown) => state.setUserData(key, value),
  },
}));

import Telemetry from "@/helpers/Telemetry";
import AppMenuIntegracoes from "../AppMenuIntegracoes.vue";

type Api = NonNullable<Window["louvorjaApi"]>["canva"];

function instalarApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    status: async () => state.status,
    setCredentials: state.setCredentials,
    connect: state.connect,
    disconnect: state.disconnect,
    webLogin: state.webLogin,
    webLogout: state.webLogout,
    exportPdf: state.exportPdf,
    onLoginWall: state.onLoginWall,
    items: async () => ({ ok: true, items: [] }),
    designUrl: async () => ({ ok: true }),
    ...overrides,
  };
  (window as unknown as { louvorjaApi?: unknown }).louvorjaApi = { canva: api };
  return api;
}

function removerApi(): void {
  delete (window as unknown as { louvorjaApi?: unknown }).louvorjaApi;
}

async function mountPanel() {
  /*
   * O LjDialog teleporta para `document.body` (o stub do VTU esvazia o
   * conteúdo), então os testes de diálogo leem de lá — e o `beforeEach` limpa,
   * senão o diálogo de um caso ficaria no corpo para o próximo achar.
   */
  const wrapper = mount(AppMenuIntegracoes, { global: { plugins: [makeI18n("pt")] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  /* Diálogos do caso anterior teleportados no corpo — fora antes de montar. */
  document.querySelectorAll(".lj-dialog, .lj-dialog__overlay").forEach((n) => n.remove());
  state.isDesktop = true;
  state.projectAs = "pdf";
  state.exportQuality = "regular";
  state.status = {
    ok: true,
    available: true,
    hasCredentials: false,
    connected: false,
    encrypted: true,
    keyOk: true,
    webSession: false,
    profile: "",
    redirectUri: "http://127.0.0.1:5530/auth/canva",
    port: 5530,
  };
  state.setCredentials.mockReset().mockImplementation(async () => {
    /*
     * Objeto NOVO, não mutação: `status.value` guarda um proxy do objeto
     * anterior, e escrever direto no alvo cru não dispara o trigger do Vue.
     */
    state.status = { ...state.status, hasCredentials: true };
    return { ok: true, hasCredentials: true, connected: state.status.connected, encrypted: true };
  });
  state.connect.mockReset().mockImplementation(async () => {
    state.status = { ...state.status, connected: true, profile: "Maria" };
    return { ok: true };
  });
  state.disconnect.mockReset().mockImplementation(async () => {
    state.status = { ...state.status, connected: false, profile: "" };
    return { ok: true };
  });
  state.webLogin.mockReset().mockResolvedValue({ ok: true });
  state.webLogout.mockReset().mockResolvedValue({ ok: true, removidos: 3 });
  state.exportPdf.mockReset().mockResolvedValue({ ok: true, path: "/tmp/design.pdf", cached: true });
  state.message.mockReset();
  state.yesno.mockReset();
  state.success.mockReset();
  instalarApi();
});

describe("Integrações — estado inicial", () => {
  /* A linha de Sessão só existe em quem projeta a página do Canva. */
  beforeEach(() => {
    state.projectAs = "site";
  });
  it("mostra a Redirect URL registrável e o botão Conectar bloqueado sem credenciais", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("http://127.0.0.1:5530/auth/canva");

    const conectar = wrapper.findAll("button").find((b) => b.text().trim() === "Conectar");
    expect(conectar).toBeTruthy();
    expect(conectar!.attributes("disabled")).toBeDefined();
  });

  it("sem credenciais salvas, os dois campos ficam na tela", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.find("#canva-client-id").exists()).toBe(true);
    expect(wrapper.find("#canva-client-secret").exists()).toBe(true);
  });

  it("com credenciais salvas, o Client Secret não é reexibido", async () => {
    state.status.hasCredentials = true;
    const wrapper = await mountPanel();

    expect(wrapper.find("#canva-client-secret").exists()).toBe(false);
    expect(wrapper.text()).toContain("Credenciais salvas (criptografadas)");
  });
});

describe("Integrações — credenciais", () => {
  it("salva pelo IPC e tira o segredo do estado da tela", async () => {
    const wrapper = await mountPanel();

    await wrapper.find("#canva-client-id").setValue("OC-1234");
    await wrapper.find("#canva-client-secret").setValue("cnvca_segredo");
    const salvar = wrapper.findAll("button").find((b) => b.text().trim() === "Salvar credenciais");
    await salvar!.trigger("click");
    await flushPromises();

    expect(state.setCredentials).toHaveBeenCalledWith("OC-1234", "cnvca_segredo");
    expect(state.success).toHaveBeenCalled();
    /* Campo sumiu com a tela e o valor não ficou para trás. */
    expect(wrapper.find("#canva-client-secret").exists()).toBe(false);
    expect(wrapper.text()).toContain("Credenciais salvas (criptografadas)");
  });

  it("mostra o motivo quando o main recusa", async () => {
    state.setCredentials.mockResolvedValueOnce({
      ok: false,
      code: "invalid_client_id",
      message: "Client ID inválido.",
    });
    const wrapper = await mountPanel();

    await wrapper.find("#canva-client-id").setValue("??");
    await wrapper.find("#canva-client-secret").setValue("x");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Salvar credenciais")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Client ID inválido.");
    expect(state.success).not.toHaveBeenCalled();
  });
});

describe("Integrações — conexão", () => {
  it("Conectar chama o IPC e atualiza o estado", async () => {
    state.status.hasCredentials = true;
    const wrapper = await mountPanel();

    await wrapper.findAll("button").find((b) => b.text().trim() === "Conectar")!.trigger("click");
    await flushPromises();

    expect(state.connect).toHaveBeenCalledTimes(1);
    expect(state.success).toHaveBeenCalled();
  });

  it("a falha do fluxo vai para o alerta, não some", async () => {
    state.status.hasCredentials = true;
    state.connect.mockResolvedValueOnce({
      ok: false,
      code: "EADDRINUSE",
      message: "A porta 5530 está ocupada.",
    });
    const wrapper = await mountPanel();

    await wrapper.findAll("button").find((b) => b.text().trim() === "Conectar")!.trigger("click");
    await flushPromises();

    expect(state.message).toHaveBeenCalledWith("A porta 5530 está ocupada.");
    expect(state.success).not.toHaveBeenCalled();
  });

  it("Desconectar só age depois da confirmação", async () => {
    state.status.connected = true;
    state.status.profile = "Maria";
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Conectado como Maria");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Desconectar")!.trigger("click");
    expect(state.disconnect).not.toHaveBeenCalled();

    /* Confirma pelo callback que o $alert.yesno devolve. */
    const [, callback] = state.yesno.mock.calls[0] as [unknown, (_btn: string) => void];
    callback("yes");
    await flushPromises();

    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("Integrações — fora do desktop", () => {
  it("explica que a conexão só existe no app desktop", async () => {
    state.isDesktop = false;
    removerApi();
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("só no aplicativo desktop");
    expect(wrapper.find("#canva-client-id").exists()).toBe(false);
  });
});

describe("Integrações — falhas de fronteira", () => {
  beforeEach(() => {
    state.projectAs = "site";
  });
  it("invoke que rejeita vira mensagem na tela, não unhandled rejection", async () => {
    state.setCredentials.mockRejectedValueOnce(new Error("Canal IPC indisponível."));
    const wrapper = await mountPanel();

    await wrapper.find("#canva-client-id").setValue("OC-1");
    await wrapper.find("#canva-client-secret").setValue("s");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Salvar credenciais")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Canal IPC indisponível.");
    expect(state.success).not.toHaveBeenCalled();
  });

  it("gravar credenciais não troca o status por 'aguardando autorização'", async () => {
    let liberar!: () => void;
    state.setCredentials.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberar = () => resolve({ ok: true, hasCredentials: true });
        })
    );
    const wrapper = await mountPanel();

    await wrapper.find("#canva-client-id").setValue("OC-1");
    await wrapper.find("#canva-client-secret").setValue("s");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Salvar credenciais")!.trigger("click");
    await nextTick();

    /* O texto de espera pertence SÓ ao fluxo OAuth. */
    expect(wrapper.text()).toContain("Não conectado");
    expect(wrapper.text()).not.toContain("Aguardando autorização no navegador");
    expect(
      wrapper.findAll("button").find((b) => b.text().trim() === "Conectar")?.text().trim()
    ).toBe("Conectar");

    liberar();
    await flushPromises();
  });
});

describe("Integrações — sessão do SITE (cookies da projeção)", () => {
  beforeEach(() => {
    state.projectAs = "site";
  });
  it("diz que não há sessão e explica que a projeção pode pedir login", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Sem sessão — a projeção vai pedir login do Canva");
    expect(wrapper.text()).toContain("Fazer login no Canva");
    expect(wrapper.text()).toContain("O token da API não serve aqui");
  });

  it("com a sessão conferida, o selo diz de quem é a conta", async () => {
    state.status = { ...state.status, webSession: true, profile: "Maria" };
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Sessão ativa como Maria");
    expect(wrapper.text()).not.toContain("Sem sessão");
  });

  it("sem nome no perfil, cai em 'Sessão ativa' — não em 'como ' vazio", async () => {
    state.status = { ...state.status, webSession: true, profile: "" };
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Sessão ativa");
    expect(wrapper.text()).not.toContain("Sessão ativa como");
  });

  it("o botão abre a janela de login e revalida o status no fim", async () => {
    state.webLogin.mockImplementationOnce(async () => {
      state.status = { ...state.status, webSession: true, profile: "Maria" };
      return { ok: true };
    });
    const wrapper = await mountPanel();

    await wrapper.findAll("button").find((b) => b.text().trim() === "Fazer login no Canva")!.trigger("click");
    await flushPromises();

    expect(state.webLogin).toHaveBeenCalledTimes(1);
    /* Popup, não snackbar: o operador pediu para ser avisado do desfecho. */
    expect(state.message).toHaveBeenCalledWith(
      expect.stringContaining("Login realizado com sucesso")
    );
    expect(state.success).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Sessão ativa como Maria");
  });

  it("quando a conferência falha, o motivo aparece na tela", async () => {
    /* O operador fechou sem concluir, ou o Canva não o tirou do /login/. */
    state.webLogin.mockResolvedValueOnce({
      ok: false,
      code: "web_login_failed",
      message: "descartada: o código manda na i18n",
    });
    const wrapper = await mountPanel();

    await wrapper.findAll("button").find((b) => b.text().trim() === "Fazer login no Canva")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Não detectei a sessão do Canva — conclua o login na janela e tente de novo."
    );
    expect(wrapper.text()).toContain("Sem sessão — a projeção vai pedir login do Canva");
    expect(state.success).not.toHaveBeenCalled();
  });

  it("o botão fica travado enquanto a janela está aberta", async () => {
    let liberar!: () => void;
    state.webLogin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberar = () => resolve({ ok: true });
        })
    );
    const wrapper = await mountPanel();
    const botao = () => wrapper.findAll("button").find((b) => b.text().includes("login"));

    await botao()!.trigger("click");
    await nextTick();

    expect(botao()!.attributes("disabled")).toBeDefined();
    expect(botao()!.text()).toContain("Janela aberta");

    liberar();
    await flushPromises();
  });
});

describe("Integrações — identidade e instruções", () => {
  it("a logo do Canva vem antes do rótulo 'Credenciais do Canva'", async () => {
    const wrapper = await mountPanel();

    const rotulo = wrapper.find(".opt-row .opt-label");
    expect(rotulo.text()).toContain("Credenciais do Canva");

    const logo = rotulo.find("img.opt-canva-logo");
    expect(logo.exists()).toBe(true);
    expect(logo.attributes("src")).toContain("canva");
    expect(logo.attributes("alt")).toBe("Canva");
    /* Antes do texto: é o primeiro filho do rótulo. */
    expect(rotulo.element.firstElementChild).toBe(logo.element);
  });

  it("o rótulo é 'Credenciais do Canva'", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Credenciais do Canva");
    expect(wrapper.text()).not.toContain("Credenciais do aplicativo");
  });

  it("a Redirect URL está DENTRO de um CopyButton — o campo inteiro copia", async () => {
    const wrapper = await mountPanel();

    const copiar = wrapper.find("button.lj-copy-btn");
    expect(copiar.exists()).toBe(true);
    expect(copiar.find("code").text()).toContain("http://127.0.0.1:5530/auth/canva");
    /*
     * O `<code>` é filho do botão, não um irmão ao lado: é isso que faz o
     * clique no endereço copiar, em vez de precisar de um botão separado.
     */
    expect(copiar.find("code").element.parentElement).toBe(copiar.element);
    /* Fora do botão não pode sobrar nenhuma segunda cópia do endereço. */
    const solta = wrapper.findAll("code").filter((c) => !c.element.closest("button"));
    expect(solta).toEqual([]);
  });

  it("as instruções abrem num diálogo com o link do portal clicável", async () => {
    const wrapper = await mountPanel();
    expect(document.querySelector(".lj-dialog")).toBeNull();

    await wrapper
      .findAll("button")
      .find((b) => b.text().trim() === "Como configurar no portal")!
      .trigger("click");
    await flushPromises();

    /* Teleportado: o wrapper não o vê, o corpo sim. */
    const dialogo = document.querySelector(".lj-dialog");
    expect(dialogo).toBeTruthy();
    expect(dialogo!.textContent).toContain("Canva — configuração no portal");

    const link = dialogo!.querySelector<HTMLAnchorElement>(
      'a.canva-link[href="https://www.canva.com/developers/apps"]'
    );
    expect(link).toBeTruthy();
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toContain("noopener");
  });

  it("as instruções trazem o passo do login e a Redirect URL num CopyButton", async () => {
    const wrapper = await mountPanel();
    await wrapper
      .findAll("button")
      .find((b) => b.text().trim() === "Como configurar no portal")!
      .trigger("click");
    await flushPromises();

    const dialogo = document.querySelector(".lj-dialog");
    expect(dialogo).toBeTruthy();

    /* O login na sessão do site é o passo que faltava nas instruções. */
    expect(dialogo!.textContent).toContain("Fazer login no Canva");
    expect(dialogo!.textContent).toContain("a janela fecha sozinha");

    const dentro = dialogo!.querySelector<HTMLButtonElement>("button.lj-copy-btn");
    expect(dentro).toBeTruthy();
    expect(dentro!.querySelector("code")?.textContent).toContain("127.0.0.1:5530/auth/canva");
    expect(dentro!.querySelector("code")?.parentElement).toBe(dentro);
  });
});

describe("Integrações — sair do SITE do Canva", () => {
  beforeEach(() => {
    state.projectAs = "site";
  });

  const botaoSair = (w: Awaited<ReturnType<typeof mountPanel>>) =>
    w.findAll("button").find((b) => b.text().trim() === "Sair do Canva");

  it("fica travado enquanto não há sessão para sair", async () => {
    state.status = { ...state.status, webSession: false };
    const wrapper = await mountPanel();

    const sair = botaoSair(wrapper);
    expect(sair).toBeTruthy();
    expect(sair!.attributes("disabled")).toBeDefined();
  });

  it("com sessão ativa, o botão habilita ao lado do login", async () => {
    state.status = { ...state.status, webSession: true, profile: "Maria" };
    const wrapper = await mountPanel();

    const sair = botaoSair(wrapper);
    expect(sair).toBeTruthy();
    expect(sair!.attributes("disabled")).toBeUndefined();

    const labels = wrapper.findAll("button").map((b) => b.text().trim());
    const i = labels.indexOf("Fazer login no Canva");
    expect(i).toBeGreaterThan(-1);
    expect(labels[i + 1]).toBe("Sair do Canva");
  });

  it("só apaga depois que o operador confirma, e o selo desliga", async () => {
    state.status = { ...state.status, webSession: true, profile: "Maria" };
    state.webLogout.mockImplementationOnce(async () => {
      state.status = { ...state.status, webSession: false };
      return { ok: true, removidos: 4 };
    });
    const wrapper = await mountPanel();

    await botaoSair(wrapper)!.trigger("click");
    expect(state.webLogout).not.toHaveBeenCalled();

    const [, callback] = state.yesno.mock.calls[0] as [unknown, (_btn: string) => void];
    callback("yes");
    await flushPromises();

    expect(state.webLogout).toHaveBeenCalledTimes(1);
    expect(state.message).toHaveBeenCalledWith(
      expect.stringContaining("Sessão do Canva encerrada")
    );
    expect(wrapper.text()).toContain("Sem sessão — a projeção vai pedir login do Canva");
  });

  it("o aviso deixa claro que a API continua valendo", async () => {
    state.status = { ...state.status, webSession: true, profile: "Maria" };
    const wrapper = await mountPanel();

    await botaoSair(wrapper)!.trigger("click");

    expect(state.yesno).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("token da API continua valendo") }),
      expect.any(Function)
    );
  });

  it("falha do logout vira mensagem, não erro silencioso", async () => {
    state.status = { ...state.status, webSession: true, profile: "Maria" };
    state.webLogout.mockResolvedValueOnce({
      ok: false,
      code: "error",
      message: "Não consegui encerrar a sessão do Canva.",
    });
    const wrapper = await mountPanel();

    await botaoSair(wrapper)!.trigger("click");
    (state.yesno.mock.calls[0] as [unknown, (_b: string) => void])[1]("yes");
    await flushPromises();

    expect(wrapper.text()).toContain("Não consegui encerrar a sessão do Canva.");
    expect(wrapper.text()).toContain("Sessão ativa como Maria");
  });
});

describe("Integrações — 'Projetar como'", () => {
  it("PDF (default) esconde a linha de sessão: o design não usa cookie", async () => {
    state.projectAs = "pdf";
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Projetar como");
    expect(wrapper.text()).not.toContain("Sessão do Canva");
    expect(wrapper.text()).not.toContain("Fazer login no Canva");
  });

  it("'Projeção do Canva' traz a linha de sessão de volta", async () => {
    state.projectAs = "site";
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("Sessão do Canva (projeção)");
    expect(wrapper.text()).toContain("Fazer login no Canva");
  });

  it("cada opção deixa o título, o resumo e os detalhes à mostra", async () => {
    const wrapper = await mountPanel();
    /*
     * Existem DOIS grupos de rádio na tela (projeção e qualidade); este caso
     * fala só do "Projetar como".
     */
    const modos = wrapper
      .findAll(".canva-mode")
      .filter((m) => m.find('input[name="canva-project-as"]').exists());
    expect(modos).toHaveLength(2);

    const titulos = modos.map((m) => m.find(".canva-mode__title").text());
    expect(titulos).toEqual([
      expect.stringContaining("PDF"),
      expect.stringContaining("Projeção do Canva"),
    ]);

    /* Resumo (o que faz) + seção "Detalhes" (o que custa), em cada opção. */
    for (const modo of modos) {
      const [resumo, rotulo, detalhes] = modo.findAll(".canva-mode__hint");
      expect(resumo.text().trim().length).toBeGreaterThan(60);
      expect(rotulo.text()).not.toContain("components.ui");
      expect(detalhes.text().trim().length).toBeGreaterThan(60);
    }

    expect(modos[0].text()).toContain("tela cheia, setas, operador");
    expect(modos[1].text()).toContain("Exige fazer login do Canva");
  });

  it("trocar de modo grava a preferência", async () => {
    state.setUserData.mockClear();
    const wrapper = await mountPanel();

    const site = wrapper.find('input[name="canva-project-as"][value="site"]');
    expect(site.exists()).toBe(true);
    await site.setValue("site");

    expect(state.setUserData).toHaveBeenCalledWith(
      KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS,
      "site"
    );
  });
});

describe("Integrações — escopo faltando do export", () => {
  it("PDF + token sem o escopo: avisa ANTES do clique", async () => {
    state.projectAs = "pdf";
    state.status = { ...state.status, requiresReconnect: true };
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("design:content:read");
    expect(wrapper.text()).toContain("reconectar");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("sem o problema, nada de aviso", async () => {
    state.projectAs = "pdf";
    state.status = { ...state.status, requiresReconnect: false };
    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toContain("design:content:read");
  });

  it("no modo 'Projeção do Canva' o escopo de export não interessa", async () => {
    state.projectAs = "site";
    state.status = { ...state.status, requiresReconnect: true };
    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toContain("design:content:read");
  });
});

describe("Integrações — qualidade do export", () => {
  it("por padrão marca Regular — é o que funciona em qualquer conta", async () => {
    const wrapper = await mountPanel();

    const regular = wrapper.find('input[name="canva-export-quality"][value="regular"]');
    expect(regular.exists()).toBe(true);
    expect((regular.element as HTMLInputElement).checked).toBe(true);
  });

  it("só existe no modo PDF: no modo site não há export que escolher", async () => {
    state.projectAs = "site";
    const wrapper = await mountPanel();

    expect(wrapper.find('input[name="canva-export-quality"]').exists()).toBe(false);
  });

  it("trocar para Pro grava a preferência na chave certa", async () => {
    state.setUserData.mockClear();
    const wrapper = await mountPanel();

    await wrapper.find('input[name="canva-export-quality"][value="pro"]').setValue("pro");

    expect(state.setUserData).toHaveBeenCalledWith(
      KEYS.OPTIONS.INTEGRATIONS.CANVA.EXPORT_QUALITY,
      "pro"
    );
  });

  it("a preferência salva volta marcada", async () => {
    state.exportQuality = "pro";
    const wrapper = await mountPanel();

    const pro = wrapper.find('input[name="canva-export-quality"][value="pro"]');
    expect((pro.element as HTMLInputElement).checked).toBe(true);
    expect(
      (wrapper.find('input[name="canva-export-quality"][value="regular"]').element as HTMLInputElement)
        .checked
    ).toBe(false);
  });

  it("o hint explica o fallback — é o que evita susto no meio do culto", async () => {
    const wrapper = await mountPanel();

    const bloco = wrapper
      .find('input[name="canva-export-quality"]')
      .element.closest(".canva-block");
    expect(bloco?.textContent || "").toContain("Regular e avisa");
  });
});

describe("Integrações — telemetria", () => {
  const eventos = (nome: string) =>
    vi.mocked(Telemetry.track).mock.calls.filter(([evento]) => evento === nome);
  const props = (nome: string) => eventos(nome)[0]?.[1] as Record<string, unknown>;

  const clicar = (wrapper: Awaited<ReturnType<typeof mountPanel>>, rotulo: string) =>
    wrapper.findAll("button").find((b) => b.text().trim() === rotulo)!.trigger("click");

  beforeEach(() => vi.mocked(Telemetry.track).mockClear());

  it("trocar o modo de projeção registra de/para", async () => {
    const wrapper = await mountPanel();

    await wrapper.find('input[name="canva-project-as"][value="site"]').setValue("site");

    expect(props("canva_project_as_changed")).toEqual({ from: "pdf", to: "site" });
  });

  it("trocar a qualidade do export registra de/para", async () => {
    const wrapper = await mountPanel();

    await wrapper.find('input[name="canva-export-quality"][value="pro"]').setValue("pro");

    expect(props("canva_export_quality_changed")).toEqual({ from: "regular", to: "pro" });
  });

  it("salvar credenciais registra sucesso", async () => {
    const wrapper = await mountPanel();
    await wrapper.find("#canva-client-id").setValue("OC-1");
    await wrapper.find("#canva-client-secret").setValue("s");
    await clicar(wrapper, "Salvar credenciais");
    await flushPromises();

    expect(eventos("canva_credentials_saved")).toHaveLength(1);
    expect(eventos("canva_credentials_failed")).toHaveLength(0);
  });

  it("salvar credenciais falha com o CÓDIGO, nunca a mensagem", async () => {
    /* Montagem nova: o form some logo que as credenciais são gravadas. */
    state.setCredentials.mockResolvedValueOnce({ ok: false, code: "canva_401", message: "segredo" });
    const wrapper = await mountPanel();
    await wrapper.find("#canva-client-id").setValue("OC-1");
    await wrapper.find("#canva-client-secret").setValue("s");
    await clicar(wrapper, "Salvar credenciais");
    await flushPromises();

    expect(props("canva_credentials_failed")).toEqual({ reason: "canva_401" });
    expect(JSON.stringify(props("canva_credentials_failed"))).not.toContain("segredo");
  });

  it("conectar registra o sucesso", async () => {
    state.status = { ...state.status, hasCredentials: true };
    const wrapper = await mountPanel();
    await clicar(wrapper, "Conectar");
    await flushPromises();

    expect(eventos("canva_connected")).toHaveLength(1);
    expect(eventos("canva_connect_failed")).toHaveLength(0);
  });

  it("conectar falho registra o CÓDIGO, nunca a mensagem", async () => {
    state.status = { ...state.status, hasCredentials: true };
    state.connect.mockResolvedValueOnce({ ok: false, code: "canva_429", message: "https://segredo" });
    const wrapper = await mountPanel();
    await clicar(wrapper, "Conectar");
    await flushPromises();

    expect(props("canva_connect_failed")).toEqual({ reason: "canva_429" });
    expect(JSON.stringify(props("canva_connect_failed"))).not.toContain("segredo");
  });

  it("desconectar registra a saída", async () => {
    state.status = { ...state.status, connected: true, hasCredentials: true };
    state.yesno.mockImplementation((_opcoes: unknown, cb: (_b: string) => void) => cb("yes"));
    const wrapper = await mountPanel();

    await clicar(wrapper, "Desconectar");
    await flushPromises();

    expect(eventos("canva_disconnected")).toHaveLength(1);
  });

  it("login no site registra o sucesso", async () => {
    /* O login do SITE só aparece no modo "Projeção do Canva". */
    state.projectAs = "site";
    const wrapper = await mountPanel();
    await clicar(wrapper, "Fazer login no Canva");
    await flushPromises();

    expect(eventos("canva_web_login_succeeded")).toHaveLength(1);
    expect(eventos("canva_web_login_failed")).toHaveLength(0);
  });

  it("login falho registra o CÓDIGO, nunca a mensagem", async () => {
    state.projectAs = "site";
    state.webLogin.mockResolvedValueOnce({ ok: false, code: "web_login_failed", message: "segredo" });
    const wrapper = await mountPanel();
    await clicar(wrapper, "Fazer login no Canva");
    await flushPromises();

    expect(props("canva_web_login_failed")).toEqual({ reason: "web_login_failed" });
    expect(JSON.stringify(props("canva_web_login_failed"))).not.toContain("segredo");
  });

  it("token sem o escopo avisa uma vez por transição, não a cada refresh", async () => {
    state.status = { ...state.status, hasCredentials: true, requiresReconnect: true };
    const wrapper = await mountPanel();

    /* Transição indefinido → true. */
    expect(eventos("canva_scope_missing")).toHaveLength(1);

    /* `Conectar` chama `refresh` de novo — e NÃO repete o evento. */
    await clicar(wrapper, "Conectar");
    await flushPromises();
    expect(eventos("canva_scope_missing")).toHaveLength(1);
  });
});
