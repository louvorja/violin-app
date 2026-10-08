// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/*
 * `electron` fora do Electron devolve o caminho do binário: `BrowserWindow`
 * fica indefinido. É o que este teste quer — as funções recusam em vez de
 * estourar, e a lógica de "onde o Canva nos manda" vive em `ehPaginaDeLogin`
 * (testado em windowRoute.spec.js), puro e sem janela.
 */
const webSession = require("../canva/webSession.js");
const { SITE_PARTITION, ehPaginaDeLogin } = require("../windowRoute.js");

describe("sessão do Canva: de onde ela vem", () => {
  it("usa a MESMA partição da projeção — é o que faz os cookies valerem no telão", () => {
    expect(webSession.SITE_PARTITION).toBe(SITE_PARTITION);
    expect(SITE_PARTITION).toBe("persist:lj-site");
  });

  it("aponta para o login com a barra final: /login responde 301 → /login/", () => {
    expect(webSession.LOGIN_URL).toBe("https://www.canva.com/login/");
  });

  it("a janela de login recebe a mesma receita de segurança da janela externa", () => {
    const prefs = webSession.webPreferences();
    expect(prefs.partition).toBe(SITE_PARTITION);
    expect(prefs.sandbox).toBe(true);
    /* Site de terceiro: `louvorjaApi` não tem gate de origem. */
    expect(prefs.preload).toBeUndefined();
  });
});

describe("fora do Electron", () => {
  it("abrirLogin recusa com erro legível", async () => {
    await expect(webSession.abrirLogin()).rejects.toThrow(/indisponível/i);
  });

  it("verificar responde 'unavailable' em vez de lançar", async () => {
    await expect(webSession.verificar()).resolves.toEqual({
      ok: false,
      code: "unavailable",
    });
  });
});

describe("a conferência é por redirecionamento, não por cookie", () => {
  it("decide só pela URL onde o Canva deixou", () => {
    /*
     * O que o `verificar()` lê depois do settle é isto. O ponto não é a
     * quantidade de cookies: a home anônima do Canva já grava CDI, CL e
     * _cfuvid, e a versão anterior contava isso como sessão ativa.
     */
    expect(ehPaginaDeLogin("https://www.canva.com/login/")).toBe(true);
    expect(ehPaginaDeLogin("https://www.canva.com/")).toBe(false);
    expect(ehPaginaDeLogin("https://www.canva.com/projects")).toBe(false);
  });
});

describe("decidir — quando a janela de login fecha", () => {
  const LOGIN = "https://www.canva.com/login/";
  const CASA = "https://www.canva.com/";

  it("ainda na tela de login: deixa o operador digitar", () => {
    expect(webSession.decidir({ viuLogin: false }, LOGIN).acao).toBe("esperar");
    expect(webSession.decidir({ viuLogin: true, desafiando: true }, LOGIN)).toEqual({
      acao: "esperar",
      viuLogin: true,
      desafiando: false,
    });
  });

  it("nunca vimos a tela de login e saímos dela: PROVA, não adivinha", () => {
    /*
     * Regressão da janela que fechou sozinha antes de o operador digitar: o
     * Canva tirou o navegador do `/login` e o código anterior tratou isso como
     * "já logado". Aqui vira `provar` — o desafio decide.
     */
    expect(webSession.decidir({ viuLogin: false }, CASA)).toEqual({ acao: "provar" });
  });

  it("conferência já em andamento não abre outra", () => {
    expect(webSession.decidir({ viuLogin: false, provando: true }, CASA).acao).toBe("esperar");
  });

  it("viu o login e saiu dele: manda o desafio", () => {
    expect(webSession.decidir({ viuLogin: true }, CASA)).toEqual({ acao: "desafiar" });
  });

  it("o desafio nos tirou do login de novo: confirmado", () => {
    expect(webSession.decidir({ viuLogin: true, desafiando: true }, CASA).acao).toBe("sucesso");
  });

  it("fluxo completo: login → casa → desafio → casa", () => {
    let estado = webSession.decidir({}, LOGIN);
    expect(estado).toEqual({ acao: "esperar", viuLogin: true, desafiando: false });

    const fora = { ...estado, acao: undefined };
    const d2 = webSession.decidir({ viuLogin: true }, CASA);
    expect(d2.acao).toBe("desafiar");

    const d3 = webSession.decidir({ viuLogin: true, desafiando: true }, CASA);
    expect(d3.acao).toBe("sucesso");
    expect(fora.viuLogin).toBe(true);
  });

  it("navegação fora do Canva não dispara nada — é o hop do Google", () => {
    /*
     * "Continue with Google" leva a accounts.google.com. Se `decidir` agisse aí
     * como se fosse o Canva, mandaríamos o navegador de volta para /login no
     * meio do login de terceiros.
     */
    for (const url of ["https://accounts.google.com/signin", "https://exemplo.com/"]) {
      expect(webSession.decidir({ viuLogin: true, desafiando: true }, url).acao).toBe("esperar");
      expect(webSession.decidir({ viuLogin: false }, url).acao).toBe("esperar");
    }
    /* Voltou para o Canva: o fluxo continua de onde parou. */
    expect(webSession.decidir({ viuLogin: true }, "https://www.canva.com/").acao).toBe("desafiar");
    expect(webSession.decidir({}, "https://www.canva.com/login/").acao).toBe("esperar");
  });
});
