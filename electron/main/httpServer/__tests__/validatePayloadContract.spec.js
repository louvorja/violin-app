// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");
const { RendererRequestRegistry, RENDERER_RESPONSE_CHANNEL } = require("../rendererRequestRegistry.js");

/**
 * Ponte spec → `RendererRequestRegistry` REAL.
 *
 * Os demais specs de rota usam um `rendererRequests` falso cuja promise
 * resolve direto — neles o `validatePayload` nunca roda. Foi assim que um
 * validator referenciando `isPlainObject` fora de escopo passou nos testes e
 * só estourou em produção (ReferenceError no popup do Electron a cada
 * `play-default`, com o POST pendurado). Aqui o registry é o de verdade:
 * o "renderer" simulado responde pela porta real (`RENDERER_RESPONSE_CHANNEL`)
 * e qualquer ReferenceError/contrato violado aparece como falha do teste.
 */
const UUID = "00000000-0000-4000-8000-000000000009";

const handlers = { get: new Map(), post: new Map() };

/** O que o "renderer" devolve para o próximo request (controlado por teste). */
let nextResponse = { status: "ok" };

let listener = null;

function response() {
  return {
    code: 200,
    body: undefined,
    headers: {},
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status(code) {
      this.code = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    send(body) {
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    on() {},
    once() {},
    off() {},
  };
}

async function callGet(route, query) {
  const res = response();
  await handlers.get.get(route)({ query, headers: {} }, res);
  return res;
}

async function callPost(route, body) {
  const res = response();
  await handlers.post.get(route)({ body, headers: {} }, res);
  return res;
}

const STATE = {
  status: "ok",
  playing: false,
  volume: 50,
  currentId: null,
  files: [],
  categories: [],
};

beforeEach(() => {
  nextResponse = { status: "ok" };
  listener = null;

  const sender = {
    isDestroyed: () => false,
    send: (channel, payload) => {
      // Renderer simulado: responde imediatamente pela porta real do registry.
      if (channel !== "http:background-sound" || !payload?.requestId || !listener) return;
      listener({ sender }, { requestId: payload.requestId, payload: nextResponse });
    },
  };
  const mainWindow = { isDestroyed: () => false, webContents: sender };

  const ipc = { on: vi.fn(), off: vi.fn() };
  const registry = new RendererRequestRegistry({ getMainWindow: () => mainWindow });
  registry.attach(ipc);
  listener = ipc.on.mock.calls[0][1];

  setupRoutes(
    {
      get(route, handler) {
        handlers.get.set(route, handler);
      },
      post(route, handler) {
        handlers.post.set(route, handler);
      },
    },
    {
      getMainWindow: () => mainWindow,
      getUserData: () => ({}),
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      rendererRequests: registry,
    }
  );
});

describe("validatePayload no registry real", () => {
  it("play-default com resposta ok → 200 (o contrato isPlainObject roda de verdade)", async () => {
    nextResponse = { status: "ok" };

    const res = await callPost("/api/background-sound", { action: "play-default" });

    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "ok", action: "play-default" });
  });

  it("play-default sem som padrão → 404 com a mensagem do renderer", async () => {
    nextResponse = { status: "error", error: "Nenhum som padrão configurado" };

    const res = await callPost("/api/background-sound", { action: "play-default" });

    expect(res.code).toBe(404);
    expect(res.body.error).toBe("Nenhum som padrão configurado");
  });

  it("resposta fora do contrato → INVALID_PAYLOAD → 502", async () => {
    nextResponse = { foo: 1 };

    const res = await callPost("/api/background-sound", { action: "play-default" });

    expect(res.code).toBe(502);
  });

  it("estado do som de fundo válido → 200 (mesma ponte para o GET)", async () => {
    nextResponse = STATE;

    const res = await callGet("/api/background-sound", {});

    expect(res.code).toBe(200);
    expect(res.body.playing).toBe(false);
  });
});
