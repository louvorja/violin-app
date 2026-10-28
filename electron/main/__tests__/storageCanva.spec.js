// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * O cache de export do Canva mora no perfil privado; o acervo é compartilhado.
 *
 * Estes testes fixam o que separa um do outro: contagem própria em
 * Armazenamento e nenhuma limpeza do acervo (`clearFiles`, `enforceQuota`,
 * `clearUnused`) alcançando o cache — apagá-lo forçaria reexportar, gastando
 * cota do Canva.
 */
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let base, mediaDir, canvaDir, storage;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-canva-"));
  mediaDir = path.join(base, "Acervo");
  canvaDir = path.join(base, "profile", "canva");
  await fs.ensureDir(mediaDir);
  const pathsModule = require.resolve("../paths.js");
  require.cache[pathsModule] = {
    id: pathsModule,
    filename: pathsModule,
    loaded: true,
    exports: {
      dataDir: () => path.join(base, "profile"),
      dataDirIssue: () => null,
      profileRestartRequired: () => false,
      filesDir: () => mediaDir,
      videosDir: () => path.join(base, "Videos"),
      canvaDir: () => canvaDir,
      jsonCacheDir: () => path.join(base, "profile", "json_db"),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
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
  vi.restoreAllMocks();
  await fs.remove(base);
});

const midia = (rel, bytes) => fs.outputFile(path.join(mediaDir, rel), "x".repeat(bytes));
const canva = (rel, bytes) => fs.outputFile(path.join(canvaDir, rel), "x".repeat(bytes));
const SONG = "musics/pt/song.opus";

async function cacheCanva() {
  await canva("D1.pdf", 100);
  await canva("D1.pdf.json", 5);
}

async function expectCanvaIntact() {
  expect(await fs.pathExists(path.join(canvaDir, "D1.pdf"))).toBe(true);
  expect(await fs.pathExists(path.join(canvaDir, "D1.pdf.json"))).toBe(true);
}

describe("storage.stats — o cache do Canva é categoria própria", () => {
  it("conta o Canva do perfil à parte do acervo, pela apresentação e não pelo meta", async () => {
    await midia(SONG, 10);
    await cacheCanva();

    const stats = await storage.stats();

    expect(stats.files).toEqual({ bytes: 10, count: 1 });
    expect(stats.canva).toEqual({ bytes: 105, count: 1 });
    expect(stats.total).toEqual({ bytes: 115, count: 2 });
  });

  it("sem cache do Canva a categoria zera, sem quebrar a soma", async () => {
    await midia(SONG, 10);

    const stats = await storage.stats();

    expect(stats.canva).toEqual({ bytes: 0, count: 0 });
    expect(stats.total.bytes).toBe(10);
  });
});

describe("limpezas do acervo nunca alcançam o cache do Canva", () => {
  it("clearFiles apaga a mídia e preserva o Canva", async () => {
    await midia(SONG, 10);
    await cacheCanva();

    await expect(storage.clearFiles()).resolves.toMatchObject({ ok: true, removed: 1 });

    expect(await fs.pathExists(path.join(mediaDir, SONG))).toBe(false);
    await expectCanvaIntact();
  });

  it("enforceQuota remove só o acervo, mesmo com o Canva grande", async () => {
    await canva("D1.pdf", 5000);
    await canva("D1.pdf.json", 5);
    await midia(SONG, 100);

    const r = await storage.enforceQuota(50);

    expect(r.removed).toBe(1);
    await expectCanvaIntact();
  });

  it("verify e clearUnused não tratam o Canva como sobra", async () => {
    await cacheCanva();
    await midia(SONG, 10);

    const { extra } = await storage.verify([]);
    expect(extra.map((f) => f.remote)).toEqual([SONG]);
    expect(await storage.clearUnused([])).toEqual({ removed: 1 });
    await expectCanvaIntact();
  });
});
