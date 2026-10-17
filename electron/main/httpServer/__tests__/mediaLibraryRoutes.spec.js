// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { setupRoutes } = require("../routes.js");
const pathsReal = require("../../paths.js");

/**
 * Rotas da Biblioteca de Mídia do controle remoto.
 *
 * Mesma abordagem do `backgroundSoundVolume.spec.js`: app falso, renderer
 * simulado (leitura via `rendererRequests.request`; comandos via `safeSend`
 * no `webContents` falso). O upload é diferente — ele encosta no disco: o
 * `paths.filesDir` é mockado para um tmpdir e o `req` é um `Readable` de
 * verdade, porque a rota faz stream (não passa por body-parser).
 */
const handlers = { get: new Map(), post: new Map() };
const requestedPrefixes = [];
const enviados = [];
let rendererReply = { status: "ok", items: [], categories: [] };
/** userData servido pelo main (a playlist vive nele). */
let userData = { modules: { media_library: { playlist: [] } } };

const mocks = vi.hoisted(() => ({ root: "" }));

// `paths.filesDir` aponta para um tmpdir (o upload encosta no disco). spyOn no
// módulo real — os specs usam createRequire (require nativo), então vi.mock
// não intercepta; mesmo molde do jsonCache/docStore no musicLibrary.spec.
vi.spyOn(pathsReal, "filesDir").mockImplementation(() => mocks.root);

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
    end() {
      this.writableEnded = true;
      return this;
    },
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

/** Upload: corpo cru (Readable) + headers de nome/categoria. */
async function callUpload(chunks, headers, authInfo) {
  const res = response();
  const req = Object.assign(Readable.from(chunks), {
    headers,
    authInfo,
    destroy: Readable.prototype.destroy,
  });
  await handlers.post.get("/api/media-library/upload")(req, res);
  return res;
}

const ITEMS = {
  status: "ok",
  items: [
    {
      id: "file_1",
      name: "Culto.jpg",
      type: "image",
      thumb: "/api/media-library/image?url=louvorja%3A%2F%2Flocal%2Fx.jpg",
      categoryId: null,
      addedAt: 1,
    },
  ],
  categories: [{ id: "cat", name: "Fotos", color: "#123456" }],
};

const CANVA = {
  status: "ok",
  available: true,
  items: [{ type: "design", id: "d1", name: "Cartaz", thumb: "https://x/c.jpg", url: null, pageCount: 2, updatedAt: 5 }],
  continuation: "next-page",
  cached: { d1: 10 },
};

const SEM_PERMISSAO = { permissions: [] };
const COM_PERMISSAO = { permissions: ["media_library"] };

beforeAll(async () => {
  mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-medialibrary-"));

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
        webContents: {
          isDestroyed: () => false,
          send: (channel, payload) => enviados.push([channel, payload]),
        },
      }),
      getUserData: () => userData,
      jsonCache: null,
      getDatabaseUrl: () => "",
      getApiToken: () => "",
      rendererRequests: {
        request(prefix) {
          requestedPrefixes.push(prefix);
          return {
            requestId: `${prefix}:00000000-0000-4000-8000-000000000009`,
            promise: Promise.resolve(rendererReply),
            cancel: () => {},
          };
        },
      },
    }
  );
});

afterAll(async () => {
  await fs.rm(mocks.root, { recursive: true, force: true });
  mocks.root = "";
});

beforeEach(() => {
  rendererReply = { ...ITEMS };
  userData = {
    modules: {
      media_library: {
        playlist: [
          { id: "file_1", name: "Culto.jpg", path: "/x/culto.jpg", type: "image" },
          { id: "file_2", name: "ensaio.mp4", path: "/x/ensaio.mp4", type: "video" },
        ],
      },
    },
  };
  requestedPrefixes.length = 0;
  enviados.length = 0;
});

describe("permission media_library", () => {
  it("GET sem a permission leva 403", async () => {
    const res = await callGet("/api/media-library", { action: "library" }, SEM_PERMISSAO);
    expect(res.code).toBe(403);
  });

  it("POST sem a permission leva 403", async () => {
    const res = await callPost("/api/media-library", { action: "playlist", command: "play" }, SEM_PERMISSAO);
    expect(res.code).toBe(403);
  });

  it("upload sem a permission leva 403", async () => {
    const res = await callUpload([Buffer.from("x")], { "x-file-name": "a.jpg" }, SEM_PERMISSAO);
    expect(res.code).toBe(403);
  });

  it("root passa sem a permission específica", async () => {
    rendererReply = { ...ITEMS };
    const res = await callGet("/api/media-library", { action: "library" }, { authInfo: { permissions: ["root"] } });
    expect(res.code).toBe(200);
  });

  it("sem authInfo (token global/localhost) passa", async () => {
    const res = await callGet("/api/media-library", { action: "library" });
    expect(res.code).toBe(200);
  });
});

