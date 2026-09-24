// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");
const handlers = new Map();
let root;
let fetchJson;

function response() {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(route, query = {}, params = {}) {
  const res = response();
  await handlers.get(route)({ query, params }, res);
  return res;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-routes-"));
  fetchJson = vi.fn(async () => ({ status: 404, body: null }));
  setupRoutes(
    {
      get(route, handler) { handlers.set(route, handler); },
      post() {},
    },
    {
      getMainWindow: () => null,
      getUserData: () => ({ storage: {} }),
      jsonCache: null,
      getDatabaseUrl: () => "https://example.invalid/db",
      getApiToken: () => "",
      rendererRequests: null,
    }
  );
  const cache = require("../../jsonCache.js");
  vi.spyOn(cache, "safeLocalPath").mockImplementation((key) =>
    path.join(root, `${key.replace(/\.json$/, "")}.json`)
  );
  vi.spyOn(cache, "fetchJson").mockImplementation(fetchJson);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("HTTP routes with asynchronous local reads", () => {
  it("keeps music search results and the missing-catalog 404", async () => {
    const missing = await call("/api/music-search", { q: "graca", lang: "es" });
    expect(missing.code).toBe(404);
    expect(missing.body.error).toMatch(/Base de músicas/);

    await fs.writeFile(path.join(root, "pt_musics.json"), JSON.stringify([
      { name: "Graça", albums_names: "Louvor" },
      { name: "Outra", albums_names: "Album" },
    ]));
    const found = await call("/api/music-search", { q: "graca", lang: "pt" });
    expect(found.body).toMatchObject({ status: "ok", total: 1 });
    expect(found.body.results[0].name).toBe("Graça");
  });

  it("keeps Bible downloaded detection, including missing chapters", async () => {
    await fs.writeFile(path.join(root, "pt_bible_version.json"), JSON.stringify([
      { id_bible_version: 1 }, { id_bible_version: 2 },
    ]));
    await fs.writeFile(path.join(root, "pt_bible_book.json"), JSON.stringify([
      { id_bible_book: 1, chapters: 2 },
    ]));
    await fs.writeFile(path.join(root, "bible_1_1_1.json"), "{}");
    await fs.writeFile(path.join(root, "bible_1_1_2.json"), "{}");
    await fs.writeFile(path.join(root, "bible_2_1_1.json"), "{}");
    expect((await call("/api/bible-downloaded", { lang: "pt" })).body.downloaded).toEqual([1]);
    expect((await call("/api/bible-downloaded", { lang: "es" })).body.downloaded).toEqual([]);
  });

  it("serves local JSON, falls back to remote on ENOENT, and keeps invalid JSON as 500", async () => {
    await fs.writeFile(path.join(root, "local.json"), JSON.stringify({ ok: true }));
    expect((await call("/api/db/:path(*)", {}, { path: "local" })).body).toEqual({ ok: true });

    fetchJson.mockResolvedValueOnce({ status: 200, body: Buffer.from('{"remote":true}') });
    expect((await call("/api/db/:path(*)", {}, { path: "remote" })).body).toEqual({ remote: true });

    await fs.writeFile(path.join(root, "invalid.json"), "{");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid = await call("/api/db/:path(*)", {}, { path: "invalid" });
    expect(invalid.code).toBe(500);
    expect(invalid.body.error).toBeTruthy();
    errorLog.mockRestore();
  });
});
