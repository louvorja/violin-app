// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { DATA_ENTRIES, migrateLegacyData, prepareProfile } = require("../dataMigration.js");
const { migrateDownloads } = require("../onlineVideo/migration.js");
const { createStore } = require("../onlineVideo/store.js");
let root, legacy, target;
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-central-data-"));
  legacy = path.join(root, "appData");
  target = path.join(root, "Documents", "LouvorJA Violin");
});
afterEach(async () => { vi.restoreAllMocks(); await fs.remove(root); });

describe("centralização dos dados existentes", () => {
  it("leva todos os dados conhecidos sem alterar arquivos do perfil nem a âncora", async () => {
    for (const entry of DATA_ENTRIES) {
      const file = entry.endsWith(".json") ? entry : path.join(entry, "saved.json");
      await fs.outputFile(path.join(legacy, file), entry);
    }
    await fs.outputFile(path.join(legacy, "IndexedDB", "offline"), "browser");
    await fs.outputFile(path.join(legacy, "data-location.json"), "anchor");
    await migrateLegacyData(legacy, target);
    for (const entry of DATA_ENTRIES) {
      const file = entry.endsWith(".json") ? entry : path.join(entry, "saved.json");
      expect(await fs.readFile(path.join(target, file), "utf8")).toBe(entry);
      expect(await fs.pathExists(path.join(legacy, file))).toBe(false);
    }
    expect(await fs.readFile(path.join(legacy, "IndexedDB", "offline"), "utf8")).toBe("browser");
    expect(await fs.readFile(path.join(legacy, "data-location.json"), "utf8")).toBe("anchor");
  });

  it("mescla cache ausente sem sobrescrever destinos e pode ser repetida", async () => {
    await fs.outputFile(path.join(legacy, "json_db", "present.json"), "old");
    await fs.outputFile(path.join(legacy, "json_db", "missing.json"), "missing");
    await fs.outputFile(path.join(target, "json_db", "present.json"), "current");
    await migrateLegacyData(legacy, target);
    await migrateLegacyData(legacy, target);
    expect(await fs.readFile(path.join(target, "json_db", "present.json"), "utf8")).toBe("current");
    expect(await fs.readFile(path.join(target, "json_db", "missing.json"), "utf8")).toBe("missing");
    expect(await fs.readFile(path.join(legacy, "json_db", "present.json"), "utf8")).toBe("old");
  });

  it("não percorre links na origem ou no destino", async () => {
    const outside = path.join(root, "outside");
    await fs.outputFile(path.join(outside, "saved"), "preserve");
    await fs.ensureDir(legacy);
    await fs.symlink(outside, path.join(legacy, "json_db"), "dir");
    await fs.outputFile(path.join(legacy, "bin", "tool"), "tool");
    await fs.ensureDir(target);
    await fs.symlink(outside, path.join(target, "bin"), "dir");
    await migrateLegacyData(legacy, target);
    expect(await fs.pathExists(path.join(target, "json_db"))).toBe(false);
    expect(await fs.pathExists(path.join(outside, "tool"))).toBe(false);
    expect(await fs.readFile(path.join(outside, "saved"), "utf8")).toBe("preserve");
  });
});

describe("perfil Electron", () => {
  it("migra IndexedDB e cookies antes do uso, deixando locks e dados do produto fora", async () => {
    await fs.outputFile(path.join(legacy, "IndexedDB", "offline"), "database");
    await fs.outputFile(path.join(legacy, "Cookies"), "cookies");
    await fs.outputFile(path.join(legacy, "SingletonLock"), "lock");
    await fs.outputFile(path.join(legacy, "bin", "tool"), "tool");
    const profile = path.join(target, ".electron");
    prepareProfile({ legacyDir: legacy, targetDir: profile });
    expect(await fs.readFile(path.join(profile, "IndexedDB", "offline"), "utf8")).toBe("database");
    expect(await fs.readFile(path.join(profile, "Cookies"), "utf8")).toBe("cookies");
    expect(await fs.pathExists(path.join(profile, "SingletonLock"))).toBe(false);
    expect(await fs.pathExists(path.join(profile, "bin"))).toBe(false);
  });

  it("conclui a mudança da pasta depois de fechar o perfil e aceita o boot seguinte", async () => {
    const sourceDir = path.join(root, "old-data", ".electron");
    const targetDir = path.join(target, ".electron");
    await fs.outputFile(path.join(sourceDir, "IndexedDB", "offline"), "database");
    prepareProfile({ legacyDir: legacy, sourceDir, targetDir });
    expect(await fs.pathExists(sourceDir)).toBe(false);
    expect(await fs.readFile(path.join(targetDir, "IndexedDB", "offline"), "utf8")).toBe("database");
    // Queda entre o rename e a atualização da âncora não deve impedir o boot.
    expect(() => prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).not.toThrow();
  });

  it("recusa misturar perfis existentes sem apagar nenhuma das cópias", async () => {
    const sourceDir = path.join(root, "old-data", ".electron");
    const targetDir = path.join(target, ".electron");
    await fs.outputFile(path.join(sourceDir, "IndexedDB", "offline"), "old");
    await fs.outputFile(path.join(targetDir, "IndexedDB", "offline"), "current");
    expect(() => prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).toThrow("já contém um perfil");
    expect(await fs.readFile(path.join(sourceDir, "IndexedDB", "offline"), "utf8")).toBe("old");
    expect(await fs.readFile(path.join(targetDir, "IndexedDB", "offline"), "utf8")).toBe("current");
  });
});