describe("GET /api/media-library", () => {
  it("library devolve itens+categorias com o prefixo de requestId", async () => {
    const res = await callGet("/api/media-library", { action: "library" }, COM_PERMISSAO);

    expect(res.code).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(requestedPrefixes).toEqual(["media-library"]);
  });

  it("action inválida leva 400 com a lista", async () => {
    const res = await callGet("/api/media-library", { action: "delete" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
    expect(res.body.valid).toContain("canva");
  });

  it("canva devolve a página do Canva", async () => {
    rendererReply = { ...CANVA };
    const res = await callGet(
      "/api/media-library",
      { action: "canva", folderId: "root", continuation: "abc" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(res.body.continuation).toBe("next-page");
    expect(res.body.cached.d1).toBe(10);
    expect(res.body.items[0].type).toBe("design");
  });

  it("canva com erro do renderer devolve 502 com a mensagem real", async () => {
    rendererReply = { status: "error", error: "Canva desconectado" };

    const res = await callGet("/api/media-library", { action: "canva" }, COM_PERMISSAO);

    expect(res.code).toBe(502);
    expect(res.body.error).toBe("Canva desconectado");
  });

  it("image com URL http redireciona (thumb público)", async () => {
    const res = await callGet(
      "/api/media-library",
      { action: "image", url: encodeURIComponent("https://canva.com/x.jpg") },
      COM_PERMISSAO
    );

    expect(res.code).toBe(302);
    expect(res.body).toBeUndefined();
  });

  it("image sem url leva 400", async () => {
    const res = await callGet("/api/media-library", { action: "image" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });
});

describe("POST /api/media-library", () => {
  it("project sem id leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "project" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("project com renderer ok devolve 200", async () => {
    rendererReply = { status: "ok" };
    const res = await callPost("/api/media-library", { action: "project", id: "file_1" }, COM_PERMISSAO);

    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "ok", action: "project" });
  });

  it("project com renderer em erro devolve 404", async () => {
    rendererReply = { status: "error", error: "Item não encontrado na biblioteca" };
    const res = await callPost("/api/media-library", { action: "project", id: "x" }, COM_PERMISSAO);

    expect(res.code).toBe(404);
    expect(res.body.error).toContain("não encontrado");
  });

  it("canva-project dispara o comando sem round-trip", async () => {
    const res = await callPost("/api/media-library", { action: "canva-project", designId: "d1" }, COM_PERMISSAO);

    expect(res.code).toBe(200);
    expect(enviados[0][1]).toEqual({ action: "canva-project", designId: "d1", kind: "design" });
    expect(requestedPrefixes).toEqual([]);
  });

  it("canva-project sem designId leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "canva-project" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("playlist play/next/prev/stop disparam o comando", async () => {
    for (const command of ["play", "next", "prev", "stop"]) {
      const res = await callPost("/api/media-library", { action: "playlist", command }, COM_PERMISSAO);
      expect(res.code).toBe(200);
      expect(res.body.command).toBe(command);
      expect(enviados.at(-1)[1]).toEqual({ action: "playlist", command });
    }
  });

  it("command inválido leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "playlist", command: "skip" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
    expect(res.body.valid).toContain("next");
  });

  it("action inválida leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "delete" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });
});

describe("POST /api/media-library — Canva (export, cache, add-canva)", () => {
  it("canva-project manda o kind (imagem entra como JPG no modo PDF)", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "canva-project", designId: "D1", kind: "image" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(enviados.at(-1)[1]).toEqual({ action: "canva-project", designId: "D1", kind: "image" });
  });

  it("canva-export sem designId leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "canva-export" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("canva-export ok devolve cached/title/pageCount do renderer", async () => {
    rendererReply = { status: "ok", cached: true, title: "Cartaz", pageCount: 4 };

    const res = await callPost(
      "/api/media-library",
      { action: "canva-export", designId: "D1", format: "jpg" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "ok", cached: true, title: "Cartaz", pageCount: 4 });
  });

  it("canva-export com erro do renderer devolve 502 com o motivo", async () => {
    rendererReply = { status: "error", error: "O Canva recusou o download" };

    const res = await callPost(
      "/api/media-library",
      { action: "canva-export", designId: "D1" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(502);
    expect(res.body.error).toBe("O Canva recusou o download");
  });

  it("canva-clear-cache confirma pelo renderer", async () => {
    rendererReply = { status: "ok" };

    const res = await callPost(
      "/api/media-library",
      { action: "canva-clear-cache", designId: "D1" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(requestedPrefixes.at(-1)).toBe("media-library");
  });

  it("canva-clear-cache sem designId leva 400", async () => {
    const res = await callPost("/api/media-library", { action: "canva-clear-cache" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("add-canva sem designId leva 400", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "add-canva" },
      COM_PERMISSAO
    );
    expect(res.code).toBe(400);
    expect(res.body.error).toContain("designId");
  });

  it("add-canva ok devolve o item que entrou na playlist", async () => {
    rendererReply = {
      status: "ok",
      item: { id: "canva:D1", name: "Cartaz", type: "pdf" },
    };

    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "add-canva", designId: "D1", name: "Cartaz", kind: "design" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(res.body.item).toEqual({ id: "canva:D1", name: "Cartaz", type: "pdf" });
  });

  it("add-canva com erro do renderer devolve 502 com o motivo", async () => {
    rendererReply = { status: "error", error: "Falha ao exportar o design" };

    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "add-canva", designId: "D1" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(502);
    expect(res.body.error).toBe("Falha ao exportar o design");
  });
});

describe("GET /api/media-library?action=playlist", () => {
  it("serve a playlist do userData direto do main (sem round-trip)", async () => {
    const res = await callGet("/api/media-library", { action: "playlist" }, COM_PERMISSAO);

    expect(res.code).toBe(200);
    expect(res.body.items.map((item) => item.id)).toEqual(["file_1", "file_2"]);
    // Nada passou pelo renderer: é leitura de userData, não de IDB.
    expect(requestedPrefixes).toEqual([]);
  });

  it("playlist vazia devolve lista vazia (não é erro)", async () => {
    userData = { modules: { media_library: { playlist: [] } } };

    const res = await callGet("/api/media-library", { action: "playlist" }, COM_PERMISSAO);

    expect(res.code).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("sem a permission leva 403", async () => {
    const res = await callGet("/api/media-library", { action: "playlist" }, SEM_PERMISSAO);

    expect(res.code).toBe(403);
  });
});

describe("POST /api/media-library — comandos de playlist", () => {
  it("add exige id", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "add" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(400);
    expect(res.body.error).toContain("id");
  });

  it("add manda o comando com o id", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "add", id: "file_9" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(enviados.at(-1)[1]).toEqual({ action: "playlist", command: "add", id: "file_9" });
  });

  it("goto/remove exigem índice inteiro", async () => {
    for (const command of ["goto", "remove"]) {
      const res = await callPost(
        "/api/media-library",
        { action: "playlist", command, index: "zero" },
        COM_PERMISSAO
      );

      expect(res.code).toBe(400);
      expect(res.body.error).toContain("index");
    }
  });

  it("goto manda o comando com o índice", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "goto", index: 3 },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(enviados.at(-1)[1]).toEqual({ action: "playlist", command: "goto", index: 3 });
  });

  it("clear manda o comando puro", async () => {
    const res = await callPost(
      "/api/media-library",
      { action: "playlist", command: "clear" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(200);
    expect(enviados.at(-1)[1]).toEqual({ action: "playlist", command: "clear" });
  });
});

describe("POST /api/media-library/upload", () => {
  it("grava o arquivo em library/media, responde 201 e avisa o renderer", async () => {
    const res = await callUpload(
      [Buffer.from("JPEG-BYTES"), Buffer.from("-FIM")],
      { "x-file-name": encodeURIComponent("Culto.jpeg") },
      COM_PERMISSAO
    );

    expect(res.code).toBe(201);
    expect(res.body.item.type).toBe("image");
    const gravado = await fs.readFile(res.body.item.path);
    expect(gravado.toString()).toBe("JPEG-BYTES-FIM");
    // Dentro da subpasta combinada, com a extensão do nome.
    expect(res.body.item.path).toContain(`${path.sep}library${path.sep}media${path.sep}`);
    expect(res.body.item.path.endsWith(".jpeg")).toBe(true);
    // O renderer é avisado para registrar na biblioteca.
    expect(enviados.at(-1)[1]).toMatchObject({ action: "saved", record: { id: res.body.item.id } });
  });

  it("vídeo vira type video e mantém a extensão", async () => {
    const res = await callUpload(
      [Buffer.from("MP4")],
      { "x-file-name": "ensaio.MP4" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(201);
    expect(res.body.item.type).toBe("video");
    expect(res.body.item.name).toBe("ensaio.MP4");
  });

  it("extensão não suportada leva 400", async () => {
    const res = await callUpload([Buffer.from("x")], { "x-file-name": "malicioso.exe" }, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("nome com path é reduzido ao basename", async () => {
    const res = await callUpload(
      [Buffer.from("x")],
      { "x-file-name": encodeURIComponent("../../etc/passwd.jpg") },
      COM_PERMISSAO
    );

    expect(res.code).toBe(201);
    expect(res.body.item.name).toBe("passwd.jpg");
    expect(res.body.item.path.startsWith(mocks.root)).toBe(true);
  });

  it("sem X-File-Name leva 400", async () => {
    const res = await callUpload([Buffer.from("x")], {}, COM_PERMISSAO);
    expect(res.code).toBe(400);
  });

  it("renderer recusando o registro devolve 500 (arquivo gravou, IDB não)", async () => {
    rendererReply = { status: "error", error: "Falha ao registrar na biblioteca" };

    const res = await callUpload(
      [Buffer.from("x")],
      { "x-file-name": "recusado.png" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(500);
    expect(res.body.error).toBe("Falha ao registrar na biblioteca");
  });

  it("categoria vai no registro quando informada", async () => {
    const res = await callUpload(
      [Buffer.from("x")],
      { "x-file-name": "doc.pdf", "x-category-id": "cat-1" },
      COM_PERMISSAO
    );

    expect(res.code).toBe(201);
    expect(res.body.item.type).toBe("pdf");
    expect(res.body.item.categoryId).toBe("cat-1");
  });
});
