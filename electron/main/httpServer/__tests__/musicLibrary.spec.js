// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  setupRoutes,
  isMusicLibraryAlbumsResponse,
  isMusicLibrarySongsResponse,
} = require("../routes.js");
const docStore = require("../../docStore.js");
const mediaResolver = require("../../mediaResolver.js");

/**
 * `GET /api/music-library` — álbuns/faixas/capa do controle remoto.
 *
 * Tudo legível no main: catálogo em arquivos temporários do jsonCache e
 * coletâneas no `docStore` (mock). Cobre a régua de álbuns desativados, a ordem
 * das faixas da coletânea, a normalização de duração e a capa (200/404/403).
 */
const handlers = { get: new Map(), post: new Map() };
let root;
let userData;

/** Categorias: album7 repetido (dedupe), album8 desativado e o hinário 1996. */
const CATEGORIES = [
  {
    id_category: 1,
    name: "Adoração",
    albums: [
      {
        id_album: 7,
        name: "Louvor 2020",
        year: 2020,
        url_image: "/images/louvor2020.jpg",
        color: "#123456",
      },
      { id_album: 629, name: "Hinário Adventista 1996", year: 1996 },
    ],
  },
  {
    id_category: null,
    name: "Geral",
    albums: [
      {
        id_album: 7,
        name: "Louvor 2020",
        year: 2020,
        url_image: "/images/louvor2020.jpg",
        color: "#123456",
      },
      { id_album: 8, name: "Culto Vivo", year: 2021 },
      { id_album: 9, name: "Vigna", subtitle: "Adoração 2018" },
    ],
  },
];

const ALBUM_DETAIL = {
  id_album: 7,
  name: "Louvor 2020",
  musics: [
    { id_music: 101, track: 1, name: "Abraços", duration: "00:03:39", has_instrumental_music: 1 },
    { id_music: 0, track: 2, name: "linha inválida" },
    { id_music: 102, track: 3, name: "Marcha", duration: 95, has_instrumental_music: 0 },
  ],
};

// `let` + reset no beforeEach: alguns testes acrescentam uma música órfã
// (fora de toda coletânea) e precisam voltar ao estado base sem órfãs.
let COLLECTIONS = [{ id: "uuid-1", nome: "Natal", cor: "#FF0000", song_ids: ["s2", "s1"] }];

let CUSTOM_SONGS = [
  { id: "s1", nome: "Noite de Paz", audio_token: "a", playback_token: "p" },
  { id: "s2", nome: "Natal Luz", audio_token: "b" },
];

const BASE_COLLECTIONS = JSON.parse(JSON.stringify(COLLECTIONS));
const BASE_CUSTOM_SONGS = JSON.parse(JSON.stringify(CUSTOM_SONGS));

