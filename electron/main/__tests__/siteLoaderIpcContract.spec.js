// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Contrato do loader de projeção de Site.
 *
 * São quatro pontas que precisam bater: o que o preload invoca e escuta, o que
 * o main atende e envia, e as features que a factory precisa conhecer. Se uma
 * delas divergir, o loader não some (tela presa na frente da congregação) ou
 * nunca aparece (página chegando no telão) — e os testes de componente
 * continuariam verdes, porque cada ponta isolada funciona.
 */
const arquivo = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PRELOAD = fs.readFileSync(arquivo("../../preload.cjs"), "utf8");
const MAIN = fs.readFileSync(arquivo("../../main.cjs"), "utf8");
const FACTORY = fs.readFileSync(arquivo("../windowFactory.js"), "utf8");
const RENDERER = fs.readFileSync(arquivo("../../../src/helpers/ProjectionWindows.ts"), "utf8");
const SITE_LOADER_VIEW = fs.readFileSync(arquivo("../../../src/views/SiteLoader.vue"), "utf8");

const canaisDe = (source, regex) =>
  [...new Set([...source.matchAll(regex)].map((m) => m[1]))].sort();

describe("Loader de projeção de Site — contrato", () => {
  it("o preload invoca um canal que o main atende, e escuta um que o main envia", () => {
    expect(canaisDe(PRELOAD, /"site-loader:([A-Za-z]+)"/g)).toEqual(["aguardar", "pronto"]);
    expect(canaisDe(MAIN, /ipcMain\.handle\("site-loader:([A-Za-z]+)"/g)).toEqual(["aguardar"]);
    expect(canaisDe(MAIN, /safeSend\([^,]+, "site-loader:([A-Za-z]+)"/g)).toEqual(["pronto"]);
  });

  it("a seção siteLoader do preload expõe exatamente aguardar e onPronto", () => {
    const bloco = PRELOAD.match(/\n  siteLoader: \{[\s\S]*?\n  \},/);
    expect(bloco).toBeTruthy();

    const metodos = [...bloco[0].matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]).sort();
    expect(metodos).toEqual(["aguardar", "onPronto"]);
  });

  it("o handler fica no nível do módulo, fora de condição de plataforma", () => {
    expect(MAIN).toMatch(/^ipcMain\.handle\("site-loader:aguardar"/m);
  });

  it("o main registra o gancho de prontidão, e a factory o exporta", () => {
    expect(MAIN).toContain("windowFactory.setSiteReadyListener(");

    const exportados = FACTORY.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/)?.[1] || "";
    expect(exportados).toContain("setSiteReadyListener");
    expect(exportados).toContain("willLoad");
  });

  it("o main só trata uma janela como pronta se ela NÃO vai (re)carregar", () => {
    /*
     * Uma recarga tratada como "já pronta" fecha o loader na hora — que é
     * exatamente o sintoma de "o loader nunca apareceu".
     */
    expect(MAIN).toContain("windowFactory.willLoad(options.feature, options.route)");
    expect(MAIN).not.toContain("!windowFactory.getWindow(options.feature)) {\n    _siteProntas");
  });

  it("a factory trata as duas features de loader (z-order e níveis de topo)", () => {
    expect(FACTORY).toContain('const SITE_LOADER_FEATURES = ["site_loader", "site_loader_return"]');
    /* O renderer precisa abrir as MESMAS duas que a factory protege. */
    expect(RENDERER).toContain("PROJECTION_TYPE.SITE_LOADER");
    expect(RENDERER).toContain("PROJECTION_TYPE.SITE_LOADER_RETURN");
  });

  it("há timeout de segurança e fechamento — um loader que não sai prende a tela", () => {
    expect(MAIN).toMatch(/const LOADER_TIMEOUT_MS = 20000/);
    expect(MAIN).toMatch(/const LOADER_FECHAR_MS = 550/);
    expect(MAIN).toContain("${LOADER_TIMEOUT_MS}");
  });

  it("o renderer só avisa o main DEPOIS de abrir todas as janelas", () => {
    /*
     * Se `aguardar` viesse antes, o main estaria adivinhando quais janelas
     * esperar — e adivinha errado quando a de retorno nem existe.
     */
    const abrir = RENDERER.indexOf("await _abrirLoaderSite(");
    const abrirSite = RENDERER.indexOf("await _open(url, PROJECTION_TYPE.SITE,");
    const aguardar = RENDERER.indexOf("await _aguardarLoadersSite()");
    expect(abrir).toBeGreaterThan(-1);
    expect(abrirSite).toBeGreaterThan(abrir);
    expect(aguardar).toBeGreaterThan(abrirSite);
  });
});

  it("o `pronto` carrega o resultado da apresentação — e o loader o registra", () => {
    /*
     * Abrir a janela não garante nada: o design pode ficar no VIEWER sem
     * nunca virar apresentação. Esse número é o único que diz se o modo Site
     * FUNCIONOU, e ele precisa atravessar o payload até quem envia o evento.
     */
    expect(MAIN).toContain("const _apresentacao = new Map()");
    expect(MAIN).toContain("apresentou: pronto ? _resumoApresentacao() : null");
    /* Ciclo novo zera o resultado — senão o anterior contaminaria o próximo. */
    expect(MAIN).toContain("_apresentacao.delete(options.feature);");

    expect(SITE_LOADER_VIEW).toContain("canva_site_presented");
    expect(SITE_LOADER_VIEW).toContain("apresentou");
    /* Liturgia não tem gesto: `null` não vira evento de Canva. */
    expect(SITE_LOADER_VIEW).toContain("if (apresentou === null) return;");
  });
