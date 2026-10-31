// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * `<dados>/pptx` guarda os PDFs gerados a partir de PowerPoint, fora de `files/`.
 * A Biblioteca de Mídia aponta para eles, e eles não vêm do servidor: nenhuma
 * limpeza do acervo baixado (clearFiles, clearUnused, enforceQuota) pode alcançá-los.
 */
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let base, filesDir, storage;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-pptx-"));
  filesDir = path.join(base, "files");
  const pathsModule = require.resolve("../paths.js");
  require.cache[pathsModule] = {
    id: pathsModule,
    filename: pathsModule,
    loaded: true,
    exports: {
      dataDir: () => base,
      dataDirIssue: () => null,
      profileRestartRequired: () => false,
      filesDir: () => filesDir,
      videosDir: () => path.join(base, "Videos"),
      canvaDir: () => path.join(base, "canva"),
      jsonCacheDir: () => path.join(base, "json_db"),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    // Com o acervo compartilhado, limpar exige ser o escritor da pasta.
    if (request === "./storageAccess.js") return { canMaintain: () => true, assertMaintain: () => {} };
    return request === "electron" ? { shell: {} } : originalLoad.call(this, request, ...args);
  };
  try {
    delete require.cache[require.resolve("../storage.js")];
    storage = require("../storage.js");
  } finally {
    Module._load = originalLoad;
  }
});

afterEach(async () => {
  await fs.remove(base);
});

const arquivo = (rel, bytes) => fs.outputFile(path.join(filesDir, rel), "x".repeat(bytes));
const existe = (rel) => fs.pathExists(path.join(filesDir, rel));
const PDF = "pptx/abc-123-powerpoint.pdf";
// Caminhos de mídia oficial: o acervo compartilhado só limpa o que é dele.
const MUSICA = "musics/pt/Album/musica.mp3";
const SOBRA = "musics/pt/Album/sobra.mp3";
const pdfDoOperador = () => fs.outputFile(path.join(base, PDF), "x".repeat(1000));
const pdfIntacto = () => fs.pathExists(path.join(base, PDF));

describe("storage — os PDFs de PowerPoint não são sobra do acervo", () => {
  it("clearFiles apaga o acervo e preserva <dados>/pptx", async () => {
    await arquivo(MUSICA, 10);
    await pdfDoOperador();
    await storage.clearFiles();
    expect(await existe(MUSICA)).toBe(false);
    expect(await pdfIntacto()).toBe(true);
  });

  it("clearUnused não apaga o PDF por não estar na lista do servidor", async () => {
    await arquivo(SOBRA, 10);
    await pdfDoOperador();
    await storage.clearUnused([]);
    expect(await existe(SOBRA)).toBe(false);
    expect(await pdfIntacto()).toBe(true);
  });

  it("enforceQuota não conta nem remove o PDF", async () => {
    await pdfDoOperador();
    await arquivo(MUSICA, 10);
    const r = await storage.enforceQuota(50);
    expect(r.removed).toBe(0);
    expect(await pdfIntacto()).toBe(true);
  });
});