/** Hinários ({lang}_hymnal[._1996].json) — fonte das faixas pinadas no topo. */
const HYMNAL = [
  { id_music: 1001, name: "Santo, Santo, Santo!", track: 1, has_instrumental_music: 1, duration: "00:02:17" },
  { id_music: 1002, name: "Ó Adorai o Senhor", track: 2, has_instrumental_music: 0, duration: 95 },
];
const HYMNAL_1996 = [
  { id_music: 9001, name: "Velho Hinário", track: 1, has_instrumental_music: 1, duration: "00:01:05" },
];

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

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-musiclibrary-"));
  await fs.writeFile(path.join(root, "pt_categories.json"), JSON.stringify(CATEGORIES));
  // O teste de título em espanhol consulta `{lang}_categories` igual ao pt.
  await fs.writeFile(path.join(root, "es_categories.json"), JSON.stringify(CATEGORIES));
  // Hinários pinados no topo — os dois idiomas (título traduzido no es).
  await fs.writeFile(path.join(root, "pt_hymnal.json"), JSON.stringify(HYMNAL));
  await fs.writeFile(path.join(root, "pt_hymnal_1996.json"), JSON.stringify(HYMNAL_1996));
  await fs.writeFile(path.join(root, "es_hymnal.json"), JSON.stringify(HYMNAL));
  await fs.writeFile(path.join(root, "es_hymnal_1996.json"), JSON.stringify(HYMNAL_1996));
  await fs.writeFile(path.join(root, "album_7.json"), JSON.stringify(ALBUM_DETAIL));
  const cover = path.join(root, "cover.jpg");
  await fs.writeFile(cover, Buffer.from([0xff, 0xd8, 0xff]));

  const jsonCache = require("../../jsonCache.js");
  vi.spyOn(jsonCache, "safeLocalPath").mockImplementation((key) =>
    path.join(root, `${key.replace(/\.json$/, "")}.json`)
  );
  vi.spyOn(docStore, "read").mockImplementation((colecao) => {
    if (colecao === "custom_collections.collections") return COLLECTIONS;
    if (colecao === "custom_collections.songs") return CUSTOM_SONGS;
    return [];
  });
  // Espelha o `joinDentroDe` real (mediaRoots): segmento `..` escaparia da
  // raiz e é recusado — sem isto "icons/../../x.png" passaria no mock e o
  // teste de traversal da branch icons mediria o mock, não a rota.
  vi.spyOn(mediaResolver, "resolveWrite").mockImplementation((rel) =>
    String(rel).startsWith("..") ||
    String(rel).startsWith("/") ||
    String(rel).split(/[\\/]/).includes("..")
      ? null
      : path.join(root, rel)
  );
  vi.spyOn(mediaResolver, "resolveRead").mockImplementation(async (rel) =>
    rel === "images/louvor2020.jpg" ? { path: cover } : null
  );

  setupRoutes(
    {
      get(route, handler) {
        handlers.get.set(route, handler);
      },
      post() {},
    },
    {
      getMainWindow: () => null,
      getUserData: () => userData,
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      rendererRequests: null,
    }
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  // Hinário 1996 desligado (entra no `disabled`) + album 8 desativado.
  userData = {
    options: { disabled_albums: [8] },
    modules: { hymnal_1996: { show_in_main_menu: false } },
  };
  COLLECTIONS = JSON.parse(JSON.stringify(BASE_COLLECTIONS));
  CUSTOM_SONGS = JSON.parse(JSON.stringify(BASE_CUSTOM_SONGS));
});

