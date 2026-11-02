// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let root, paths, storage, access;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-storage-layout-")));
  vi.stubEnv("LJ_E2E_USER_DATA", path.join(root, "user"));
  const locations = { documents: path.join(root, "Documents"), videos: path.join(root, "Movies"), userData: path.join(root, "user") };
  const original = Module._load;
  Module._load = function (request, ...args) {
    return request === "electron" ? { app: { getPath: (n) => locations[n], setPath: (n, v) => { locations[n] = v; }, getAppPath: () => path.join(root, "program") } } : original.call(this, request, ...args);
  };
  try {
    for (const file of ["../paths.js", "../storageLocations.js", "../storageAccess.js"]) delete require.cache[require.resolve(file)];
    paths = require("../paths.js"); storage = require("../storageLocations.js"); access = require("../storageAccess.js");
    paths.configureProfile();
  } finally { Module._load = original; }
});
afterEach(() => { access.release(); vi.unstubAllEnvs(); fs.removeSync(root); });
const request = (overrides = {}) => ({ mediaDir: paths.filesDir(), videosDir: paths.videosDir(), mediaAction: "reuse", videosAction: "reuse", ...overrides });
describe("troca independente de acervo e vídeos", () => {
  it("conclui o setup com outro acervo quando o padrão da instalação nova está indisponível", async () => {
    const media = paths.filesDir(), profile = paths.profileDir(), videos = paths.videosDir();
    expect(storage.locations().setupCompleted).toBe(false);
    expect(fs.readdirSync(media)).toEqual([]);
    // rmdir só remove a raiz vazia da fixture: simula falha de criação do padrão.
    fs.rmdirSync(media);
    fs.outputFileSync(path.join(profile, "IndexedDB/db"), "private profile");
    fs.outputFileSync(path.join(videos, "abcdefghijk.mp4"), "existing video");
    access.initialize(paths.storageLayout());
    expect(storage.locations().access.media).toMatchObject({ writable: false, reason: "unavailable" });
    const destination = path.join(root, "accessible-media");
    fs.outputFileSync(path.join(destination, "musics/song.mp3"), "existing audio");

    await expect(storage.configure(request({ mediaDir: destination, mediaAction: "reuse" })))
      .resolves.toEqual({ ok: true, restartRequired: true });
    storage.completeSetup();
    expect(storage.locations().setupCompleted).toBe(true);
    expect(paths.filesDir()).toBe(media);
    access.release();
    storage.applyPending();
    access.initialize(paths.storageLayout());

    expect(storage.locations()).toMatchObject({
      setupCompleted: true, restartRequired: false, pending: null, changeError: null,
      mediaDir: destination, videosDir: videos, access: { media: { writable: true } },
    });
    expect(fs.existsSync(media)).toBe(false);
    expect(paths.profileDir()).toBe(profile);
    expect(fs.readFileSync(path.join(profile, "IndexedDB/db"), "utf8")).toBe("private profile");
    expect(fs.readFileSync(path.join(videos, "abcdefghijk.mp4"), "utf8")).toBe("existing video");
    expect(fs.readFileSync(path.join(destination, "musics/song.mp3"), "utf8")).toBe("existing audio");
  });

  it("agenda mudança sem trocar caminhos em uso; próximo boot copia apenas mídia e preserva origem", async () => {
    const media = paths.filesDir(); const profile = paths.profileDir();
    fs.outputFileSync(path.join(media, "musics/pt/song.mp3"), "audio");
    fs.outputFileSync(path.join(media, "library/media/private.mp4"), "private");
    fs.outputFileSync(path.join(media, "unknown.data"), "keep");
    fs.outputFileSync(path.join(profile, "IndexedDB/db"), "idb");
    const dest = path.join(root, "new-media");
    await expect(storage.configure(request({ mediaDir: dest, mediaAction: "copy" }))).resolves.toEqual({ ok: true, restartRequired: true });
    expect(paths.filesDir()).toBe(media);
    storage.applyPending();
    expect(storage.locations().changeError).toBeNull();
    expect(paths.filesDir()).toBe(dest);
    expect(paths.profileDir()).toBe(profile);
    expect(fs.readFileSync(path.join(dest, "musics/pt/song.mp3"), "utf8")).toBe("audio");
    expect(fs.existsSync(path.join(dest, "library"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "unknown.data"))).toBe(false);
    expect(fs.readFileSync(path.join(media, "library/media/private.mp4"), "utf8")).toBe("private");
    expect(fs.readFileSync(path.join(profile, "IndexedDB/db"), "utf8")).toBe("idb");
  });
  it("vídeos mudam sem levar temporários nem alterar acervo", async () => {
    const media = paths.filesDir(), videos = paths.videosDir();
    fs.outputFileSync(path.join(videos, "abcdefghijk.mp4"), "video");
    fs.outputFileSync(path.join(videos, "abcdefghijk.keep"), "");
    fs.outputFileSync(path.join(videos, ".partial/active"), "partial");
    const dest = path.join(root, "new-videos");
    await storage.configure(request({ videosDir: dest, videosAction: "copy" })); storage.applyPending();
    expect(paths.filesDir()).toBe(media); expect(paths.videosDir()).toBe(dest);
    expect(fs.existsSync(path.join(dest, "abcdefghijk.keep"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".partial"))).toBe(false);
    expect(fs.existsSync(path.join(videos, "abcdefghijk.mp4"))).toBe(true);
  });
  it("não importa outro perfil ao selecionar uma coleção existente", async () => {
    const dest = path.join(root, "other-account");
    fs.outputFileSync(path.join(dest, ".electron/IndexedDB/secret"), "secret");
    await expect(storage.configure(request({ mediaDir: dest }))).rejects.toThrow(/dados pessoais/);
  });
  it("recusa raízes sobrepostas, perfil, programa e links que apontam para eles", async () => {
    for (const dest of [paths.dataDir(), path.join(root, "program"), path.join(paths.videosDir(), "child")]) {
      await expect(storage.configure(request({ mediaDir: dest }))).rejects.toThrow();
    }
    if (process.platform !== "win32") {
      const alias = path.join(root, "alias"); fs.symlinkSync(paths.dataDir(), alias);
      await expect(storage.configure(request({ mediaDir: alias }))).rejects.toThrow(/perfil/);
    }
  });
  it("valida tipos e caminhos no IPC antes de gravar configuração", async () => {
    for (const input of [null, [], {}, request({ mediaDir: "relative" }), request({ videosAction: "move" }), request({ mediaDir: 1 })]) {
      await expect(storage.configure(input)).rejects.toThrow();
    }
    expect(storage.locations().pending).toBeNull();
  });
  it("falha de cópia não troca os caminhos nem sobrescreve destino e pode ser cancelada", async () => {
    const source = paths.filesDir(), dest = path.join(root, "destination");
    fs.outputFileSync(path.join(source, "musics/song.mp3"), "source");
    fs.outputFileSync(path.join(dest, "musics/song.mp3"), "different");
    await storage.configure(request({ mediaDir: dest, mediaAction: "copy" })); storage.applyPending();
    expect(paths.filesDir()).toBe(source);
    expect(storage.locations().changeError).toMatch(/diferente/);
    expect(fs.readFileSync(path.join(dest, "musics/song.mp3"), "utf8")).toBe("different");
    await expect(storage.configure(request())).resolves.toEqual({ ok: true, restartRequired: false });
    expect(storage.locations().pending).toBeNull();
  });
  it("recupera publicação parcial sem perder ou substituir arquivos", async () => {
    const source = paths.filesDir(), dest = path.join(root, "destination");
    for (const file of ["one", "two"]) fs.outputFileSync(path.join(source, `musics/${file}.mp3`), file);
    fs.outputFileSync(path.join(dest, "musics/one.mp3"), "one");
    await storage.configure(request({ mediaDir: dest, mediaAction: "copy" })); storage.applyPending();
    expect(paths.filesDir()).toBe(dest);
    expect(fs.readFileSync(path.join(dest, "musics/two.mp3"), "utf8")).toBe("two");
  });
  it.skipIf(process.platform === "win32")("origem com link não é copiada para fora do destino", async () => {
    fs.outputFileSync(path.join(root, "secret"), "private");
    fs.ensureDirSync(path.join(paths.filesDir(), "musics"));
    fs.symlinkSync(path.join(root, "secret"), path.join(paths.filesDir(), "musics/link.mp3"));
    await storage.configure(request({ mediaDir: path.join(root, "new"), mediaAction: "copy" })); storage.applyPending();
    expect(storage.locations().changeError).toMatch(/link/);
    expect(fs.existsSync(path.join(root, "new/musics/link.mp3"))).toBe(false);
  });
  it("disco do destino removido fica pendente, sem criar substituto", async () => {
    const dest = path.join(root, "detached");
    await storage.configure(request({ mediaDir: dest })); fs.removeSync(dest); storage.applyPending();
    expect(storage.locations().changeError).toMatch(/indisponível/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(storage.locations().restartRequired).toBe(true);
  });
  it("um escritor exclusivo permite outro consumidor somente leitura", () => {
    const release = access.acquire(paths.filesDir());
    access.initialize(paths.storageLayout());
    expect(access.canWrite("media")).toBe(false);
    expect(access.status().media.reason).toBe("in-use");
    expect(access.canWrite("videos")).toBe(true);
    release();
  });
  it("reutilização marca coleção compartilhada e desliga manutenção", async () => {
    const dest = path.join(root, "shared");
    await storage.configure(request({ mediaDir: dest })); storage.applyPending();
    access.initialize(paths.storageLayout());
    expect(access.canWrite("media")).toBe(true);
    expect(access.canMaintain("media")).toBe(false);
    expect(() => access.assertMaintain("media")).toThrow(/compartilhado/);
  });

  it("preserva uma pasta temporária sem identificação da cópia", async () => {
    const source = paths.filesDir(), target = path.join(root, "new-media"), id = crypto.randomUUID();
    fs.outputFileSync(path.join(source, "musics/song.mp3"), "source");
    fs.outputFileSync(path.join(target, `.louvorja-migration-${id}`, "personal.txt"), "unrelated");
    expect(() => storage.copyCollection(source, target, "media", id)).toThrow(/não pertence/);
    expect(fs.readFileSync(path.join(target, `.louvorja-migration-${id}`, "personal.txt"), "utf8")).toBe("unrelated");
  });

  it.skipIf(process.platform === "win32")("recusa link intermediário no staging antes de apagar qualquer arquivo externo", () => {
    const source = paths.filesDir(), target = path.join(root, "new-media"), outside = path.join(root, "outside"), id = crypto.randomUUID();
    const staging = path.join(target, `.louvorja-migration-${id}`);
    fs.outputFileSync(path.join(source, "musics/song.mp3"), "source");
    fs.outputFileSync(path.join(outside, "song.mp3"), "unrelated original");
    fs.outputJsonSync(path.join(staging, ".owner.json"), { version: 1, id, source, target, kind: "media" });
    fs.symlinkSync(outside, path.join(staging, "musics"));
    expect(() => storage.copyCollection(source, target, "media", id)).toThrow(/link/);
    expect(fs.readFileSync(path.join(outside, "song.mp3"), "utf8")).toBe("unrelated original");
    expect(fs.existsSync(path.join(target, "musics/song.mp3"))).toBe(false);
  });

  it("retoma cópia interrompida identificada, revalidando arquivo parcial antes de publicar", () => {
    const source = paths.filesDir(), target = path.join(root, "new-media"), id = crypto.randomUUID();
    const staging = path.join(target, `.louvorja-migration-${id}`);
    fs.outputFileSync(path.join(source, "musics/song.mp3"), "complete source");
    fs.outputJsonSync(path.join(staging, ".owner.json"), { version: 1, id, source, target, kind: "media" });
    fs.outputFileSync(path.join(staging, "musics/song.mp3"), "partial");
    storage.copyCollection(source, target, "media", id);
    expect(fs.readFileSync(path.join(target, "musics/song.mp3"), "utf8")).toBe("complete source");
    expect(fs.readFileSync(path.join(source, "musics/song.mp3"), "utf8")).toBe("complete source");
    expect(fs.existsSync(staging)).toBe(false);
  });

  it("mantém pending e origem quando não consegue marcar um destino somente leitura como compartilhado", async () => {
    const source = paths.filesDir(), target = path.join(root, "readonly");
    await storage.configure(request({ mediaDir: target }));
    const original = fs.writeJsonSync;
    const write = vi.spyOn(fs, "writeJsonSync").mockImplementation((file, ...args) => {
      if (String(file).startsWith(path.join(target, ".louvorja-marker-"))) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return original.call(fs, file, ...args);
    });
    try { storage.applyPending(); } finally { write.mockRestore(); }
    expect(paths.filesDir()).toBe(source);
    expect(storage.locations().pending).not.toBeNull();
    expect(storage.locations().changeError).toMatch(/compartilhamento/);
  });
});
