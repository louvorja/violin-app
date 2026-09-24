// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const read = vi.fn(() => ({ options: { dev: { allow_http_root: false } } }));

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", { app: {}, BrowserWindow: {}, ipcMain: {} });
stub("../paths.js", {});
stub("../userStore.js", { read });
stub("../jsonCache.js", {});
stub("../protocol.js", {});
stub("../devices.js", {});
stub("../httpServer/events.js", {});
stub("../httpServer/spa.js", {});

const server = require("../httpServer/index.js");
const { setupRoutes } = require("../httpServer/routes.js");

describe("HTTP user_data live snapshot", () => {
  it("serves repeated requests from the main snapshot and sees patches and replacements immediately", () => {
    const routes = new Map();
    const app = {
      get: (path, handler) => routes.set(`GET ${path}`, handler),
      post: () => {},
    };
    let current = { id_bible_version: 1, modules: { liturgy: { days: {} } } };
    server.setUserDataProvider(() => current);
    setupRoutes(app, { getUserData: () => server.getUserData() });

    const request = (path) => {
      let response;
      routes.get("GET /api/user-data")(
        { query: { path } },
        { json: (body) => { response = body; return body; } }
      );
      return response.value;
    };

    expect(Array.from({ length: 10 }, () => request("id_bible_version"))).toEqual(Array(10).fill(1));
    current.id_bible_version = 2; // userdata:patch mutates the live main snapshot
    expect(request("id_bible_version")).toBe(2);
    current = { id_bible_version: 3 }; // userStore:write replaces the full snapshot
    expect(request("id_bible_version")).toBe(3);
    expect(read).not.toHaveBeenCalled();
  });
});