describe("GET /api/music-library?action=albums", () => {
  it("pinada o hinário no topo, achata categorias, deduplica e põe as coletâneas no fim", async () => {
    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums.map((album) => album.id)).toEqual([
      "album:712", // hinário atual pinado no topo (fora das categorias)
      "album:7", // 2020 (dedupe do album7 repetido)
      "album:9", // 2018 (vem do subtitle)
      "collection:uuid-1",
    ]);
    expect(res.body.albums[0]).toMatchObject({
      title: "Hinário Adventista",
      source: "official",
      module_id: "hymnal",
      count: HYMNAL.length,
      color: "#c0392b", // mesma cor do manifesto do módulo
      image: "/api/music-library/image?path=icons/hymnal.png", // PNG do backend
    });
    const byId = Object.fromEntries(res.body.albums.map((album) => [album.id, album]));
    expect(byId["album:7"]).toMatchObject({
      title: "Louvor 2020",
      source: "official",
      color: "#123456",
      count: 2, // faixas válidas do album_7.json (id_music 0 ficou de fora)
    });
    expect(byId["album:7"].image).toContain("/api/music-library/image?path=");
    expect(byId["album:9"].count).toBe(0); // sem album_9.json → badge some
    expect(byId["collection:uuid-1"]).toMatchObject({
      title: "Natal",
      source: "custom",
      color: "#FF0000",
      count: 2,
      image: null, // coletânea não tem capa (só cor, como no desktop)
    });
    const ids = res.body.albums.map((album) => album.id);
    expect(ids).not.toContain("album:8"); // desativado
    expect(ids).not.toContain("album:629"); // hinário 1996 com toggle desligado
    expect(isMusicLibraryAlbumsResponse(res.body)).toBe(true);
  });

  it("sem música órfã não existe o álbum virtual", async () => {
    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums.map((album) => album.id)).not.toContain("orphans:none");
  });

  it("música fora de toda coletânea vira o álbum 'Sem álbum' no fim, em pt", async () => {
    CUSTOM_SONGS.push({ id: "s9", nome: "Avulsa", audio_token: "c" });

    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    const ids = res.body.albums.map((album) => album.id);
    expect(ids).toEqual(["album:712", "album:7", "album:9", "collection:uuid-1", "orphans:none"]);
    expect(res.body.albums.at(-1)).toMatchObject({
      id: "orphans:none",
      title: "Sem álbum",
      subtitle: null,
      count: 1,
      source: "custom",
      color: null,
      image: null,
    });
    expect(isMusicLibraryAlbumsResponse(res.body)).toBe(true);
  });

  it("música sem nome não entra no álbum virtual (mesma régua da busca)", async () => {
    CUSTOM_SONGS.push({ id: "s0", nome: "   " }); // lixo: a busca também ignora
    CUSTOM_SONGS.push({ id: "s9", nome: "Avulsa", audio_token: "c" });

    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums.at(-1)).toMatchObject({ id: "orphans:none", count: 1 });

    const faixas = await callGet("/api/music-library", {
      action: "songs",
      album: "orphans:none",
      lang: "pt",
    });
    expect(faixas.body.songs).toHaveLength(1);
    expect(faixas.body.songs[0].name).toBe("Avulsa");
  });

  it("título do álbum virtual segue o lang (es)", async () => {
    CUSTOM_SONGS.push({ id: "s9", nome: "Avulsa", audio_token: "c" });

    const res = await callGet("/api/music-library", { action: "albums", lang: "es" });

    expect(res.code).toBe(200);
    expect(res.body.albums.at(-1)).toMatchObject({ id: "orphans:none", title: "Sin álbum" });
  });

  it("com o toggle ligado, o hinário 1996 pinado aparece UMA vez (sem duplicar)", async () => {
    // O fixture de categorias TAMBÉM traz 629 — o pin não pode duplicar o card.
    userData.modules.hymnal_1996.show_in_main_menu = true;

    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    const ids = res.body.albums.map((album) => album.id);
    expect(ids.slice(0, 2)).toEqual(["album:712", "album:629"]);
    expect(ids.filter((id) => id === "album:629")).toHaveLength(1);
    expect(res.body.albums[1]).toMatchObject({
      title: "Hinário 1996",
      source: "official",
      module_id: "hymnal_1996",
      count: HYMNAL_1996.length,
      color: "#7d3c98", // mesma cor do manifesto do módulo
      image: "/api/music-library/image?path=icons/hymnal_1996.png",
    });
    expect(isMusicLibraryAlbumsResponse(res.body)).toBe(true);
  });

  it("712 em disabled_albums tira o pin de cima (mesma régua dos demais)", async () => {
    userData.options.disabled_albums = [8, 712];

    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums.map((album) => album.id)).not.toContain("album:712");
    expect(isMusicLibraryAlbumsResponse(res.body)).toBe(true);
  });

  it("sem arquivo de hinário não há pin e a lista continua íntegra", async () => {
    const jsonCache = require("../../jsonCache.js");
    const normal = (key) => path.join(root, `${key.replace(/\.json$/, "")}.json`);
    vi.spyOn(jsonCache, "safeLocalPath").mockImplementation((key) =>
      String(key).includes("hymnal") ? path.join(root, `nope_${key}.json`) : normal(key)
    );

    const res = await callGet("/api/music-library", { action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums.map((album) => album.id)).not.toContain("album:712");
    expect(res.body.albums.map((album) => album.id)).not.toContain("album:629");
    // volta ao mock padrão do beforeAll (não mockRestore: restauraria o real)
    vi.spyOn(jsonCache, "safeLocalPath").mockImplementation(normal);
  });

  it("título do hinário segue o lang (es)", async () => {
    const res = await callGet("/api/music-library", { action: "albums", lang: "es" });

    expect(res.code).toBe(200);
    expect(res.body.albums[0]).toMatchObject({ id: "album:712", title: "Himnario Adventista" });
  });

  it("404 quando a base de categorias não existe", async () => {
    const jsonCache = require("../../jsonCache.js");
    vi.spyOn(jsonCache, "safeLocalPath").mockImplementation((key) =>
      path.join(root, `inexistente_${key}.json`)
    );

    const res = await callGet("/api/music-library", { action: "albums" });

    expect(res.code).toBe(404);
    // volta ao mock original para os próximos testes
    vi.spyOn(jsonCache, "safeLocalPath").mockImplementation((key) =>
      path.join(root, `${key.replace(/\.json$/, "")}.json`)
    );
  });
});

