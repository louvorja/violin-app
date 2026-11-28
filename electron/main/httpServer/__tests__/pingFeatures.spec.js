// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");
const { REMOTE_FEATURES } = require("../remoteRoutes/remoteFeatures.js");

/**
 * `/api/ping` — a lista `features` anuncia **todos** os módulos do controle
 * remoto implementados por esta versão. O app remoto usa os mesmos ids para
 * decidir quais cards exibir (sem a lista, mostra todos).
 */
const handlers = { get: new Map(), post: new Map() };

function response() {
  return {
    code: 200,
    body: undefined,
    json(body) {
      this.body = body;
      return this;
    },
  };
}

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
      getMainWindow: () => null,
      getUserData: () => ({}),
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      getAppVersion: () => "2.0.0-test",
      rendererRequests: {
        request() {
          throw new Error("ping não deveria chamar o renderer");
        },
      },
    }
  );
});

const ROOT = { kind: "global", authorized: true, permissions: ["root"] };

describe("GET /api/ping — features", () => {
  it("anuncia todos os módulos do controle remoto", async () => {
    const res = response();
    await handlers.get.get("/api/ping")({ authInfo: ROOT }, res);
    expect(res.code).toBe(200);
    expect(res.body.features).toEqual(REMOTE_FEATURES);
  });

  it("a lista traz os ids esperados (módulos do app + chat)", () => {
    expect([...REMOTE_FEATURES].sort()).toEqual(
      [
        "announcements",
        "background_sound",
        "bible",
        "chat",
        "draw",
        "liturgy",
        "media_library",
        "music",
        "online_videos",
        "player",
        "presenter",
        "projection",
        "slides",
        "stopwatch",
      ].sort()
    );
  });

  it("não repete ids", () => {
    expect(new Set(REMOTE_FEATURES).size).toBe(REMOTE_FEATURES.length);
  });
});
