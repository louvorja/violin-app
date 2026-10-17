// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");

/**
 * Gates de permissão dos comandos do controle remoto.
 *
 * Cada rota manda na sua role: `keyboard` (teclas de atalho), `bible`, `music`
 * (busca, abrir música e passar slides). Sem a role — e sem `root` — o device
 * leva 403; token global e localhost passam (sem `authInfo`).
 */
const handlers = { get: new Map(), post: new Map() };

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
    set() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    on() {},
    once() {},
    off() {},
  };
}

const SEM = { authInfo: { permissions: [] } };
const COM = { authInfo: { permissions: ["keyboard"] } };
const ROOT = { authInfo: { permissions: ["root"] } };

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
      getMainWindow: () => ({ isDestroyed: () => false }),
      getUserData: () => ({}),
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      rendererRequests: {
        request() {
          return {
            requestId: "slides:00000000-0000-4000-8000-000000000001",
            promise: Promise.resolve({ status: "ok", slides: [], currentSlideIndex: 0 }),
            cancel: () => {},
          };
        },
      },
    }
  );
});

describe("POST /api/keyboard — role keyboard", () => {
  it("sem a role leva 403", async () => {
    const res = response();
    await handlers.post.get("/api/keyboard")({ body: { key: "F5" }, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });

  it("com a role passa do gate (o harness não tem webContents: 500)", async () => {
    const res = response();
    await handlers.post.get("/api/keyboard")({ body: { key: "F5" }, headers: {}, ...COM }, res);

    expect(res.code).not.toBe(403);
  });

  it("root passa do gate", async () => {
    const res = response();
    await handlers.post.get("/api/keyboard")({ body: { key: "F5" }, headers: {}, ...ROOT }, res);

    expect(res.code).not.toBe(403);
  });

  it("sem authInfo (token global/localhost) passa do gate", async () => {
    const res = response();
    await handlers.post.get("/api/keyboard")({ body: { key: "F5" }, headers: {} }, res);

    expect(res.code).not.toBe(403);
  });
});

describe("GET /api/music-search — role music", () => {
  it("sem a role leva 403", async () => {
    const res = response();
    await handlers.get.get("/api/music-search")({ query: { q: "ceu" }, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });

  it("com a role segue (a base pode não existir no harness)", async () => {
    const res = response();
    await handlers.get.get("/api/music-search")(
      { query: { q: "ceu" }, headers: {}, authInfo: { permissions: ["music"] } },
      res
    );

    expect(res.code).not.toBe(403);
  });
});

describe("POST /api/song-slides e /api/bible — roles music/bible", () => {
  it("song-slides sem role leva 403", async () => {
    const res = response();
    await handlers.post.get("/api/song-slides")({ body: { action: "next" }, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });

  it("bible-next passa com a role bible (mesmo sem music)", async () => {
    const res = response();
    await handlers.post.get("/api/song-slides")(
      { body: { action: "bible-next" }, headers: {}, authInfo: { permissions: ["bible"] } },
      res
    );

    expect(res.code).not.toBe(403);
  });

  it("playing-check passa sem role nenhuma (é leitura do deck)", async () => {
    const res = response();
    await handlers.post.get("/api/song-slides")(
      { body: { action: "playing-check" }, headers: {}, ...SEM },
      res
    );

    expect(res.code).not.toBe(403);
  });

  it("next SEM role continua bloqueado", async () => {
    const res = response();
    await handlers.post.get("/api/song-slides")(
      { body: { action: "next" }, headers: {}, ...SEM },
      res
    );

    expect(res.code).toBe(403);
  });

  it("bible sem a role leva 403", async () => {
    const res = response();
    await handlers.post.get("/api/bible")(
      { body: { action: "verse", text: "João 3:16" }, headers: {}, ...SEM },
      res
    );

    expect(res.code).toBe(403);
  });

  it("bible com a role passa do gate", async () => {
    const res = response();
    await handlers.post.get("/api/bible")(
      { body: { action: "verse", text: "João 3:16" }, headers: {}, authInfo: { permissions: ["bible"] } },
      res
    );

    expect(res.code).not.toBe(403);
  });

  it("liturgy sem a role leva 403", async () => {
    const res = response();
    await handlers.get.get("/api/liturgy")({ query: {}, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });

  it("liturgy-execute sem a role leva 403", async () => {
    const res = response();
    await handlers.post.get("/api/liturgy-execute")(
      { body: { id: "x", day: 0 }, headers: {}, ...SEM },
      res
    );

    expect(res.code).toBe(403);
  });

  it("chat/history sem a role leva 403", async () => {
    const res = response();
    await handlers.get.get("/api/chat/history")({ query: {}, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });

  it("announcements sem a role leva 403", async () => {
    const resGet = response();
    await handlers.get.get("/api/announcements")(
      { query: { action: "list" }, headers: {}, ...SEM },
      resGet
    );
    const resPost = response();
    await handlers.post.get("/api/announcements")(
      { body: { action: "next" }, headers: {}, ...SEM },
      resPost
    );

    expect(resGet.code).toBe(403);
    expect(resPost.code).toBe(403);
  });

  it("open-song sem a role music leva 403", async () => {
    const res = response();
    await handlers.post.get("/api/open-song")({ body: { id: 10 }, headers: {}, ...SEM }, res);

    expect(res.code).toBe(403);
  });
});
