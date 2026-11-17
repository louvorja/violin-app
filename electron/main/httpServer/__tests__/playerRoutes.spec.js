// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");

/**
 * Rotas do Player de mídia (`/api/media`) e do Cronômetro (`/api/stopwatch`).
 *
 * O renderer é simulado: a rota gera o `requestId` e devolve o estado que ele
 * montaria. Cobre permission (403), contrato de ação/seek/target (400), o
 * envelope de erro do renderer (409) e os prefixos de requestId.
 */
const handlers = { get: new Map(), post: new Map() };
const requestedPrefixes = [];
let rendererReply;

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

const ROOT = { kind: "global", authorized: true, permissions: ["root"] };
const NO_PERMISSIONS = { kind: "device", authorized: true, permissions: [] };

const MEDIA_STATE = {
  active: true,
  playing: true,
  loading: false,
  minimized: false,
  source: "file",
  title: "Culto",
  subtitle: "Canal do culto",
  fileName: "video.mp4",
  position: 12.5,
  duration: 95,
  canPlay: false,
  canPause: true,
  canSeek: true,
  canPrevious: true,
  canNext: true,
  seq: 1,
};

const STOPWATCH_STATE = {
  running: true,
  mode: "countup",
  elapsed: 1.5,
  target: null,
  remaining: null,
  alert: "",
  overtime: true,
  showSeconds: true,
  warningSeconds: 60,
  laps: [{ index: 1, elapsed: 1.2, shown: 1 }],
  projecting: false,
  seq: 2,
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
        webContents: { isDestroyed: () => false, send: () => {} },
      }),
      getUserData: () => ({}),
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      getAppVersion: () => "2.0.0-test",
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
  rendererReply = { status: "ok", state: MEDIA_STATE };
  requestedPrefixes.length = 0;
});

describe("GET/POST /api/media", () => {
  it("devolve o estado do player e usa o prefixo media", async () => {
    const res = await callGet("/api/media", {}, ROOT);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "ok", state: MEDIA_STATE });
    expect(requestedPrefixes).toEqual(["media"]);
  });

  it("nega device sem a permission player", async () => {
    const res = await callGet("/api/media", {}, NO_PERMISSIONS);
    expect(res.code).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("valida o seek antes de chegar ao renderer", async () => {
    const invalid = await callPost("/api/media", { action: "seek", position: -1 }, ROOT);
    expect(invalid.code).toBe(400);
    expect(invalid.body.code).toBe("INVALID_POSITION");
    expect(requestedPrefixes).toEqual([]);

    const valid = await callPost("/api/media", { action: "seek", position: 30.5 }, ROOT);
    expect(valid.code).toBe(200);
    expect(requestedPrefixes).toEqual(["media"]);
  });

  it("mapeia NO_MEDIA do renderer para 409", async () => {
    rendererReply = { status: "error", code: "NO_MEDIA", error: "Nada em reprodução" };
    const res = await callPost("/api/media", { action: "play" }, ROOT);
    expect(res.code).toBe(409);
    expect(res.body).toEqual({
      status: "error",
      code: "NO_MEDIA",
      message: "Nada em reprodução",
      error: "Nada em reprodução",
    });
  });

  it("rejeita action desconhecida", async () => {
    const res = await callPost("/api/media", { action: "stop" }, ROOT);
    expect(res.code).toBe(400);
    expect(res.body.code).toBe("INVALID_ACTION");
  });
});

describe("GET/POST /api/stopwatch", () => {
  beforeEach(() => {
    rendererReply = { status: "ok", state: STOPWATCH_STATE };
  });

  it("devolve o estado e usa o prefixo stopwatch", async () => {
    const res = await callGet("/api/stopwatch", {}, ROOT);
    expect(res.code).toBe(200);
    expect(res.body.state.laps).toHaveLength(1);
    expect(requestedPrefixes).toEqual(["stopwatch"]);
  });

  it("nega device sem a permission stopwatch", async () => {
    const res = await callGet("/api/stopwatch", {}, NO_PERMISSIONS);
    expect(res.code).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("valida set-mode/countdown e target", async () => {
    const noTarget = await callPost(
      "/api/stopwatch",
      { action: "set-mode", mode: "countdown" },
      ROOT
    );
    expect(noTarget.code).toBe(400);
    expect(noTarget.body.code).toBe("INVALID_TARGET");

    const badMode = await callPost("/api/stopwatch", { action: "set-mode", mode: "up" }, ROOT);
    expect(badMode.code).toBe(400);
    expect(badMode.body.code).toBe("INVALID_MODE");

    const valid = await callPost(
      "/api/stopwatch",
      { action: "set-mode", mode: "countdown", target: 300 },
      ROOT
    );
    expect(valid.code).toBe(200);
    expect(requestedPrefixes).toEqual(["stopwatch"]);
  });

  it("aceita seek-relative, next e previous com validação de passo", async () => {
    const invalid = await callPost(
      "/api/media",
      { action: "seek-relative", seconds: 0 },
      ROOT
    );
    expect(invalid.code).toBe(400);
    expect(invalid.body.code).toBe("INVALID_SEEK");

    expect(
      (await callPost("/api/media", { action: "seek-relative", seconds: 10 }, ROOT)).code
    ).toBe(200);
    expect((await callPost("/api/media", { action: "next" }, ROOT)).code).toBe(200);
    expect((await callPost("/api/media", { action: "previous" }, ROOT)).code).toBe(200);
  });

  it("aceita project e unproject do cronômetro", async () => {
    rendererReply = { status: "ok", state: STOPWATCH_STATE };
    expect((await callPost("/api/stopwatch", { action: "project" }, ROOT)).code).toBe(200);
    expect((await callPost("/api/stopwatch", { action: "unproject" }, ROOT)).code).toBe(200);
  });

  it("aceita reset e clear-laps", async () => {
    expect((await callPost("/api/stopwatch", { action: "reset" }, ROOT)).code).toBe(200);
    expect((await callPost("/api/stopwatch", { action: "clear-laps" }, ROOT)).code).toBe(200);
    expect(requestedPrefixes).toEqual(["stopwatch", "stopwatch"]);
  });
});
