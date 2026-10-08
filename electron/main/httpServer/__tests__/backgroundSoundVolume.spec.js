// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes, isBackgroundSoundStateResponse, isVolumeResponse } = require("../routes.js");

/**
 * Rotas do Som de fundo e do Volume do controle remoto.
 *
 * O renderer é simulado: a rota injeta o `requestId` (leitura) e o `safeSend`
 * grava o evento no `webContents` falso (comandos). Cobre permission (403),
 * contrato de `action`/`step`/`value` (400) e o prefixo de requestId de cada
 * recurso — o que o sweep do `preloadIpcContract` não alcança.
 */
const handlers = { get: new Map(), post: new Map() };
const requestedPrefixes = [];
const enviados = [];
let rendererReply = { status: "ok", value: 42 };

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

async function callGet(route, query, authInfo) {
  const res = response();
  await handlers.get.get(route)({ query, authInfo, headers: {} }, res);
  return res;
}

async function callPost(route, body, authInfo) {
  const res = response();
  await handlers.post.get(route)({ body, authInfo, headers: {} }, res);
  return res;
}

const STATE = {
  status: "ok",
  playing: true,
  volume: 35,
  currentId: "som-1",
  files: [{ id: "som-1", name: "Chuva", fileName: "chuva.mp3", categoryId: "cat-1" }],
  categories: [{ id: "cat-1", name: "Ambiente", color: "#123456" }],
};

beforeAll(() => {
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
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: (...args) => enviados.push(args) },
      }),
      getUserData: () => ({}),
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      rendererRequests: {
        request(prefix) {
          requestedPrefixes.push(prefix);
          return {
            requestId: `${prefix}:00000000-0000-4000-8000-000000000001`,
            promise: Promise.resolve(rendererReply),
            cancel: () => {},
          };
        },
      },
    }
  );
});

beforeEach(() => {
  rendererReply = { status: "ok", value: 42 };
  requestedPrefixes.length = 0;
  enviados.length = 0;
});

describe("GET /api/background-sound", () => {
  it("devolve o estado que o renderer montou (prefixo background-sound)", async () => {
    rendererReply = STATE;

    const res = await callGet("/api/background-sound", {});

    expect(res.code).toBe(200);
    expect(res.body.playing).toBe(true);
    expect(res.body.currentId).toBe("som-1");
    expect(res.body.files[0]).toMatchObject({ id: "som-1", name: "Chuva", categoryId: "cat-1" });
    expect(res.body.categories[0]).toMatchObject({ id: "cat-1", color: "#123456" });
    expect(requestedPrefixes).toEqual(["background-sound"]);
  });

  it("403 sem a permission background_sound, sem tocar no renderer", async () => {
    const res = await callGet("/api/background-sound", {}, { permissions: ["music"] });

    expect(res.code).toBe(403);
    expect(requestedPrefixes).toEqual([]);
  });
});

describe("POST /api/background-sound", () => {
  it("play reenvia o evento com id; sem id responde 400", async () => {
    const ok = await callPost("/api/background-sound", { action: "play", id: "som-1" });
    expect(ok.code).toBe(200);
    expect(enviados).toEqual([
      ["http:background-sound", { action: "play", id: "som-1" }],
    ]);

    const semId = await callPost("/api/background-sound", { action: "play" });
    expect(semId.code).toBe(400);
  });

  it("stop/pause/resume passam sem id; action desconhecida → 400", async () => {
    expect((await callPost("/api/background-sound", { action: "stop" })).code).toBe(200);
    expect((await callPost("/api/background-sound", { action: "pause" })).code).toBe(200);
    expect((await callPost("/api/background-sound", { action: "resume" })).code).toBe(200);
    expect((await callPost("/api/background-sound", { action: "explode" })).code).toBe(400);
    expect(enviados.map(([canal]) => canal)).toEqual([
      "http:background-sound",
      "http:background-sound",
      "http:background-sound",
    ]);
  });

  it("play-default usa o requestRenderer e responde ok (sem id)", async () => {
    rendererReply = { status: "ok" };

    const res = await callPost("/api/background-sound", { action: "play-default" });

    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "ok", action: "play-default" });
    expect(requestedPrefixes).toEqual(["background-sound"]);
    // O requestRenderer despacha pelo webContents falso — com requestId no
    // prefixo `background-sound` (contrato do preload).
    expect(enviados).toHaveLength(1);
    expect(enviados[0][0]).toBe("http:background-sound");
    expect(enviados[0][1]).toMatchObject({ action: "play-default" });
    expect(String(enviados[0][1].requestId)).toContain("background-sound:");
  });

  it("sem som padrão configurado → 404 com a mensagem do renderer", async () => {
    rendererReply = { status: "error", error: "Nenhum som padrão configurado" };

    const res = await callPost("/api/background-sound", { action: "play-default" });

    expect(res.code).toBe(404);
    expect(res.body.error).toBe("Nenhum som padrão configurado");
    expect(requestedPrefixes).toEqual(["background-sound"]);
  });

  it("403 sem a permission background_sound", async () => {
    const res = await callPost("/api/background-sound", { action: "stop" }, { permissions: ["music"] });

    expect(res.code).toBe(403);
    expect(enviados).toEqual([]);
  });
});

