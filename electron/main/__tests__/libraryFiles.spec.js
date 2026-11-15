// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const fs = require("fs-extra");
const paths = require("../paths.js");
const storageAccess = require("../storageAccess.js");

const electronMock = {
  app: { getPath: () => os.tmpdir() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
};

const libraryFiles = require("../libraryFiles.js");

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
});
