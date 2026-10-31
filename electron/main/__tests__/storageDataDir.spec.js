// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { listLegacyMediaEntries, migrateLegacyMedia } = require("../mediaMigration.js");
let base, oldDir, targetDir, currentDir, storage, setDataDir;
const collections = ["files", "storage", "library", "Videos", "json_db", "bin", "server"];

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-data-move-"));
  oldDir = path.join(base, "old");
  targetDir = path.join(base, "new");
  currentDir = oldDir;
  for (const sub of collections) {
    await fs.outputJson(path.join(oldDir, sub, "saved.json"), { collection: sub });
  }
  setDataDir = vi.fn((dir) => { currentDir = dir; });
  const pathsModule = require.resolve("../paths.js");
  require.cache[pathsModule] = {
    id: pathsModule,
    filename: pathsModule,
    loaded: true,
    exports: { dataDir: () => currentDir, setDataDir },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
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
  vi.restoreAllMocks();
  await fs.remove(base);
});

async function expectOriginals() {
  expect(currentDir).toBe(oldDir);
  for (const sub of collections) {
    expect(await fs.readJson(path.join(oldDir, sub, "saved.json"))).toEqual({ collection: sub });
  }
}

describe("storage.setDataDir", () => {
  it("move mídia, preferências e biblioteca para um destino existente sem conflitos", async () => {
    await fs.outputFile(path.join(targetDir, "unrelated.txt"), "preserve");
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).resolves.toEqual({ ok: true, dir: targetDir });
    expect(currentDir).toBe(targetDir);
    for (const sub of collections) {
      expect(await fs.readJson(path.join(targetDir, sub, "saved.json"))).toEqual({ collection: sub });
      expect(await fs.pathExists(path.join(oldDir, sub))).toBe(false);
    }
    expect(await fs.readFile(path.join(targetDir, "unrelated.txt"), "utf8")).toBe("preserve");
  });

  it("detecta conflito na biblioteca antes de mover qualquer pasta", async () => {
    await fs.outputJson(path.join(targetDir, "library", "saved.json"), { collection: "existing" });
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow('já contém "library"');
    await expectOriginals();
    expect(await fs.readJson(path.join(targetDir, "library", "saved.json"))).toEqual({ collection: "existing" });
    expect(await fs.pathExists(path.join(targetDir, "files"))).toBe(false);
  });

  it("detecta conflito nos vídeos antes de mover mídia ou preferências", async () => {
    await fs.outputFile(path.join(targetDir, "Videos", "existing.mp4"), "preserve");
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow('já contém "Videos"');
    await expectOriginals();
  });

  it("leva os caches de configuração e diagnóstico e agenda o perfil para o próximo boot", async () => {
    await fs.outputJson(path.join(oldDir, "configweb.json"), { api: "cached" });
    await fs.outputFile(path.join(oldDir, "runtime-incidents.json.bak"), "backup");
    await fs.outputFile(path.join(oldDir, ".electron", "IndexedDB", "saved"), "open profile");
    await storage.setDataDir(targetDir, { moveExisting: true });
    expect(setDataDir).toHaveBeenCalledWith(targetDir, { moveExisting: true });
    expect(await fs.readJson(path.join(targetDir, "configweb.json"))).toEqual({ api: "cached" });
    expect(await fs.readFile(path.join(targetDir, "runtime-incidents.json.bak"), "utf8")).toBe("backup");
    expect(await fs.readFile(path.join(oldDir, ".electron", "IndexedDB", "saved"), "utf8")).toBe("open profile");
  });

  it("restaura pastas já movidas se o movimento da biblioteca falhar", async () => {
    const move = fs.move;
    vi.spyOn(fs, "move").mockImplementation((from, to, options) => {
      if (from === path.join(oldDir, "library")) return Promise.reject(new Error("locked"));
      return move(from, to, options);
    });
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow("locked");
    await expectOriginals();
    expect(setDataDir).not.toHaveBeenCalled();
  });

  it("restaura todas as pastas se a atualização da âncora falhar", async () => {
    setDataDir.mockImplementation(() => { throw new Error("anchor locked"); });
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow("anchor locked");
    await expectOriginals();
  });

  it("preserva conflito surgido durante a operação e reverte movimentos anteriores", async () => {
    const move = fs.move;
    vi.spyOn(fs, "move").mockImplementation(async (from, to, options) => {
      if (from === path.join(oldDir, "library")) await fs.outputFile(path.join(to, "cloud.txt"), "new");
      return move(from, to, options);
    });
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow();
    await expectOriginals();
    expect(await fs.readFile(path.join(targetDir, "library", "cloud.txt"), "utf8")).toBe("new");
  });

  it("reporta caminho recuperável se uma restauração também falhar", async () => {
    const move = fs.move;
    vi.spyOn(fs, "move").mockImplementation((from, to, options) => {
      if (from === path.join(oldDir, "library") || from === path.join(targetDir, "storage")) {
        return Promise.reject(new Error("locked"));
      }
      return move(from, to, options);
    });
    await expect(storage.setDataDir(targetDir, { moveExisting: true })).rejects.toThrow(path.join(targetDir, "storage"));
    expect(currentDir).toBe(oldDir);
    expect(await fs.readJson(path.join(targetDir, "storage", "saved.json"))).toEqual({ collection: "storage" });
    expect(await fs.readJson(path.join(oldDir, "library", "saved.json"))).toEqual({ collection: "library" });
  });

  it("rejeita destino dentro da raiz atual antes de mover dados", async () => {
    await expect(storage.setDataDir(path.join(oldDir, "nested"), { moveExisting: true })).rejects.toThrow("dentro dela");
    await expectOriginals();
  });

  it("mantém os arquivos ao apenas selecionar outra raiz", async () => {
    await storage.setDataDir(targetDir);
    expect(currentDir).toBe(targetDir);
    expect(await fs.pathExists(path.join(oldDir, "library", "saved.json"))).toBe(true);
    expect(await fs.pathExists(path.join(targetDir, "library"))).toBe(false);
  });

  it("não move nada quando o destino é a própria raiz", async () => {
    await storage.setDataDir(oldDir, { moveExisting: true });
    await expectOriginals();
    expect(setDataDir).not.toHaveBeenCalled();
  });
});

