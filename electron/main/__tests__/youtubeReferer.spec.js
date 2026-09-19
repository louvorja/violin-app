// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { install, precisaDeReferer, identidadeDe, YOUTUBE_URLS } = require("../youtubeReferer.js");

/**
 * Sem Referer http(s) o player do YouTube recusa o embed com o erro 153, e a
 * origem louvorja:// não envia um. O experimento que fixou a causa rodou o
 * mesmo vídeo em três origens: só `louvorja://` sem o cabeçalho falhava.
 */
function ouvinteInstalado(homepage) {
  let ouvinte;
  const ses = {
    webRequest: {
      onBeforeSendHeaders: vi.fn((filtro, fn) => {
        ouvinte = { filtro, fn };
      }),
    },
  };
  install(ses, homepage);
  return ouvinte;
}

function enviar(ouvinte, requestHeaders) {
  let saida;
  ouvinte.fn({ requestHeaders }, (r) => {
    saida = r.requestHeaders;
  });
  return saida;
}

describe("precisaDeReferer", () => {
  it("pede quando falta ou não é http(s)", () => {
    expect(precisaDeReferer(undefined)).toBe(true);
    expect(precisaDeReferer("")).toBe(true);
    expect(precisaDeReferer("louvorja://app/")).toBe(true);
    expect(precisaDeReferer("file:///x/index.html")).toBe(true);
  });

  it("aceita o que o navegador já enviou em http(s)", () => {
    expect(precisaDeReferer("https://louvorja.com.br/")).toBe(false);
    expect(precisaDeReferer("http://localhost:5002/")).toBe(false);
  });
});

describe("identidadeDe", () => {
  it("usa a origem do site do app, com barra final", () => {
    expect(identidadeDe("https://louvorja.com.br/qualquer/caminho")).toBe("https://louvorja.com.br/");
  });

  it("cai para o site padrão quando o valor não é uma URL", () => {
    expect(identidadeDe(undefined)).toBe("https://louvorja.com.br/");
    expect(identidadeDe("nao é url")).toBe("https://louvorja.com.br/");
  });
});

describe("install", () => {
  it("filtra só as requisições do YouTube", () => {
    const ouvinte = ouvinteInstalado("https://louvorja.com.br");
    expect(ouvinte.filtro).toEqual({ urls: YOUTUBE_URLS });
  });

  it("acrescenta o Referer quando a requisição não tem nenhum", () => {
    const ouvinte = ouvinteInstalado("https://louvorja.com.br");
    expect(enviar(ouvinte, { "User-Agent": "x" })).toEqual({
      "User-Agent": "x",
      Referer: "https://louvorja.com.br/",
    });
  });

  it("troca um Referer louvorja:// e respeita a caixa do nome do cabeçalho", () => {
    const ouvinte = ouvinteInstalado("https://louvorja.com.br");
    expect(enviar(ouvinte, { referer: "louvorja://app/" })).toEqual({
      referer: "https://louvorja.com.br/",
    });
  });

  it("não mexe num Referer http(s) que já veio", () => {
    const ouvinte = ouvinteInstalado("https://louvorja.com.br");
    expect(enviar(ouvinte, { Referer: "http://localhost:5002/" })).toEqual({
      Referer: "http://localhost:5002/",
    });
  });
});
