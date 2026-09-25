// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");

function createRoute() {
  const handlers = new Map();
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    send: (...args) => sent.push(args),
  };
  setupRoutes(
    {
      get() {},
      post(route, handler) { handlers.set(route, handler); },
    },
    {
      getMainWindow: () => ({ isDestroyed: () => false, webContents }),
      getUserData: () => ({ storage: {} }),
      jsonCache: null,
      getDatabaseUrl: () => "https://example.invalid/db",
      getApiToken: () => "",
      rendererRequests: null,
    }
  );
  return { handler: handlers.get("/api/song-slides"), sent };
}

function response() {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("POST /api/song-slides session boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards only a validated slide index and optional bounded session", () => {
    const { handler, sent } = createRoute();
    const res = response();
    handler({ body: { action: "go-to-slide", index: 2, presentation_session: "session-a" } }, res);
    expect(res.code).toBe(200);
    expect(sent[0]).toEqual(["http:song-slides", {
      action: "go-to-slide", index: 2, presentation_session: "session-a",
    }]);
  });

  it.each(["1", 1.5, -1, Number.MAX_SAFE_INTEGER + 1, undefined])(
    "rejects an invalid index (%s)", (index) => {
      const { handler, sent } = createRoute();
      const res = response();
      handler({ body: { action: "go-to-slide", index } }, res);
      expect(res.code).toBe(400);
      expect(sent).toHaveLength(0);
    }
  );

  it.each(["", "x".repeat(129), 4, null])("rejects an invalid session (%s)", (session) => {
    const { handler, sent } = createRoute();
    const res = response();
    handler({ body: { action: "go-to-slide", index: 0, presentation_session: session } }, res);
    expect(res.code).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("forwards a music close with its session and still permits nonmusic close", () => {
    const { handler, sent } = createRoute();
    const res = response();
    handler({ body: { action: "close", presentation_session: "session-a" } }, res);
    expect(sent[0]).toEqual(["http:song-slides", {
      action: "close", presentation_session: "session-a",
    }]);
    handler({ body: { action: "close" } }, res);
    expect(res.code).toBe(200);
    expect(sent[1]).toEqual(["http:song-slides", { action: "close" }]);
  });

  it("rejects malformed sessions on close, next and previous", () => {
    const { handler, sent } = createRoute();
    for (const action of ["close", "next", "previous"]) {
      const res = response();
      handler({ body: { action, presentation_session: {} } }, res);
      expect(res.code).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });
});
