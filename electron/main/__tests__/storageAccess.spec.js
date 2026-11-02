// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const access = require("../storageAccess.js");
let root, media, videos;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-access-"));
  media = path.join(root, "media"); videos = path.join(root, "videos");
  fs.ensureDirSync(media); fs.ensureDirSync(videos);
});
afterEach(() => { access.release(); vi.restoreAllMocks(); vi.useRealTimers(); fs.removeSync(root); });
const layout = (extras = {}) => ({ mediaDir: media, videosDir: videos, ...extras });

describe("permissão de escrita e metadado compartilhado", () => {
  it("preserva kind e grava metadado legível por outras contas, mantendo manutenção desativada", () => {
    access.initialize(layout({ mediaShared: true, videosShared: true }));
    for (const [kind, dir] of [["media", media], ["videos", videos]]) {
      const file = path.join(dir, ".louvorja-collection.json");
      expect(fs.readJsonSync(file)).toEqual({ version: 1, kind, shared: true });
      if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o644);
      expect(access.canWrite(kind)).toBe(true);
      expect(access.canMaintain(kind)).toBe(false);
    }
  });

  it("não volta a pessoal quando outra conta marca shared e atualiza o status do escritor", () => {
    access.initialize(layout());
    expect(access.canMaintain("media")).toBe(true);
    access.markShared(media, "media");
    expect(access.canMaintain("media")).toBe(false);
    expect(access.status().media.shared).toBe(true);
    access.initialize(layout());
    expect(access.readMarker(media, "media").shared).toBe(true);
    expect(access.canMaintain("media")).toBe(false);
  });

  it("permite consultar um acervo já compartilhado sem tentar escrever o marcador", () => {
    fs.writeJsonSync(path.join(media, ".louvorja-collection.json"), { version: 1, kind: "media", shared: true });
    const write = vi.spyOn(fs, "writeJsonSync").mockImplementation(() => { throw new Error("read only"); });
    expect(() => access.markShared(media, "media")).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("não obtém permissão de escrita com marcador inválido ou de outro tipo", () => {
    fs.writeJsonSync(path.join(media, ".louvorja-collection.json"), { version: 1, kind: "videos", shared: true });
    access.initialize(layout());
    expect(access.canWrite("media")).toBe(false);
    expect(access.canMaintain("media")).toBe(false);
    expect(access.canWrite("videos")).toBe(true);
  });

  it("nega escrita imediatamente quando a raiz desaparece sem recriá-la", () => {
    access.initialize(layout());
    expect(access.canWrite("media")).toBe(true);
    fs.removeSync(media);
    expect(access.canWrite("media")).toBe(false);
    expect(access.canMaintain("media")).toBe(false);
    expect(() => access.assertWritable("media")).toThrow(/somente para leitura/);
    expect(access.status().media).toMatchObject({ writable: false, reason: "unavailable" });
    expect(fs.existsSync(media)).toBe(false);
    expect(access.canWrite("videos")).toBe(true);
  });

  it("não confunde outra raiz no mesmo caminho nem remove o lease de outro escritor", () => {
    access.initialize(layout());
    fs.renameSync(media, `${media}-original`);
    fs.ensureDirSync(path.join(media, ".louvorja-writer.lock"));
    expect(access.canWrite("media")).toBe(false);
    access.release();
    expect(fs.lstatSync(path.join(media, ".louvorja-writer.lock")).isDirectory()).toBe(true);
  });

  it("nega escrita quando somente o lease foi substituído e preserva a nova proteção", () => {
    access.initialize(layout());
    const lock = path.join(media, ".louvorja-writer.lock");
    fs.renameSync(lock, path.join(media, ".old-lock"));
    fs.mkdirSync(lock);
    expect(access.canWrite("media")).toBe(false);
    access.release();
    expect(fs.lstatSync(lock).isDirectory()).toBe(true);
  });

  it("mantém heartbeat do escritor após gravar metadados com um lease independente", () => {
    vi.useFakeTimers();
    access.initialize(layout());
    access.markShared(media, "media");
    expect(() => vi.advanceTimersByTime(20001)).not.toThrow();
    expect(access.canWrite("media")).toBe(true);
    expect(access.canWrite("videos")).toBe(true);
    expect(access.canMaintain("media")).toBe(false);
  });
});
