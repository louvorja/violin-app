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

  it("guarda de lado um perfil que surgiu no destino e conclui a mudança sem apagar nenhum", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sourceDir = path.join(root, "old-data", ".electron");
    const targetDir = path.join(target, ".electron");
    await fs.outputFile(path.join(sourceDir, "IndexedDB", "offline"), "mine");
    await fs.outputFile(path.join(targetDir, "IndexedDB", "offline"), "other computer");
    expect(prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).toBe(targetDir);
    expect(await fs.readFile(path.join(targetDir, "IndexedDB", "offline"), "utf8")).toBe("mine");
    const aside = (await fs.readdir(target)).filter((name) => name.startsWith(".electron.conflito-"));
    expect(aside).toHaveLength(1);
    expect(await fs.readFile(path.join(target, aside[0], "IndexedDB", "offline"), "utf8")).toBe("other computer");
  });

  it("abre no perfil antigo quando a mudança falha e conclui no boot seguinte", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sourceDir = path.join(root, "old-data", ".electron");
    const targetDir = path.join(target, ".electron");
    await fs.outputFile(path.join(sourceDir, "IndexedDB", "offline"), "database");
    const move = fs.moveSync;
    const spy = vi.spyOn(fs, "moveSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    });
    expect(prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).toBe(sourceDir);
    expect(await fs.readFile(path.join(sourceDir, "IndexedDB", "offline"), "utf8")).toBe("database");
    expect(await fs.pathExists(targetDir)).toBe(false);
    spy.mockImplementation(move);
    expect(prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).toBe(targetDir);
    expect(await fs.readFile(path.join(targetDir, "IndexedDB", "offline"), "utf8")).toBe("database");
  });

  it("abre com perfil novo quando o antigo foi apagado à mão", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sourceDir = path.join(root, "deleted", ".electron");
    const targetDir = path.join(target, ".electron");
    expect(prepareProfile({ legacyDir: legacy, sourceDir, targetDir })).toBe(targetDir);
    expect(await fs.pathExists(targetDir)).toBe(true);
  });

  it("abre no perfil das versões antigas quando uma entrada não muda e retoma depois", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.outputFile(path.join(legacy, "IndexedDB", "offline"), "database");
    await fs.outputFile(path.join(legacy, "Local Storage", "leveldb"), "local");
    const profile = path.join(target, ".electron");
    const move = fs.moveSync;
    const spy = vi.spyOn(fs, "moveSync").mockImplementation((from, ...rest) => {
      if (path.basename(from) === "IndexedDB") throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return move(from, ...rest);
    });
    expect(prepareProfile({ legacyDir: legacy, targetDir: profile })).toBe(legacy);
    expect(await fs.readFile(path.join(legacy, "IndexedDB", "offline"), "utf8")).toBe("database");
    spy.mockImplementation(move);
    expect(prepareProfile({ legacyDir: legacy, targetDir: profile })).toBe(profile);
    expect(await fs.readFile(path.join(profile, "IndexedDB", "offline"), "utf8")).toBe("database");
    expect(await fs.readFile(path.join(profile, "Local Storage", "leveldb"), "utf8")).toBe("local");
  });
});

describe("downloads de vídeo", () => {
  it("preserva vídeos offline, marcas de manter e retomada de downloads parciais", async () => {
    const source = path.join(legacy, "online_videos");
    const videos = path.join(target, "Videos");
    await fs.outputFile(path.join(source, `${A}.mp4`), "video");
    await fs.outputFile(path.join(source, `${A}.keep`), "");
    await fs.outputFile(path.join(source, ".partial", B, "video.mp4.part"), "partial");
    await fs.outputFile(path.join(source, ".stream", B, "video"), "temporary track");
    await fs.outputFile(path.join(source, ".ytdlp-cache", "metadata.json"), "cache");
    await fs.outputFile(path.join(source, "unrelated.txt"), "preserve");
    await migrateDownloads(source, videos);
    const store = createStore(videos);
    expect(store.has(A)).toBe(true);
    expect(store.isKept(A)).toBe(true);
    expect(await fs.readFile(path.join(store.partialDirFor(B), "video.mp4.part"), "utf8")).toBe("partial");
    expect(await fs.pathExists(path.join(source, `${A}.mp4`))).toBe(false);
    expect(await fs.readFile(path.join(videos, ".ytdlp-cache", "metadata.json"), "utf8")).toBe("cache");
    expect(await fs.pathExists(path.join(source, ".stream", B, "video"))).toBe(false);
    expect(await fs.readFile(path.join(source, "unrelated.txt"), "utf8")).toBe("preserve");
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
