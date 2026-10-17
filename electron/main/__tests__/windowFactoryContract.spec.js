// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Liga o `main.cjs` ao `module.exports` da factory.
 *
 * Nenhum teste unitário carrega os dois: um export que some passa em TODO o
 * `npm test` e só estoura quando o app abre — foi exatamente isso que
 * `windowFactory.setOperationMeasurer is not a function` apontou no boot.
 * Aqui a ligação é feita pelo texto, que é o que não depende de Electron.
 */
const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MAIN = ler("../../main.cjs");
const FACTORY = ler("../windowFactory.js");

const blocoExports = FACTORY.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
const exportados = blocoExports
  ? [...blocoExports[1].matchAll(/^\s*([A-Za-z0-9_]+),\s*$/gm)].map((m) => m[1])
  : [];

/*
 * Propriedade acessada em qualquer lugar do main — com ou sem chamada.
 * Sai antes o que é referência de caminho e o que é comentário: sem isso o
 * `.js` de `require("./main/windowFactory.js")` e de `// (windowFactory.js)`
 * viram uma propriedade inventada e um falso "faltando".
 */
const SEM_RUIDO = MAIN
  .replace(/require\([^)]*\)/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const usados = [
  ...new Set([...SEM_RUIDO.matchAll(/windowFactory\.([A-Za-z0-9_]+)/g)].map((m) => m[1])),
];

describe("windowFactory: o que o main acessa existe na factory", () => {
  it("leu as duas pontas de verdade", () => {
    expect(exportados.length).toBeGreaterThan(5);
    expect(usados.length).toBeGreaterThan(0);
    /* Sanidade: o regex achou o objeto certo, não um comentário. */
    expect(exportados).toContain("openOnMonitor");
  });

  it("toda propriedade windowFactory.X usada no main está exportada", () => {
    expect(usados.filter((nome) => !exportados.includes(nome))).toEqual([]);
  });

  it("cobre o caso que derrubou o boot", () => {
    expect(usados).toContain("setOperationMeasurer");
    expect(exportados).toContain("setOperationMeasurer");
    expect(exportados).toContain("setSiteNavigationListener");
  });
});

/**
 * Ordem de abertura da projeção de Site.
 *
 * O bug: a ordem de CRIAÇÃO estava certa (loader antes da janela externa), mas
 * a de APARECER dependia de cada janela pintar — e a SPA do app pode pintar
 * DEPOIS da página do Canva, que aí aparecia sozinha por alguns milissegundos.
 * Estas três travas transformam a ordem de corrida em garantia:
 *   1. o loader mostra DURANTE a criação, antes de qualquer carga;
 *   2. a janela externa devolve os loaders ao topo no MESMO turno do show;
 *   3. reuso com outra rota recarrega — senão a tela mostrava o design ANTIGO.
 */
describe("windowFactory — ordem de abertura da projeção de Site", () => {
  const idx = (trecho) => FACTORY.indexOf(trecho);

  it("o loader é mostrado na CRIAÇÃO, antes de carregar qualquer coisa", () => {
    const mostrar = idx("if (SITE_LOADER_FEATURES.includes(feature)) showOnce();");
    const carregar = idx("win.loadURL(loadTarget.url);");

    expect(mostrar, "chamada direta ao showOnce para as features de loader").toBeGreaterThan(-1);
    expect(carregar).toBeGreaterThan(-1);
    /* Antes de `loadURL` e, como está dentro de `_openOnMonitor`, antes do
       `return` — ou seja, quando a `windows:open` devolve, já está visível. */
    /*
     * `loadURL` é a última coisa que `_openOnMonitor` faz antes do `return`:
     * estar antes dele significa "dentro da criação" — e a chamada é direta
     * (`showOnce();`, não `…, showOnce`), não registrada num listener que só
     * dispararia quando a página terminasse de carregar.
     */
    expect(mostrar).toBeLessThan(carregar);
    expect(FACTORY.slice(mostrar, carregar)).not.toContain("did-finish-load");
    expect(FACTORY.slice(mostrar, carregar)).not.toContain("ready-to-show");
  });

  it("a janela externa devolve os loaders ao topo junto com o próprio show", () => {
    const mostrou = FACTORY.indexOf("() => win.showInactive()");
    const topo = FACTORY.indexOf("if (isExternal) _trazerLoadersAoTopo();");

    expect(mostrou).toBeGreaterThan(-1);
    expect(topo).toBeGreaterThan(-1);
    /* Síncrono, logo após mostrar — esperar o evento `show` dava quadros do
       Canva por cima antes do empurrão chegar. */
    expect(topo).toBeGreaterThan(mostrou);
    expect(FACTORY.indexOf("win.on(\"show\", () => _trazerLoadersAoTopo());")).toBeGreaterThan(topo);
  });

  it("reuso com OUTRA rota recarrega — a tela nunca fica no design antigo", () => {
    const reuso = idx("const existing = _openWindows.get(feature);");
    const recarga = idx("_garantirRota(feature, route, { devUrl, prodHtmlPath });");

    expect(reuso).toBeGreaterThan(-1);
    expect(recarga).toBeGreaterThan(-1);
    /* Navega antes de mostrar, dentro do ramo de reuso. */
    expect(recarga).toBeGreaterThan(reuso);
    expect(recarga).toBeLessThan(idx("existing.showInactive()"));

    /* E a comparação é pela rota guardada, não pela URL do documento. */
    const corpo = FACTORY.slice(
      FACTORY.indexOf("function _garantirRota("),
      FACTORY.indexOf("function willLoad(")
    );
    expect(corpo).toContain("meta.route === route");
    expect(corpo).toContain("win.loadURL(target.url)");
    expect(corpo).toContain("meta.route = route");
  });

  it("willLoad distingue criação, recarga e reuso-e-mesma-rota", () => {
    const corpo = FACTORY.slice(
      FACTORY.indexOf("function willLoad("),
      FACTORY.indexOf("function _openOnMonitor(")
    );

    /* Sem janela (ou destruída) → vai carregar. */
    expect(corpo).toMatch(/if \(!win \|\| win\.isDestroyed\(\)\) return true;/);
    /* Janela viva com a MESMA rota → não carrega: tratar isso como pendente
       fecharia o loader só no timeout de 20 s. */
    expect(corpo).toContain("return !meta || meta.route !== route;");

    expect(exportados).toContain("willLoad");
  });
});