describe("POST /api/volume", () => {
  it("up/down envia o passo e devolve o valor do renderer (prefixo volume)", async () => {
    rendererReply = { status: "ok", value: 43 };

    const res = await callPost("/api/volume", { action: "up", step: 1 });

    expect(res.code).toBe(200);
    expect(res.body.value).toBe(43);
    expect(requestedPrefixes).toEqual(["volume"]);
  });

  it("set exige value inteiro em 0..100", async () => {
    expect((await callPost("/api/volume", { action: "set", value: 70 })).code).toBe(200);
    expect((await callPost("/api/volume", { action: "set", value: 101 })).code).toBe(400);
    expect((await callPost("/api/volume", { action: "set", value: -1 })).code).toBe(400);
    expect((await callPost("/api/volume", { action: "set", value: 70.5 })).code).toBe(400);
    expect((await callPost("/api/volume", { action: "set" })).code).toBe(400);
  });

  it("step fora de 1..100 e action inválida → 400", async () => {
    expect((await callPost("/api/volume", { action: "up", step: 0 })).code).toBe(400);
    expect((await callPost("/api/volume", { action: "up", step: 101 })).code).toBe(400);
    expect((await callPost("/api/volume", { action: "sideways" })).code).toBe(400);
    expect(requestedPrefixes).toEqual([]);
  });

  it("403 sem a permission volume", async () => {
    const res = await callPost("/api/volume", { action: "up" }, { permissions: ["music", "chat"] });

    expect(res.code).toBe(403);
    expect(requestedPrefixes).toEqual([]);
  });
});

describe("validadores de som de fundo e volume", () => {
  it("aceita o estado completo e rejeita fora do contrato", () => {
    expect(isBackgroundSoundStateResponse(STATE)).toBe(true);
    expect(isBackgroundSoundStateResponse({ ...STATE, volume: 101 })).toBe(false);
    expect(isBackgroundSoundStateResponse({ ...STATE, playing: "sim" })).toBe(false);
    expect(isBackgroundSoundStateResponse({ ...STATE, files: "x" })).toBe(false);
    expect(
      isBackgroundSoundStateResponse({
        ...STATE,
        files: [{ id: "a", name: "b", categoryId: 42 }],
      })
    ).toBe(false);
    expect(isBackgroundSoundStateResponse(null)).toBe(false);
  });

  it("aceita a resposta de volume e rejeita fora de faixa", () => {
    expect(isVolumeResponse({ status: "ok", value: 0 })).toBe(true);
    expect(isVolumeResponse({ status: "ok", value: 100 })).toBe(true);
    expect(isVolumeResponse({ status: "ok", value: 101 })).toBe(false);
    expect(isVolumeResponse({ status: "ok", value: -1 })).toBe(false);
    expect(isVolumeResponse({ status: "ok", value: 12.5 })).toBe(false);
    expect(isVolumeResponse(null)).toBe(false);
  });
});
