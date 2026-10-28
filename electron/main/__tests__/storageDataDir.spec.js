// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let base, oldDir, filesDir, storage, maintenanceAllowed;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-media-clean-"));
  oldDir = path.join(base, "private");
  filesDir = path.join(oldDir, "files");
  maintenanceAllowed = true;
  await fs.outputJson(path.join(oldDir, "library", "saved.json"), { collection: "library" });
  await fs.ensureDir(filesDir);
  const pathsModule = require.resolve("../paths.js");
  require.cache[pathsModule] = {
    id: pathsModule, filename: pathsModule, loaded: true,
    exports: { dataDir: () => oldDir, filesDir: () => filesDir },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "./storageAccess.js") return {
      canMaintain: () => maintenanceAllowed,
      assertMaintain: () => { if (!maintenanceAllowed) throw new Error("shared"); },
    };
    return request === "electron" ? { shell: {} } : originalLoad.call(this, request, ...args);
  };
  try {
    delete require.cache[require.resolve("../storage.js")];
    storage = require("../storage.js");
  } finally { Module._load = originalLoad; }
});

afterEach(async () => { await fs.remove(base); });

async function seedProtected() {
  await fs.outputFile(path.join(filesDir, "musics", "pt", "song.opus"), "download");
  await fs.outputFile(path.join(filesDir, "images", "slide.jpg"), "image");
  for (const relative of ["library/media/personal.mp3", "notes.txt", "musics/notes.txt", "musics/song.opus.tmp"]) {
    await fs.outputFile(path.join(filesDir, relative), "private");
  }
  const external = path.join(base, "external");
  await fs.outputFile(path.join(external, "outside.mp3"), "external");
  await fs.symlink(external, path.join(filesDir, "musics", "linked"), "junction");
  await fs.symlink(path.join(external, "outside.mp3"), path.join(filesDir, "musics", "linked.mp3"));
}

async function expectProtected() {
  for (const relative of ["library/media/personal.mp3", "notes.txt", "musics/notes.txt", "musics/song.opus.tmp"]) {
    expect(await fs.readFile(path.join(filesDir, relative), "utf8")).toBe("private");
  }
  expect(await fs.readFile(path.join(base, "external", "outside.mp3"), "utf8")).toBe("external");
  expect((await fs.lstat(path.join(filesDir, "musics", "linked"))).isSymbolicLink()).toBe(true);
  expect((await fs.lstat(path.join(filesDir, "musics", "linked.mp3"))).isSymbolicLink()).toBe(true);
}

describe("limpeza de acervo", () => {
  it("uma pasta compartilhada não sofre limpeza nem a cota de um perfil", async () => {
    await seedProtected();
    maintenanceAllowed = false;
    expect(await storage.enforceQuota(1)).toEqual({ removed: 0 });
    await expect(storage.clearFiles()).rejects.toThrow("shared");
    await expect(storage.clearUnused([])).rejects.toThrow("shared");
    await expect(storage.removeFiles(["musics/pt/song.opus"])).rejects.toThrow("shared");
    expect(await fs.readFile(path.join(filesDir, "musics", "pt", "song.opus"), "utf8")).toBe("download");
    await expectProtected();
  });

  it("limpar downloads preserva uploads, arquivos desconhecidos e links", async () => {
    await seedProtected();
    expect(await storage.clearFiles()).toEqual({ ok: true, removed: 2 });
    await expectProtected();
    expect(await fs.pathExists(path.join(filesDir, "musics", "pt", "song.opus"))).toBe(false);
  });

  it("arquivos extras e quota consideram somente o acervo oficial reconhecido", async () => {
    await seedProtected();
    expect((await storage.verify([])).extra.map((f) => f.remote).sort()).toEqual(["images/slide.jpg", "musics/pt/song.opus"]);
    expect((await storage.enforceQuota(1)).removed).toBe(2);
    await expectProtected();
  });

  it("remover caminhos explícitos também recusa pastas, links e travessia", async () => {
    await seedProtected();
    expect(await storage.removeFiles(["library/media/personal.mp3", "musics/linked/outside.mp3", "musics/linked.mp3", "musics", "../external/outside.mp3"])).toEqual({ removed: 0 });
    await expectProtected();
    expect(await storage.removeFiles(["/musics/pt/song.opus"])).toEqual({ removed: 1 });
  });

  it("não segue raiz substituída por link nem remove conteúdo externo", async () => {
    await seedProtected();
    await fs.remove(filesDir);
    await fs.symlink(path.join(base, "external"), filesDir, "junction");
    expect(await storage.clearFiles()).toEqual({ ok: true, removed: 0 });
    expect(await fs.readFile(path.join(base, "external", "outside.mp3"), "utf8")).toBe("external");
  });

  it("limpar excedentes preserva variantes reconhecidas e conteúdo privado", async () => {
    await seedProtected();
    await fs.rename(path.join(filesDir, "musics", "pt", "song.opus"), path.join(filesDir, "musics", "pt", "song.mp3"));
    expect(await storage.clearUnused([{ remote: "musics/pt/song.opus" }])).toEqual({ removed: 1 });
    expect(await fs.readFile(path.join(filesDir, "musics", "pt", "song.mp3"), "utf8")).toBe("download");
    await expectProtected();
  });
});
