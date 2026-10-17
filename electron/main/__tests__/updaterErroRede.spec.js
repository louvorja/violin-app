// @vitest-environment node
/**
 * Erro de rede na verificação de atualização vira CATEGORIA, nunca texto cru.
 *
 * O operador lia `getaddrinfo ENOTFOUND api.github.com` em Opções → Procurar
 * atualizações: o `Error` do Node entrava direto em `_state.error` e a tela o
 * exibia. Aqui o main só classifica (`network` | `http` | `unknown`), guarda o
 * detalhe para diagnóstico e devolve a categoria — o texto é do renderer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import Module from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const updaterPath = require.resolve("../updater.js");

const netHealth = {
  report: vi.fn(),
  status: vi.fn(() => true),
  onChange: vi.fn(() => () => {}),
};

/** Resposta que o `https` stubado entrega; `erro` faz ele emitir `error`. */
let resposta = { status: 200, corpo: "[]" };
let erro = null;
let netReset = () => {};

class Req extends EventEmitter {
  /**
   * `https.get(url, opts, callback)`: o callback precisa ser CHAMADO — é ele que
   * liga os ouvintes de `data`/`end`. Um stub que só devolve o request e emite
   * `response` por conta própria deixa a requisição pendurada para sempre.
   */
  constructor(_url, _opts, callback) {
    super();
    setImmediate(() => {
      if (erro) return this.emit("error", erro);
      const res = new EventEmitter();
      res.statusCode = resposta.status;
      res.headers = resposta.headers || {};
      res.resume = () => {};
      callback(res);
      res.emit("data", Buffer.from(resposta.corpo || ""));
      res.emit("end");
    });
  }
  destroy() {}
  setTimeout() {}
}

/*
 * O loader original é capturado UMA vez: se cada `carregarUpdater` capturasse o
 * stub anterior, a segunda chamada enveloparia a primeira e a recursão estouraria
 * a pilha. */
const ORIGINAL_LOAD = Module._load;

function carregarUpdater() {
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => "2.0.0" } };
    if (request === "electron-updater") {
      return { autoUpdater: { on: vi.fn(), isUpdaterActive: () => false } };
    }
    if (request === "https" || request === "http") {
      /* Os três argumentos vão adiante: o callback de resposta é quem liga os
         ouvintes de `data`/`end`. */
      return { get: (url, opts, cb) => new Req(url, opts, cb) };
    }
    if (request === "./netHealth.js") return netHealth;
    if (request === "fs-extra") return {};
    return ORIGINAL_LOAD.call(this, request, ...args);
  };
  delete require.cache[updaterPath];
  const updater = require(updaterPath);
  netReset = updater.__resetNetHealthForTests || netReset;
  return updater;
}

beforeEach(() => {
  resposta = { status: 200, corpo: "[]" };
  erro = null;
  netHealth.report.mockClear();
});

afterEach(() => {
  Module._load = ORIGINAL_LOAD;
  delete require.cache[updaterPath];
  vi.restoreAllMocks();
});

describe("verificação sem rede", () => {
  it("ENOTFOUND vira categoria network e o texto cru não vaza para o estado", async () => {
    const updater = carregarUpdater();
    erro = Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND" });

    const res = await updater.checkForUpdates();

    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("network");

    const st = updater.status();
    /* `error` é o campo que a tela exibia cru — agora fica vazio. */
    expect(st.error).toBeNull();
    expect(st.status).toBe("error");
    /* O detalhe continua, para diagnóstico, e ninguém o exibe. */
    expect(String(st.errorDetail)).toContain("getaddrinfo");
  });

  it("avisa o netHealth que a rede caiu", async () => {
    const updater = carregarUpdater();
    erro = Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND" });

    await updater.checkForUpdates();

    expect(netHealth.report).toHaveBeenCalledWith(false, "updater");
  });

  it("cada falha de socket é reconhecida como rede", async () => {
    const casos = [
      ["ECONNREFUSED", "connect ECONNREFUSED 140.82.121.6:443"],
      ["ETIMEDOUT", "socket hang up"],
      ["EAI_AGAIN", "getaddrinfo EAI_AGAIN api.github.com"],
      ["ENETUNREACH", "connect ENETUNREACH 10.0.0.1:443"],
    ];
    for (const [code, mensagem] of casos) {
      const updater = carregarUpdater();
      erro = Object.assign(new Error(mensagem), { code });
      const res = await updater.checkForUpdates();
      expect(res.errorKind, `code=${code}`).toBe("network");
    }
  });
});

describe("erro que não é de rede", () => {
  it("HTTP 500 é categoria http, e a rede é considerada de pé", async () => {
    const updater = carregarUpdater();
    resposta = { status: 500, corpo: "erro" };

    const res = await updater.checkForUpdates();

    expect(res.errorKind).toBe("http");
    /* O servidor respondeu: há rede, o serviço é que não atendeu. */
    expect(netHealth.report).toHaveBeenCalledWith(true, "updater");
  });

  it("resposta que não é JSON cai em unknown, sem virar texto de tela", async () => {
    const updater = carregarUpdater();
    resposta = { status: 200, corpo: "<html>não sou json</html>" };

    const res = await updater.checkForUpdates();

    expect(res.errorKind).toBe("unknown");
    expect(updater.status().error).toBeNull();
  });
});

describe("verificação que dá certo", () => {
  it("uma resposta do GitHub confere a rede", async () => {
    const updater = carregarUpdater();
    resposta = {
      status: 200,
      corpo: JSON.stringify([
        { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [] },
      ]),
    };

    const res = await updater.checkForUpdates();

    expect(res.ok).toBe(true);
    expect(netHealth.report).toHaveBeenCalledWith(true, "updater");
    expect(updater.status().status).not.toBe("error");
  });
});