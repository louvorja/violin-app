// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { setupRoutes, isCustomSongsSearchResponse } = require("../routes.js");

/**
 * `/api/music-search` com o acervo pessoal.
 *
 * A busca oficial vem do arquivo no jsonCache (main) e a pessoal do IndexedDB
 * via `requestRenderer` — aqui o renderer é simulado para provar o contrato:
 * merge, filtro com o mesmo `normalize`, consulta numérica sem consultar o
 * pessoal e **renderer indisponível não derruba a busca oficial**.
 */
const handlers = { get: new Map(), post: new Map() };
let rendererReply = { status: "ok", songs: [] };
let rendererError = false;
const requestedPrefixes = [];
let root;

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
    set() {
      return this;
    },
    on() {},
    once() {},
    off() {},
  };
}

async function callSearch(q) {
  const res = response();
  await handlers.get.get("/api/music-search")({ query: { q, lang: "pt" }, headers: {} }, res);
  return res;
}

const OFFICIAL_SONGS = [
  {
    id_music: 1,
    name: "Amor antigo",
    albums: [{ id_album: 712, name: "Hinário Adventista", type: "hymnal", pivot: { track: 1 } }],
  },
  {
    id_music: 2,
    name: "Zelo novo",
    albums: [{ id_album: 712, name: "Hinário Adventista", type: "hymnal", pivot: { track: 2 } }],
  },
];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-musicsearch-"));
  await fs.writeFile(path.join(root, "pt_musics.json"), JSON.stringify(OFFICIAL_SONGS));

  const jsonCache = require("../../jsonCache.js");
  vi.spyOn(jsonCache, "safeLocalPath").mockImplementation((key) =>
    path.join(root, `${key.replace(/\.json$/, "")}.json`)
  );

  setupRoutes(
    {
      get(route, handler) {
        handlers.get.set(route, handler);
      },
      post() {},
    },
    {
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send() {} },
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
            promise: rendererError
              ? Promise.reject(new Error("renderer fora do ar"))
              : Promise.resolve(rendererReply),
            cancel() {},
          };
        },
      },
    }
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  rendererReply = { status: "ok", songs: [] };
  rendererError = false;
  requestedPrefixes.length = 0;
});

describe("GET /api/music-search — acervo pessoal junto do oficial", () => {
  it("devolve oficial e pessoal, com o pessoal no fim (ordem do spotlight)", async () => {
    rendererReply = {
      status: "ok",
      songs: [
        {
          id_music: -2,
          name: "Amor de natal",
          albums_names: "Coletânea de Natal",
          custom_song_id: "uuid-1",
          has_instrumental_music: 1,
          has_audio: 1,
        },
      ],
    };

    const res = await callSearch("amor");

    expect(res.code).toBe(200);
    expect(res.body.results.map((m) => m.id_music)).toEqual([1, -2]);
    expect(res.body.results[1]).toMatchObject({
      name: "Amor de natal",
      albums_names: "Coletânea de Natal",
      custom_song_id: "uuid-1",
    });
    expect(res.body.total).toBe(2);
    expect(requestedPrefixes).toEqual(["custom-music"]);
  });

  it("filtra o pessoal com o mesmo normalize (acento não atrapalha)", async () => {
    rendererReply = {
      status: "ok",
      songs: [
        { id_music: -3, name: "Canção de Natal", albums_names: "", custom_song_id: "uuid-3", has_instrumental_music: 0, has_audio: 1 },
        { id_music: -4, name: "Marcha secular", albums_names: "", custom_song_id: "uuid-4", has_instrumental_music: 0, has_audio: 1 },
      ],
    };

    const res = await callSearch("cancao");

    expect(res.body.results.map((m) => m.id_music)).toEqual([-3]);
  });

  it("consulta numérica (hinário) não consulta o acervo pessoal", async () => {
    const res = await callSearch("1234");

    expect(requestedPrefixes).toEqual([]);
    expect(res.code).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it("renderer indisponível não derruba a busca oficial", async () => {
    rendererError = true;

    const res = await callSearch("amor");

    expect(res.code).toBe(200);
    expect(res.body.results.map((m) => m.id_music)).toEqual([1]);
    expect(res.body.total).toBe(1);
  });
});

describe("isCustomSongsSearchResponse — contrato do renderer", () => {
  const song = {
    id_music: -2,
    name: "Amor de natal",
    albums_names: "Coletânea de Natal",
    custom_song_id: "uuid-1",
    has_instrumental_music: 1,
    has_audio: 1,
  };

  it("aceita o envelope válido (id negativo, UUID e flags inteiros)", () => {
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [song] })).toBe(true);
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [] })).toBe(true);
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [{ ...song, custom_song_id: null }] })).toBe(true);
  });

  it("rejeita payload fora do contrato", () => {
    expect(isCustomSongsSearchResponse(null)).toBe(false);
    expect(isCustomSongsSearchResponse({ status: "erro", songs: [] })).toBe(false);
    expect(isCustomSongsSearchResponse({ status: "ok" })).toBe(false);
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [{ ...song, id_music: "x" }] })).toBe(false);
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [{ ...song, custom_song_id: 42 }] })).toBe(false);
    expect(isCustomSongsSearchResponse({ status: "ok", songs: [{ ...song, has_audio: "sim" }] })).toBe(false);
    expect(
      isCustomSongsSearchResponse({ status: "ok", songs: [{ ...song, name: "x".repeat(501) }] })
    ).toBe(false);
  });
});
