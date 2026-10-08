// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Contrato de IPC do Canva.
 *
 * Os testes da fachada exercitam `canva/index.js` direto e passariam redondos
 * com um canal renomeado no preload ou um handler esquecido dentro de uma
 * condição no `main.cjs` — aí o renderer veria "No handler registered" e a
 * tela de Integrações só mostraria um erro genérico. Aqui as três pontas são
 * ligadas: o que o preload invoca, o que o main atende e o que a fachada
 * expõe.
 */
const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PRELOAD = fs.readFileSync(file("../../preload.cjs"), "utf8");
const MAIN = fs.readFileSync(file("../../main.cjs"), "utf8");

/** Sufícios expostos em `louvorjaApi.canva`. */
const FUNCOES = [
  "connect",
  "designUrl",
  "disconnect",
  "exportPdf",
  "items",
  "setCredentials",
  "status",
  "webLogin",
  "webLogout",
];

const canaisDe = (source, regex) =>
  [...new Set([...source.matchAll(regex)].map((m) => m[1]))].sort();

describe("Canva: contrato de IPC", () => {
  it("todo canal invocado pelo preload tem handler no main, e o contrário também", () => {
    const invocados = canaisDe(PRELOAD, /"canva:([A-Za-z]+)"/g);
    const atendidos = canaisDe(MAIN, /ipcMain\.handle\("canva:([A-Za-z]+)"/g);

    expect(invocados).toEqual(FUNCOES.slice().sort());
    expect(atendidos).toEqual(invocados);
  });

  it("a seção canva do preload expõe exatamente as funções esperadas", () => {
    /* Só o bloco `canva:` — sem isso qualquer outro invoke com "canva:" contaminaria. */
    const bloco = PRELOAD.match(/\n  canva: \{[\s\S]*?\n  \},/);
    expect(bloco).toBeTruthy();

    const metodos = [...bloco[0].matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]).sort();
    /* `onLoginWall` é evento (`.on`), não invoke — por isso fora de FUNCOES. */
    expect(metodos).toEqual([...FUNCOES, "onLoginWall"].sort());
  });

  it("os handlers ficam no nível do módulo, fora de condição de plataforma", () => {
    /* Dentro de um if (platform…) sumiriam no outro SO sem ninguém notar. */
    expect(MAIN).toMatch(/^ipcMain\.handle\("canva:status"/m);
    expect(MAIN).toMatch(/^canva\.configure\(\{/m);
    expect(MAIN).toMatch(/^ipcMain\.handle\("canva:designUrl"/m);
  });

  it("canva:connect não repassa payload nenhum vindo do renderer", () => {
    /*
     * Porta e redirectUri têm que ser as do portal, sempre as do main: se o
     * renderer pudesse mandar `port`, o redirect_uri da abertura (constante)
     * e o do bind (do argumento) divergiriam e o Canva recusaria a troca.
     */
    const trecho = MAIN.match(/ipcMain\.handle\("canva:connect",[\s\S]*?\n\);/);
    expect(trecho).toBeTruthy();
    expect(trecho[0]).toContain("openExternal");
    expect(trecho[0]).not.toMatch(/payload|_event|args/);
  });

  it("a parede de login da projeção está ligada: factory → main → preload", () => {
    /*
     * Três pontas do mesmo fato. A factory só reporta navegação (ela não pode
     * conhecer o Canva); o main decide e zera o selo; o preload entrega ao
     * renderer. Uma renomeada e ninguém ficaria sabendo que o aviso sumiu.
     */
    expect(MAIN).toContain("windowFactory.setSiteNavigationListener(");
    expect(MAIN).toContain("ehPaginaDeLogin(url)");
    expect(MAIN).toContain("canva.setWebSession(false)");
    expect(MAIN).toContain('"site:login-wall"');

    expect(PRELOAD).toContain("onLoginWall:");
    expect(PRELOAD).toContain('ipcRenderer.on("site:login-wall"');
    expect(PRELOAD).toContain('ipcRenderer.off("site:login-wall"');
  });

  it("página do Canva pronta dispara o clique de apresentação", () => {
    /*
     * O `view_url` abre a visualização; sem este passo o operador precisa
     * achar "Apresentar em tela cheia" em toda projeção. Só canva.com — clicar
     * em link de liturgia aleatório seria um surto.
     */
    expect(MAIN).toContain("windowFactory.setSiteReadyListener(");
    expect(MAIN).toContain("hostCanva(url)");
    expect(MAIN).toContain("canva.tentarApresentar(win)");
    expect(MAIN).toContain("hostCanva");
  });
});
