// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");
const devices = require("../../devices.js");
const docStore = require("../../docStore.js");

const handlers = new Map();

function response() {
  return {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function call(route, query = {}, params = {}) {
  const res = response();
  handlers.get(route)({ query, params }, res);
  return res;
}

beforeAll(() => {
  setupRoutes(
    {
      get(route, handler) {
        handlers.set(route, handler);
      },
      post() {},
    },
    {
      getMainWindow: () => null,
      getUserData: () => ({}),
      jsonCache: null,
      getDatabaseUrl: () => "https://example.invalid/db",
      getApiToken: () => "",
      rendererRequests: null,
    },
  );
});

afterAll(() => vi.restoreAllMocks());

describe("GET /api/chat/history", () => {
  it("devolve as últimas N mensagens, em ordem cronológica", () => {
    vi.spyOn(devices, "getChatHistoryLimit").mockReturnValue(3);
    vi.spyOn(docStore, "read").mockReturnValue([
      { id: "b", timestamp: "2026-01-02T10:00:00Z" },
      { id: "c", timestamp: "2026-01-03T10:00:00Z" },
      { id: "a", timestamp: "2026-01-01T10:00:00Z" },
      { id: "d", timestamp: "2026-01-04T10:00:00Z" },
    ]);

    const res = call("/api/chat/history");

    expect(res.body.status).toBe("ok");
    expect(res.body.messages.map((m) => m.id)).toEqual(["b", "c", "d"]);
  });

  it("respeita o limite configurado (default 100)", () => {
    vi.spyOn(devices, "getChatHistoryLimit").mockReturnValue(100);
    vi.spyOn(docStore, "read").mockReturnValue(
      Array.from({ length: 150 }, (_, i) => ({
        id: String(i),
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })),
    );

    const res = call("/api/chat/history");

    expect(res.body.messages).toHaveLength(100);
    expect(res.body.messages[0].id).toBe("50");
  });

  it("devolve lista vazia quando não há histórico", () => {
    vi.spyOn(devices, "getChatHistoryLimit").mockReturnValue(100);
    vi.spyOn(docStore, "read").mockReturnValue([]);

    const res = call("/api/chat/history");

    expect(res.body).toEqual({ status: "ok", messages: [] });
  });
});