describe("GET /api/music-library?action=songs", () => {
  it("devolve as faixas do álbum oficial, sem id inválido e com duração normalizada", async () => {
    const res = await callGet("/api/music-library", { action: "songs", album: "album:7", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.songs.map((song) => song.id_music)).toEqual([101, 102]);
    expect(res.body.songs[0]).toMatchObject({
      name: "Abraços",
      albums_names: "Louvor 2020",
      duration: "3:39", // "00:03:39" → m:ss
      has_instrumental_music: 1,
      has_audio: 1,
      custom_song_id: null,
    });
    expect(res.body.songs[1].duration).toBe("1:35"); // 95 segundos
  });

  it("devolve as faixas da coletânea na ordem dela, com o UUID", async () => {
    const res = await callGet("/api/music-library", { action: "songs", album: "collection:uuid-1" });

    expect(res.code).toBe(200);
    expect(res.body.songs.map((song) => song.name)).toEqual(["Natal Luz", "Noite de Paz"]);
    expect(res.body.songs[0]).toMatchObject({
      custom_song_id: "s2",
      albums_names: "Natal",
      has_audio: 1,
      has_instrumental_music: 0,
    });
    expect(res.body.songs[0].id_music).toBeLessThan(0); // negativo sintético
    expect(res.body.songs[1].has_instrumental_music).toBe(1);
  });

  it("orphans:none devolve só as órfãs, com o UUID e o título traduzido", async () => {
    CUSTOM_SONGS.push({ id: "s9", nome: "Avulsa", audio_token: "c", playback_token: "q" });

    const res = await callGet("/api/music-library", {
      action: "songs",
      album: "orphans:none",
      lang: "pt",
    });

    expect(res.code).toBe(200);
    expect(res.body.songs).toHaveLength(1);
    expect(res.body.songs[0]).toMatchObject({
      name: "Avulsa",
      albums_names: "Sem álbum",
      custom_song_id: "s9",
      has_audio: 1,
      has_instrumental_music: 1,
    });
    expect(res.body.songs[0].id_music).toBeLessThan(0); // negativo sintético
    expect(isMusicLibrarySongsResponse(res.body)).toBe(true);
  });

  it("em espanhol as faixas do álbum virtual recebem 'Sin álbum'", async () => {
    CUSTOM_SONGS.push({ id: "s9", nome: "Avulsa", audio_token: "c" });

    const res = await callGet("/api/music-library", {
      action: "songs",
      album: "orphans:none",
      lang: "es",
    });

    expect(res.code).toBe(200);
    expect(res.body.songs[0].albums_names).toBe("Sin álbum");
  });

  it("id do álbum virtual com sufixo errado cai no 400 de album inválido", async () => {
    const res = await callGet("/api/music-library", { action: "songs", album: "orphans:qualquer" });

    expect(res.code).toBe(400);
  });

  it("hinário atual: album:712 lê {lang}_hymnal e rotula 'Hino nº N - Nome'", async () => {
    const res = await callGet("/api/music-library", {
      action: "songs",
      album: "album:712",
      lang: "pt",
    });

    expect(res.code).toBe(200);
    expect(res.body.songs.map((song) => song.name)).toEqual([
      "Hino nº 1 - Santo, Santo, Santo!",
      "Hino nº 2 - Ó Adorai o Senhor",
    ]);
    expect(res.body.songs[0]).toMatchObject({
      id_music: 1001,
      albums_names: "Hinário Adventista",
      duration: "2:17", // "00:02:17" → m:ss
      has_instrumental_music: 1,
      has_audio: 1,
      custom_song_id: null,
    });
    expect(res.body.songs[1].duration).toBe("1:35"); // 95 segundos
    expect(isMusicLibrarySongsResponse(res.body)).toBe(true);
  });

  it("hinário 1996: 404 com o toggle off e faixas com ele ligado", async () => {
    const off = await callGet("/api/music-library", {
      action: "songs",
      album: "album:629",
      lang: "pt",
    });
    expect(off.code).toBe(404);

    userData.modules.hymnal_1996.show_in_main_menu = true;
    const on = await callGet("/api/music-library", {
      action: "songs",
      album: "album:629",
      lang: "pt",
    });
    expect(on.code).toBe(200);
    expect(on.body.songs[0]).toMatchObject({
      id_music: 9001,
      name: "Hino nº 1 - Velho Hinário",
      albums_names: "Hinário 1996",
    });
  });

  it("hinário em espanhol rotula as faixas com o título em es", async () => {
    const res = await callGet("/api/music-library", {
      action: "songs",
      album: "album:712",
      lang: "es",
    });

    expect(res.code).toBe(200);
    expect(res.body.songs[0].albums_names).toBe("Himnario Adventista");
  });

  it("400 sem album e 404 para album/coletânea desconhecidos", async () => {
    expect((await callGet("/api/music-library", { action: "songs" })).code).toBe(400);
    expect((await callGet("/api/music-library", { action: "songs", album: "album:999" })).code).toBe(404);
    expect((await callGet("/api/music-library", { action: "songs", album: "collection:nope" })).code).toBe(404);
    expect((await callGet("/api/music-library", { action: "songs", album: "album:abc" })).code).toBe(400);
  });
});

describe("GET /api/music-library/image — capa de álbum", () => {
  it("serve o arquivo com mime e cache", async () => {
    const res = await callGet("/api/music-library/image", { path: "images/louvor2020.jpg" });

    expect(res.code).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toContain("max-age=");
    expect(Buffer.from(res.body).length).toBe(3);
  });

  it("404 sem arquivo, 400 sem path e 403 para traversal", async () => {
    expect((await callGet("/api/music-library/image", { path: "images/nao-existe.jpg" })).code).toBe(404);
    expect((await callGet("/api/music-library/image", {})).code).toBe(400);
    expect((await callGet("/api/music-library/image", { path: "../segredo.txt" })).code).toBe(403);
    expect((await callGet("/api/music-library/image", { path: "%2e%2e%2fsegredo.txt" })).code).toBe(403);
    // Barra inicial é só caminho relativo dentro de <dados>/files (igual ao
    // protocolo louvorja://files) → não é traversal, é arquivo inexistente.
    expect((await callGet("/api/music-library/image", { path: "/etc/passwd" })).code).toBe(404);
  });

  it("serve os ícones do app (branch icons/) com mime e cache", async () => {
    const res = await callGet("/api/music-library/image", { path: "icons/hymnal.png" });

    expect(res.code).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.headers["Cache-Control"]).toContain("max-age=");
    // PNG real (assinatura IHDR) — é o caminho de capa que os 3 clientes usam.
    expect(Buffer.from(res.body).slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(Buffer.from(res.body).length).toBeGreaterThan(1000);

    const legacy = await callGet("/api/music-library/image", { path: "icons/hymnal_1996.png" });
    expect(legacy.code).toBe(200);
    expect(Buffer.from(legacy.body).length).toBeGreaterThan(1000);
  });

  it("ícone do app inexistente → 404 e traversal na branch icons → 403", async () => {
    // Regex `icons/[a-z0-9_-]+.png` não casa → cai no guard normal de capa.
    expect((await callGet("/api/music-library/image", { path: "icons/qualquer.png" })).code).toBe(404);
    expect((await callGet("/api/music-library/image", { path: "icons/../../x.png" })).code).toBe(403);
  });
});

describe("validadores de music-library", () => {
  it("aceita o envelope de álbuns e rejeita lixo", () => {
    const album = {
      id: "album:7",
      title: "Louvor 2020",
      subtitle: null,
      count: 0,
      source: "official",
      color: "#123456",
      image: "/api/music-library/image?path=x",
    };
    expect(isMusicLibraryAlbumsResponse({ status: "ok", albums: [album] })).toBe(true);
    expect(
      isMusicLibraryAlbumsResponse({ status: "ok", albums: [{ ...album, source: "outro" }] })
    ).toBe(false);
    expect(isMusicLibraryAlbumsResponse({ status: "ok", albums: [{ ...album, image: 42 }] })).toBe(false);
    expect(isMusicLibraryAlbumsResponse(null)).toBe(false);
  });

  it("aceita o envelope de faixas e rejeita lixo", () => {
    const song = {
      id_music: 101,
      name: "Abraços",
      duration: "3:39",
      has_instrumental_music: 1,
      albums_names: "Louvor 2020",
      custom_song_id: null,
      has_audio: 1,
    };
    expect(isMusicLibrarySongsResponse({ status: "ok", songs: [song] })).toBe(true);
    expect(isMusicLibrarySongsResponse({ status: "ok", songs: [{ ...song, id_music: "x" }] })).toBe(false);
    expect(isMusicLibrarySongsResponse({ status: "ok", songs: [{ ...song, duration: 42 }] })).toBe(false);
    expect(isMusicLibrarySongsResponse({ status: "ok" })).toBe(false);
  });
});