describe("downloads de vídeo", () => {
  it("não publica uma cópia incompleta e permite repetir sem apagar a origem", async () => {
    const source = path.join(legacy, "online_videos");
    const videos = path.join(target, "Videos");
    const workDir = path.join(target, "private-video-work");
    await fs.outputFile(path.join(source, `${A}.mp4`), "complete original");
    const copy = vi.spyOn(fs, "copyFileSync").mockImplementationOnce((_from, to) => fs.writeFileSync(to, "short"));
    await expect(migrateDownloads(source, videos, { workDir })).rejects.toThrow("verificada");
    expect(await fs.pathExists(path.join(videos, `${A}.mp4`))).toBe(false);
    expect(await fs.pathExists(path.join(workDir, ".legacy-downloads-v1.json"))).toBe(false);
    expect(await fs.readFile(path.join(source, `${A}.mp4`), "utf8")).toBe("complete original");
    copy.mockRestore();
    await migrateDownloads(source, videos, { workDir });
    expect(await fs.readFile(path.join(videos, `${A}.mp4`), "utf8")).toBe("complete original");
  });

  it("preserva vídeos offline, marcas de manter e retomada de downloads parciais", async () => {
    const source = path.join(legacy, "online_videos");
    const videos = path.join(target, "Videos");
    const workDir = path.join(target, "private-video-work");
    await fs.outputFile(path.join(source, `${A}.mp4`), "video");
    await fs.outputFile(path.join(source, `${A}.keep`), "");
    await fs.outputFile(path.join(source, ".partial", B, "video.mp4.part"), "partial");
    await fs.outputFile(path.join(source, ".stream", B, "video"), "temporary track");
    await fs.outputFile(path.join(source, ".ytdlp-cache", "metadata.json"), "cache");
    await fs.outputFile(path.join(source, "unrelated.txt"), "preserve");
    await migrateDownloads(source, videos, { workDir });
    const store = createStore(videos, { workDir });
    expect(store.has(A)).toBe(true);
    expect(store.isKept(A)).toBe(true);
    expect(await fs.readFile(path.join(store.partialDirFor(B), "video.mp4.part"), "utf8")).toBe("partial");
    expect(await fs.readFile(path.join(source, `${A}.mp4`), "utf8")).toBe("video");
    expect(await fs.readFile(path.join(source, `${A}.keep`), "utf8")).toBe("");
    expect(await fs.readFile(path.join(source, ".partial", B, "video.mp4.part"), "utf8")).toBe("partial");
    expect(await fs.readFile(path.join(workDir, ".ytdlp-cache", "metadata.json"), "utf8")).toBe("cache");
    expect(await fs.readFile(path.join(source, ".stream", B, "video"), "utf8")).toBe("temporary track");
    expect(await fs.pathExists(path.join(videos, ".partial"))).toBe(false);
    expect(await fs.readFile(path.join(source, "unrelated.txt"), "utf8")).toBe("preserve");
  });

  it("não restaura vídeos excluídos nem reimporta a origem ao trocar a pasta", async () => {
    const source = path.join(legacy, "online_videos");
    const videos = path.join(target, "Videos");
    const workDir = path.join(target, "private-video-work");
    await fs.outputFile(path.join(source, `${A}.mp4`), "original");
    await migrateDownloads(source, videos, { workDir });
    await fs.remove(path.join(videos, `${A}.mp4`));
    await migrateDownloads(source, videos, { workDir });
    expect(await fs.pathExists(path.join(videos, `${A}.mp4`))).toBe(false);
    const changed = path.join(target, "New videos");
    await migrateDownloads(source, changed, { workDir });
    expect(await fs.pathExists(path.join(changed, `${A}.mp4`))).toBe(false);
    expect(await fs.readFile(path.join(source, `${A}.mp4`), "utf8")).toBe("original");
  });

  it("não sobrescreve vídeos existentes e mantém a proteção offline", async () => {
    const source = path.join(legacy, "online_videos");
    const videos = path.join(target, "Videos");
    await fs.outputFile(path.join(source, `${A}.mp4`), "old");
    await fs.outputFile(path.join(source, `${A}.keep`), "");
    await fs.outputFile(path.join(videos, `${A}.mp4`), "current");
    await migrateDownloads(source, videos);
    await migrateDownloads(source, videos);
    expect(await fs.readFile(path.join(videos, `${A}.mp4`), "utf8")).toBe("current");
    expect(await fs.readFile(path.join(source, `${A}.mp4`), "utf8")).toBe("old");
    expect(createStore(videos).isKept(A)).toBe(true);
  });
});
