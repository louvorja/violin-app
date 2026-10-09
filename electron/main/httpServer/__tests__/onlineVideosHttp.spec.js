// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupRoutes } from "../routes.js";

/**
 * Integração da rota `GET/POST /api/online-videos` — o caminho que a aba
 * Vídeos Online (web e app) percorre.
 *
 * O renderer é simulado: a rota injeta o `requestId` e o teste devolve a
 * resposta. Cobre permission (403), contrato de `action` (400), o `safeSend`
 * do comando `play` e o caminho feliz — o que o `onlineVideosRoutes.spec.js`
 * (funções puras) não alcança.
 */

const handlers = { get: new Map(), post: new Map() };
const requestedPrefixes = [];
let rendererReply = { status: "ok", albums: [] };
let send;

const app = {
  get(route, handler) {
    handlers.get.set(route, handler);
  },
  post(route, handler) {
    handlers.post.set(route, handler);
  },
};

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

async function callGet(query, authInfo) {
  const res = response();
  await handlers.get.get("/api/online-videos")({ query, authInfo, headers: {} }, res);
  return res;
}

async function callGetImage(query, authInfo) {
  const res = response();
  await handlers.get.get("/api/online-videos/image")({ query, authInfo, headers: {} }, res);
  return res;
}

async function callPost(body, authInfo) {
  const res = response();
  await handlers.post.get("/api/online-videos")({ body, authInfo, headers: {} }, res);
  return res;
}

beforeAll(() => {
  setupRoutes(app, {
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: (...args) => send(...args) },
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
  });
});

beforeEach(() => {
  rendererReply = { status: "ok", albums: [] };
  requestedPrefixes.length = 0;
  send = vi.fn();
});

describe("GET /api/online-videos — consulta ao renderer", () => {
  it("devolve os álbuns que o renderer respondeu", async () => {
    rendererReply = {
      status: "ok",
      albums: [{ id: "online:PL1", title: "Adoração", subtitle: null, count: 3, source: "online" }],
    };

    const res = await callGet({ action: "albums", lang: "pt" });

    expect(res.code).toBe(200);
    expect(res.body.albums).toHaveLength(1);
    expect(requestedPrefixes).toEqual(["online-videos"]);
  });

  it("pede a busca com q/lang e o álbum com album", async () => {
    rendererReply = { status: "ok", videos: [] };

    await callGet({ action: "search", q: "natal", lang: "es" });
    expect(requestedPrefixes).toEqual(["online-videos"]);

    await callGet({ action: "videos", album: "custom:cat-1", lang: "pt" });
    expect(requestedPrefixes).toEqual(["online-videos", "online-videos"]);
  });

  it("bloqueia device sem a permission online_videos antes de tocar no renderer", async () => {
    const res = await callGet({ action: "albums" }, { permissions: ["music", "chat"] });

    expect(res.code).toBe(403);
    expect(res.body.error).toMatch(/permissão/);
    expect(requestedPrefixes).toEqual([]);
  });

  it("deixa passar device com online_videos ou root", async () => {
    expect((await callGet({ action: "albums" }, { permissions: ["online_videos"] })).code).toBe(200);
    expect((await callGet({ action: "albums" }, { permissions: ["root"] })).code).toBe(200);
    expect(requestedPrefixes).toHaveLength(2);
  });

  it("rejeita action desconhecida e videos sem album", async () => {
    expect((await callGet({ action: "bogus" })).code).toBe(400);
    expect((await callGet({ action: "videos" })).code).toBe(400);
  });
});

describe("POST /api/online-videos — comandos de projeção", () => {
  it("play com id válido manda o evento http:online-videos com o videoId", async () => {
    const res = await callPost({
      action: "play",
      url: "https://youtu.be/abcdefghijk",
      title: "Mensagem de Natal",
    });

    expect(res.code).toBe(200);
    expect(send).toHaveBeenCalledWith("http:online-videos", {
      action: "play",
      videoId: "abcdefghijk",
      title: "Mensagem de Natal",
    });
  });

  it("play com URL sem id de vídeo responde 400 e não emite nada", async () => {
    const res = await callPost({ action: "play", url: "https://example.com/x" });

    expect(res.code).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("close emite o evento e play sem permission responde 403", async () => {
    expect((await callPost({ action: "close" })).code).toBe(200);
    expect(send).toHaveBeenCalledWith("http:online-videos", { action: "close" });

    const bloqueado = await callPost(
      { action: "play", url: "https://youtu.be/abcdefghijk" },
      { permissions: ["music"] }
    );
    expect(bloqueado.code).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/online-videos/image — miniatura dos Meus Vídeos", () => {
  it("devolve os bytes com o mime que o renderer mandou", async () => {
    rendererReply = {
      status: "ok",
      mime: "image/jpeg",
      data: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    };

    const res = await callGetImage({ kind: "video", id: "vid-1" });

    expect(res.code).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toContain("max-age=");
    expect(res.body.length).toBe(3);
    expect(requestedPrefixes).toEqual(["online-videos"]);
  });

  it("404 quando o renderer não tem a miniatura", async () => {
    rendererReply = { status: "ok", mime: "", data: null };

    const res = await callGetImage({ kind: "category", id: "cat-1" });

    expect(res.code).toBe(404);
    expect(res.body.error).toMatch(/Miniatura/);
  });

  it("403 sem permission e 400 para kind/id inválidos, sem tocar no renderer", async () => {
    expect((await callGetImage({ kind: "video", id: "vid-1" }, { permissions: ["music"] })).code).toBe(403);
    expect((await callGetImage({ kind: "avatar", id: "vid-1" })).code).toBe(400);
    expect((await callGetImage({ kind: "video" })).code).toBe(400);
    expect((await callGetImage({ kind: "video", id: "  " })).code).toBe(400);
    expect(requestedPrefixes).toEqual([]);
  });
});
