// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const fs = require("fs-extra");

const electronMock = {
  app: { getPath: () => os.tmpdir() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
};

const originalModuleLoad = Module._load;
Module._load = function (request, ...args) {
  return request === "electron" ? electronMock : originalModuleLoad.call(this, request, ...args);
};
let paths, storageAccess, libraryFiles;
try {
  paths = require("../paths.js");
  storageAccess = require("../storageAccess.js");
  libraryFiles = require("../libraryFiles.js");
} finally {
  Module._load = originalModuleLoad;
}

let root;
let handlers;

function fakeIpc() {
  handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
  };
}

const event = { sender: { id: 1, once: () => {} } };

function call(channel, ...args) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler ausente: ${channel}`);
  return handler(event, ...args);
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-library-files-")));
  const filesDir = path.join(root, "acervo");
  fs.ensureDirSync(filesDir);
  vi.spyOn(paths, "filesDir").mockImplementation(() => filesDir);
  vi.spyOn(storageAccess, "assertWritable").mockImplementation(() => {});
  vi.spyOn(Module, "_load").mockImplementation((request, ...args) =>
    request === "electron" ? electronMock : Module._load.wrappedMethod.call(Module, request, ...args)
  );
  libraryFiles.registerIpc(fakeIpc(), {
    dialog: electronMock.dialog,
    BrowserWindow: electronMock.BrowserWindow,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(root);
});

describe("libraryFiles", () => {
  it("saneia nomes e só aceita caminho relativo dentro das pastas gerenciadas", () => {
    expect(libraryFiles.sanitizeName('foto 13/12: "x".jpg')).toBe("foto 13_12_ _x_.jpg");
    expect(libraryFiles.isManagedRel("media-library/id-1/foto.jpg")).toBe(true);
    expect(libraryFiles.isManagedRel("media-library/../fora.jpg")).toBe(false);
    expect(libraryFiles.isManagedRel("/media-library/id/foto.jpg")).toBe(false);
    expect(libraryFiles.isManagedRel("outra/id/foto.jpg")).toBe(false);
    expect(libraryFiles.isManagedRel("media-library/id/sub/foto.jpg")).toBe(false);
  });

  it("copia um arquivo do disco para o acervo e devolve caminho relativo + hash", async () => {
    const source = path.join(root, "origem.jpg");
    fs.writeFileSync(source, "IMAGEM");
    const stored = await call("libraryFiles:storePath", {
      kind: "media",
      recordId: "file_1",
      sourcePath: source,
    });
    expect(stored.path).toBe("media-library/file_1/origem.jpg");
    expect(stored.size).toBe(6);
    expect(stored.sha256).toHaveLength(64);
    expect(fs.readFileSync(path.join(paths.filesDir(), stored.path), "utf8")).toBe("IMAGEM");
  });

  it("recusa extensão que a biblioteca não aceita", async () => {
    const source = path.join(root, "texto.txt");
    fs.writeFileSync(source, "x");
    await expect(
      call("libraryFiles:storePath", {
        kind: "background-sound",
        recordId: "s1",
        sourcePath: source,
      })
    ).rejects.toThrow("Extensão não aceita");
  });

  it("stream: begin/write/end grava e confere o tamanho declarado", async () => {
    const { token } = await call("libraryFiles:begin", {
      kind: "background-sound",
      recordId: "s2",
      name: "chuva.mp3",
      size: 4,
    });
    await call("libraryFiles:write", token, new Uint8Array([1, 2]));
    await call("libraryFiles:write", token, new Uint8Array([3, 4]));
    const done = await call("libraryFiles:end", token);
    expect(done.path).toBe("background-sound/s2/chuva.mp3");
    expect(fs.readFileSync(path.join(paths.filesDir(), done.path))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("stream: menos bytes que o declarado apaga o temporário e falha", async () => {
    const { token } = await call("libraryFiles:begin", {
      kind: "media",
      recordId: "file_2",
      name: "foto.png",
      size: 10,
    });
    await call("libraryFiles:write", token, new Uint8Array([1]));
    await expect(call("libraryFiles:end", token)).rejects.toThrow("incompleto");
    expect(fs.existsSync(path.join(paths.filesDir(), "media-library/file_2"))).toBe(true);
    expect(fs.readdirSync(path.join(paths.filesDir(), "media-library/file_2"))).toEqual([]);
  });

  it("remove só o arquivo gerenciado e a pasta vazia do registro", async () => {
    const source = path.join(root, "foto.jpg");
    fs.writeFileSync(source, "IMG");
    const stored = await call("libraryFiles:storePath", {
      kind: "media",
      recordId: "file_3",
      sourcePath: source,
    });
    await call("libraryFiles:remove", stored.path);
    expect(fs.existsSync(path.join(paths.filesDir(), stored.path))).toBe(false);
    expect(fs.existsSync(path.join(paths.filesDir(), "media-library/file_3"))).toBe(false);
    await expect(call("libraryFiles:remove", "../../etc/passwd")).rejects.toThrow(
      "fora das pastas"
    );
  });

  it("prune remove só o que não tem registro e é mais velho que a idade mínima", async () => {
    const old = path.join(paths.filesDir(), "media-library/orfao/velho.jpg");
    const kept = path.join(paths.filesDir(), "media-library/registro/atual.jpg");
    fs.outputFileSync(old, "x");
    fs.outputFileSync(kept, "y");
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(old, past, past);
    const result = await call("libraryFiles:prune", ["media-library/registro/atual.jpg"], {
      minAgeMs: 24 * 60 * 60 * 1000,
    });
    expect(result.removed).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
  });

  it("export: choose/write/end publica o arquivo no destino escolhido", async () => {
    const target = path.join(root, "Culto.llja");
    const electron = require("electron");
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const session = await call("libraryExport:choose", { suggestedName: "Culto.llja" });
    await call("libraryExport:write", session.token, new Uint8Array([80, 75]));
    const done = await call("libraryExport:end", session.token);
    expect(done.path).toBe(target);
    expect(fs.readFileSync(target)).toEqual(Buffer.from([80, 75]));
  });

  it("openRead/readChunk/closeRead lê arquivo gerenciado em streaming e recusa caminho fora do acervo", async () => {
    const rel = "media-library/vid1/cena.mp4";
    fs.outputFileSync(path.join(paths.filesDir(), rel), Buffer.from([10, 20, 30, 40, 50]));

    const opened = await call("libraryFiles:openRead", rel);
    expect(opened).toMatchObject({ size: 5 });

    const c1 = await call("libraryFiles:readChunk", opened.token, 3);
    const c2 = await call("libraryFiles:readChunk", opened.token, 3);
    const eof = await call("libraryFiles:readChunk", opened.token, 3);
    expect(Buffer.from(c1)).toEqual(Buffer.from([10, 20, 30]));
    expect(Buffer.from(c2)).toEqual(Buffer.from([40, 50]));
    expect(eof).toBeNull();
    expect(await call("libraryFiles:closeRead", opened.token)).toEqual({ ok: true });

    expect(await call("libraryFiles:openRead", "media-library/missing/x.mp4")).toBeNull();
    await expect(call("libraryFiles:openRead", "../fora.mp4")).rejects.toThrow("fora das pastas");
  });

  it("stageBegin/commitRestore/rollbackRestore publica restauração com rollback e cleanup", async () => {
    const existingRel = "background-projection/bg1/antigo.mp4";
    const addedRel = "media-library/m2/novo.jpg";
    fs.outputFileSync(path.join(paths.filesDir(), existingRel), "CONTEUDO-ANTIGO");

    const restoreToken = "550e8400-e29b-41d4-a716-446655440000";
    const s1 = await call("libraryFiles:stageBegin", {
      restoreToken,
      rel: existingRel,
      size: 12,
    });
    await call("libraryFiles:write", s1.token, new TextEncoder().encode("CONTEUDO-NEW"));
    await call("libraryFiles:end", s1.token);

    const s2 = await call("libraryFiles:stageBegin", {
      restoreToken,
      rel: addedRel,
      size: 4,
    });
    await call("libraryFiles:write", s2.token, new Uint8Array([1, 2, 3, 4]));
    await call("libraryFiles:end", s2.token);

    const { committed } = await call("libraryFiles:commitRestore", restoreToken, [
      existingRel,
      addedRel,
    ]);
    expect(committed).toEqual([
      { rel: existingRel, existed: true },
      { rel: addedRel, existed: false },
    ]);
    expect(fs.readFileSync(path.join(paths.filesDir(), existingRel), "utf8")).toBe("CONTEUDO-NEW");
    expect(fs.readFileSync(path.join(paths.filesDir(), addedRel))).toEqual(Buffer.from([1, 2, 3, 4]));

    await call("libraryFiles:rollbackRestore", restoreToken, committed);
    expect(fs.readFileSync(path.join(paths.filesDir(), existingRel), "utf8")).toBe("CONTEUDO-ANTIGO");
    expect(fs.existsSync(path.join(paths.filesDir(), addedRel))).toBe(false);

    await call("libraryFiles:cleanupRestore", restoreToken);
    expect(fs.existsSync(path.join(paths.filesDir(), ".restore-staging", restoreToken))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "publica liturgy-files e arquivos da biblioteca legíveis (0644/0777) quando o acervo é compartilhado (#17)",
    async () => {
      const prevUmask = process.umask(0o077);
      try {
        vi.spyOn(storageAccess, "status").mockReturnValue({ media: { shared: true } });
        const source = path.join(root, "anexo.pdf");
        fs.writeFileSync(source, "%PDF-1.4");
        const stored = await call("libraryFiles:storePath", {
          kind: "liturgy-files",
          recordId: "lit_1",
          sourcePath: source,
        });
        const targetAbs = path.join(paths.filesDir(), stored.path);
        const dirMode = fs.statSync(path.dirname(targetAbs)).mode & 0o777;
        const fileMode = fs.statSync(targetAbs).mode & 0o777;
        expect(dirMode).toBe(0o777);
        expect(fileMode).toBe(0o644);
      } finally {
        process.umask(prevUmask);
      }
    }
  );
});
