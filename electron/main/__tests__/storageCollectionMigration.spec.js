// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { copyCollection, applyPendingLayout } = require("../storageCollectionMigration.js");
let root;
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-collection-copy-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.removeSync(root); });

describe("cópia de acervo no boot", () => {
  it.each([[false, true], [true, false]])("protege compartilhamento no caminho já padrão sem rebaixar a proteção (%s → %s)", (currentShared, requestedShared) => {
    const mediaDir = path.join(root, "media");
    const videosDir = path.join(root, "videos");
    fs.ensureDirSync(mediaDir); fs.ensureDirSync(videosDir);
    const current = { version: 1, mediaDir, videosDir, mediaShared: currentShared, setupCompleted: true,
      pending: { id, mediaDir, videosDir, mediaAction: "copy", videosAction: "copy", defaultMigration: true, mediaShared: requestedShared } };
    const result = applyPendingLayout(current, { profileDir: path.join(root, "profile"), programDir: path.join(root, "program") });
    expect(result.mediaShared).toBe(true);
    expect(result.pending).toBeUndefined();
    expect(require("../storageAccess.js").readMarker(mediaDir, "media").shared).toBe(true);
  });

  it("permite só o filho Acervo da antiga raiz plana e preserva seus dados privados", () => {
    const source = path.join(root, "legacy");
    const target = path.join(source, "Acervo");
    fs.outputFileSync(path.join(source, "musics", "pt", "song.mp3"), "public song");
    fs.outputFileSync(path.join(source, ".electron", "IndexedDB", "saved"), "private");
    fs.ensureDirSync(target);
    expect(() => copyCollection(source, target, "media", id)).toThrow(/dentro dela/);
    copyCollection(source, target, "media", id, { allowLegacyNested: true });
    expect(fs.readFileSync(path.join(target, "musics", "pt", "song.mp3"), "utf8")).toBe("public song");
    expect(fs.existsSync(path.join(target, ".electron"))).toBe(false);
    expect(fs.readFileSync(path.join(source, ".electron", "IndexedDB", "saved"), "utf8")).toBe("private");
    expect(() => copyCollection(source, path.join(source, "Other"), "media", id, { allowLegacyNested: true })).toThrow(/dentro dela/);
  });

  it("mantém o staging privado no mesmo volume e remove-o após publicação", () => {
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const workDir = path.join(root, "profile", "temp", "migrations");
    fs.outputFileSync(path.join(source, "musics", "pt", "song.mp3"), "song");
    fs.ensureDirSync(target);
    let observedPrivate = false;
    copyCollection(source, target, "media", id, { workDir, onProgress({ files }) {
      if (files === 1) {
        observedPrivate = fs.readdirSync(workDir).some((entry) => entry.startsWith(".louvorja-migration-"));
        expect(fs.readdirSync(target).some((entry) => entry.startsWith(".louvorja-migration-"))).toBe(false);
      }
    } });
    expect(observedPrivate).toBe(true);
    expect(fs.readdirSync(workDir)).toEqual([]);
    expect(fs.readFileSync(path.join(target, "musics", "pt", "song.mp3"), "utf8")).toBe("song");
  });

  it("usa temporário identificado no destino quando o workDir é de outro volume", () => {
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const workDir = path.join(root, "profile", "work");
    fs.outputFileSync(path.join(source, "musics", "pt", "song.mp3"), "song");
    fs.ensureDirSync(target);
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((file, ...args) => {
      const result = stat(file, ...args);
      return file === workDir ? { ...result, dev: Number(result.dev) + 1 } : result;
    });
    let observedTransient = false;
    copyCollection(source, target, "media", id, { workDir, onProgress({ files }) {
      if (files === 1) observedTransient = fs.readdirSync(target).some((entry) => entry.startsWith(".louvorja-migration-"));
    } });
    expect(observedTransient).toBe(true);
    expect(fs.readdirSync(target)).toEqual(["musics"]);
  });

  it("no Windows cria o transitório no destino para herdar sua ACL", () => {
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const workDir = path.join(root, "profile", "work");
    fs.outputFileSync(path.join(source, "musics", "pt", "song.mp3"), "song");
    fs.ensureDirSync(target);
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const systemCopy = vi.spyOn(fs, "copyFileSync").mockImplementation(() => { throw new Error("CopyFile não deve copiar descritores de segurança"); });
    let observedTransient = false;
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      copyCollection(source, target, "media", id, { workDir, onProgress({ files }) {
        if (files === 1) observedTransient = fs.readdirSync(target).some((entry) => entry.startsWith(".louvorja-migration-"));
      } });
    } finally { Object.defineProperty(process, "platform", platform); }
    expect(observedTransient).toBe(true);
    expect(systemCopy).not.toHaveBeenCalled();
    expect(fs.readdirSync(target)).toEqual(["musics"]);
    expect(fs.readdirSync(workDir)).toEqual([]);
    expect(fs.readFileSync(path.join(target, "musics", "pt", "song.mp3"), "utf8")).toBe("song");
  });
});