describe("migração de mídia no boot", () => {
  it("não trata documentos modernos como mídia legada quando files está vazio", async () => {
    await fs.emptyDir(path.join(oldDir, "files"));
    expect(await listLegacyMediaEntries(oldDir)).toEqual([]);
    expect(await fs.readJson(path.join(oldDir, "library", "saved.json"))).toEqual({ collection: "library" });
    await fs.outputFile(path.join(oldDir, "musicas", "track.mp3"), "audio");
    expect(await listLegacyMediaEntries(oldDir)).toEqual(["musicas"]);
  });

  it("recolhe o acervo da primeira pasta antiga que tiver mídia, sem sobrescrever", async () => {
    const target = path.join(targetDir, "files");
    const denied = path.join(base, "Documents sem permissão");
    await fs.outputFile(path.join(oldDir, "musicas", "track.mp3"), "audio");
    await fs.outputFile(path.join(oldDir, "capas", "cover.jpg"), "cover");
    await fs.outputFile(path.join(denied, "musicas", "hidden.mp3"), "hidden");
    await fs.chmod(denied, 0o000);
    let result;
    try {
      result = await migrateLegacyMedia(target, [denied, oldDir]);
    } finally {
      await fs.chmod(denied, 0o755);
    }
    expect(result).toEqual({ origem: oldDir, movidos: 2 });
    expect(await fs.readFile(path.join(target, "musicas", "track.mp3"), "utf8")).toBe("audio");
    expect(await fs.pathExists(path.join(oldDir, "capas"))).toBe(false);
  });

  it("não procura pastas antigas quando a pasta de dados já tem acervo", async () => {
    const target = path.join(targetDir, "files");
    await fs.outputFile(path.join(target, "musicas", "current.mp3"), "current");
    await fs.outputFile(path.join(oldDir, "musicas", "track.mp3"), "audio");
    const stat = vi.spyOn(fs, "stat");
    expect(await migrateLegacyMedia(target, [oldDir])).toBeNull();
    expect(stat.mock.calls.map(([dir]) => dir)).toEqual([target]);
    expect(await fs.pathExists(path.join(oldDir, "musicas", "track.mp3"))).toBe(true);
  });
});
