// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let root, paths, locations, bootstrap;
function loadPaths() {
  const original = Module._load;
  Module._load = function (request, ...args) {
    return request === "electron" ? { app: { getPath: (n) => locations[n], setPath: (n, v) => { locations[n] = v; }, getAppPath: () => path.join(root, "program") } } : original.call(this, request, ...args);
  };
  try { delete require.cache[require.resolve("../paths.js")]; paths = require("../paths.js"); }
  finally { Module._load = original; }
}
beforeEach(() => {
  vi.stubEnv("LJ_E2E_USER_DATA", "");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-paths-data-")));
  bootstrap = path.join(root, "appData", "LouvorJA Violin");
  locations = { appData: path.join(root, "appData"), userData: bootstrap, documents: path.join(root, "Documents"), videos: path.join(root, "Movies") };
  loadPaths();
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); delete require.cache[require.resolve("../paths.js")]; fs.removeSync(root);
});
describe("perfil privado e destinos independentes", () => {
  it("instalação nova usa perfil privado, acervo em Documentos e vídeos na pasta nativa", () => {
    paths.configureProfile();
    expect(paths.dataDir()).toBe(path.join(bootstrap, "profile"));
    expect(locations.userData).toBe(path.join(bootstrap, "profile", ".electron"));
    expect(locations.sessionData).toBe(locations.userData);
    expect(paths.filesDir()).toBe(path.join(locations.documents, "LouvorJA Violin", "Acervo"));
    expect(paths.videosDir()).toBe(path.join(locations.videos, "LouvorJA Violin"));
    expect(paths.storageLayout().setupCompleted).toBe(false);
  });
  it("migra perfil, anexos, acervo e vídeos aos padrões preservando as origens", () => {
    const old = path.join(root, "Chosen folder");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    for (const file of [".electron/IndexedDB/origin-a/database", ".electron/IndexedDB/origin-b/database", "storage/user_data.json", "library/musics.playlists.json", "canva/design.pdf", "files/library/media/private.mp4", "files/musics/pt/song.mp3", "Videos/abcdefghijk.mp4"]) {
      fs.outputFileSync(path.join(old, file), file.endsWith(".json") ? JSON.stringify({ saved: file }) : "saved:" + file);
    }
    paths.configureProfile();
    for (const name of [".electron/IndexedDB/origin-a/database", ".electron/IndexedDB/origin-b/database", "storage/user_data.json", "library/musics.playlists.json", "canva/design.pdf"]) {
      expect(fs.readFileSync(path.join(paths.dataDir(), name), "utf8")).toBe(name.endsWith(".json") ? JSON.stringify({ saved: name }) : "saved:" + name);
      expect(fs.existsSync(path.join(old, name))).toBe(true);
    }
    expect(paths.filesDir()).toBe(path.join(locations.documents, "LouvorJA Violin", "Acervo"));
    expect(paths.videosDir()).toBe(path.join(locations.videos, "LouvorJA Violin"));
    expect(fs.readFileSync(path.join(paths.filesDir(), "musics/pt/song.mp3"), "utf8")).toBe("saved:files/musics/pt/song.mp3");
    expect(fs.readFileSync(path.join(paths.videosDir(), "abcdefghijk.mp4"), "utf8")).toBe("saved:Videos/abcdefghijk.mp4");
    expect(fs.existsSync(path.join(paths.filesDir(), "library"))).toBe(false);
    expect(fs.readFileSync(path.join(paths.privateMediaDir(), "private.mp4"), "utf8")).toBe("saved:files/library/media/private.mp4");
    expect(paths.privatePathMappings()).toContainEqual({ from: path.join(old, "files/library/media"), to: paths.privateMediaDir() });
    expect(paths.storageLayout().setupCompleted).toBe(true);
  });
  it("preserva perfil antigo plano no endereço do sistema", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "saved");
    paths.configureProfile();
    expect(fs.readFileSync(path.join(locations.userData, "IndexedDB", "offline"), "utf8")).toBe("saved");
    expect(fs.existsSync(path.join(bootstrap, "IndexedDB", "offline"))).toBe(true);
  });
  it("corrige o layout já publicado pela primeira migração sem recarregar preferências antigas", () => {
    const old = path.join(locations.documents, "LouvorJA Violin");
    const previous = { version: 1, setupCompleted: true, legacyRoot: old, mediaDir: path.join(old, "files"), videosDir: path.join(old, "Videos") };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), previous);
    fs.outputJsonSync(path.join(bootstrap, "profile", ".layout-origin.json"), previous);
    fs.outputJsonSync(path.join(bootstrap, "profile", "storage", "user_data.json"), { session: "current" });
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), { session: "old" });
    fs.outputFileSync(path.join(previous.mediaDir, "musics/song.opus"), "song");
    fs.outputFileSync(path.join(previous.videosDir, "abcdefghijk.mp4"), "video");
    fs.outputFileSync(path.join(previous.videosDir, ".partial/abcdefghijk/video.part"), "partial");
    expect(paths.needsMigration()).toBe(true);
    paths.configureProfile();
    expect(paths.filesDir()).toBe(path.join(old, "Acervo"));
    expect(paths.videosDir()).toBe(path.join(locations.videos, "LouvorJA Violin"));
    expect(paths.storageLayout().defaultLocationsVersion).toBe(1);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage/user_data.json"))).toEqual({ session: "current" });
    expect(fs.readFileSync(path.join(paths.videoWorkDir(), ".partial/abcdefghijk/video.part"), "utf8")).toBe("partial");
    expect(fs.existsSync(path.join(paths.videosDir(), ".partial"))).toBe(false);
    expect(fs.readFileSync(path.join(previous.videosDir, "abcdefghijk.mp4"), "utf8")).toBe("video");
    expect(paths.needsMigration()).toBe(false);
    fs.removeSync(path.join(paths.videosDir(), "abcdefghijk.mp4"));
    loadPaths(); paths.configureProfile();
    expect(fs.existsSync(path.join(paths.videosDir(), "abcdefghijk.mp4"))).toBe(false);
  });
  it("a correção de padrões respeita escolhas feitas depois da primeira migração", () => {
    const old = { version: 1, setupCompleted: true, mediaDir: path.join(root, "old-media"), videosDir: path.join(root, "old-videos") };
    const chosen = { ...old, mediaDir: path.join(root, "chosen-media"), videosDir: path.join(root, "chosen-videos") };
    for (const dir of [chosen.mediaDir, chosen.videosDir]) fs.ensureDirSync(dir);
    fs.outputJsonSync(path.join(bootstrap, "profile", ".layout-origin.json"), old);
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), chosen);
    paths.configureProfile();
    expect(paths.storageLayout()).toMatchObject({ ...chosen, defaultLocationsVersion: 1 });
  });
  it("conflito no padrão preserva layout ativo, origem e conteúdo diferente", () => {
    const old = path.join(root, "legacy");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.outputFileSync(path.join(old, "files/musics/song.mp3"), "original");
    const target = path.join(locations.documents, "LouvorJA Violin", "Acervo", "musics/song.mp3");
    fs.outputFileSync(target, "different");
    paths.configureProfile();
    expect(paths.storageLayout().pendingError).toMatch(/diferente/);
    expect(fs.readJsonSync(path.join(bootstrap, "storage-layout.json")).mediaDir).toBe(path.join(old, "files"));
    expect(fs.readFileSync(target, "utf8")).toBe("different");
    expect(fs.readFileSync(path.join(old, "files/musics/song.mp3"), "utf8")).toBe("original");
  });
  it("padrão de máquina compartilha somente o acervo e usa vídeos da conta atual", () => {
    const { defaultLocations } = require("../storageLayout.js");
    for (const version of [1, 2]) {
      expect(defaultLocations({ documents: locations.documents, videos: locations.videos,
        machineDefaults: { version, mediaDir: path.join(root, "Public", "Acervo"), videosDir: path.join(root, "obsolete-public-videos") } })).toEqual({
        mediaDir: path.join(root, "Public", "Acervo"), mediaShared: true,
        videosDir: path.join(locations.videos, "LouvorJA Violin"), videosShared: false,
      });
    }
  });
  it("ignora somente caches regeneráveis da raiz e mantém dados offline e originais", () => {
    const old = path.join(root, "legacy");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    const discarded = ["Cache/cache", "Code Cache/code", "GPUCache/shader", "DawnGraphiteCache/shader", "logs/log.txt", "Crashpad/report"];
    const preserved = ["IndexedDB/database", "IndexedDB/blob/Cache/saved", "blob_storage/blob", "Service Worker/CacheStorage/offline", "Unknown/Cache/saved"];
    for (const file of [...discarded, ...preserved]) fs.outputFileSync(path.join(old, ".electron", file), "saved:" + file);
    const read = vi.spyOn(fs, "openSync");
    paths.configureProfile();
    const opened = read.mock.calls.map(([file]) => String(file));
    for (const file of discarded) {
      expect(fs.existsSync(path.join(paths.profileDir(), file))).toBe(false);
      expect(opened).not.toContain(path.join(old, ".electron", file));
    }
    for (const file of preserved) expect(fs.readFileSync(path.join(paths.profileDir(), file), "utf8")).toBe("saved:" + file);
    for (const file of [...discarded, ...preserved]) expect(fs.readFileSync(path.join(old, ".electron", file), "utf8")).toBe("saved:" + file);
  });
  it("também deixa os caches planos antigos na origem", () => {
    fs.outputFileSync(path.join(bootstrap, "Cache", "cached"), "regenerable");
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "personal");
    paths.configureProfile();
    expect(fs.existsSync(path.join(paths.profileDir(), "Cache"))).toBe(false);
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "offline"), "utf8")).toBe("personal");
    expect(fs.readFileSync(path.join(bootstrap, "Cache", "cached"), "utf8")).toBe("regenerable");
  });
  it("informa progresso e cancela antes da publicação quando o controlador desaparece", () => {
    const layout = require("../storageLayout.js");
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "personal");
    const progress = [];
    expect(() => layout.initialize({ bootstrap, documents: locations.documents, onProgress(event) {
      progress.push(event);
      if (event.phase === "publishing") throw new Error("parent exited");
    } })).toThrow("parent exited");
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining(["scanning", "copying", "verifying", "publishing"]));
    expect(fs.existsSync(path.join(bootstrap, "profile"))).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, ".profile-migration.lock"))).toBe(false);
    expect(fs.readFileSync(path.join(bootstrap, "IndexedDB", "offline"), "utf8")).toBe("personal");
  });
  it("reconhece acervo plano anterior à raiz única e preserva o IndexedDB do sistema", () => {
    const media = path.join(locations.documents, "LouvorJA Violin");
    fs.outputFileSync(path.join(media, "musics", "song.mp3"), "music");
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "private");
    paths.configureProfile();
    expect(paths.filesDir()).toBe(path.join(media, "Acervo"));
    expect(paths.videosDir()).toBe(path.join(locations.videos, "LouvorJA Violin"));
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "database"), "utf8")).toBe("private");
    loadPaths(); paths.configureProfile();
    expect(paths.filesDir()).toBe(path.join(media, "Acervo"));
  });
  it("preserva preferências no AppData quando só a mídia havia ido para Documentos", () => {
    const old = path.join(locations.documents, "LouvorJA Violin");
    fs.outputFileSync(path.join(old, "files", "musics", "song.mp3"), "music");
    fs.outputJsonSync(path.join(bootstrap, "storage", "user_data.json"), { language: "es" });
    fs.outputJsonSync(path.join(bootstrap, "library", "playlists.json"), [{ title: "Minha lista" }]);
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "private");
    paths.configureProfile();
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(fs.readJsonSync(path.join(paths.dataDir(), "library", "playlists.json"))).toEqual([{ title: "Minha lista" }]);
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "database"), "utf8")).toBe("private");
    expect(fs.existsSync(path.join(bootstrap, "storage", "user_data.json"))).toBe(true);
  });
  it("mantém preferências da raiz ativa e recupera somente arquivos ausentes do AppData", () => {
    const old = path.join(locations.documents, "LouvorJA Violin");
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), { language: "es" });
    fs.outputJsonSync(path.join(bootstrap, "storage", "user_data.json"), { language: "pt" });
    fs.outputJsonSync(path.join(bootstrap, "storage", "config.json"), { monitor: 2 });
    fs.outputFileSync(path.join(bootstrap, "storage", "canva.key"), "private-key");
    paths.configureProfile();
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "config.json"))).toEqual({ monitor: 2 });
    expect(fs.readFileSync(path.join(paths.dataDir(), "storage", "canva.key"), "utf8")).toBe("private-key");
    expect(fs.readJsonSync(path.join(bootstrap, "storage", "user_data.json"))).toEqual({ language: "pt" });
  });
  it("não recria acervo antigo configurado em disco ausente", () => {
    const media = path.join(root, "disconnected", "Music");
    fs.outputJsonSync(path.join(bootstrap, "storage", "storage.json"), { filesDir: media });
    expect(() => paths.configureProfile()).toThrow(/acervo está indisponível/);
    expect(fs.existsSync(media)).toBe(false);
    expect(fs.existsSync(paths.dataDir())).toBe(false);
  });
  it.each([
    { mediaShared: "invalid" }, { pending: false }, { pending: [] },
    { mediaDir: "profile" }, { mediaDir: "program" }, { videosDir: "media" },
  ])("recusa layout persistido inválido antes de inicializar gravadores: %j", (change) => {
    paths.configureProfile();
    const saved = paths.storageLayout();
    if (change.mediaDir === "profile") change = { mediaDir: paths.dataDir() };
    if (change.mediaDir === "program") change = { mediaDir: paths.appRoot() };
    if (change.videosDir === "media") change = { videosDir: saved.mediaDir };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), { ...saved, ...change });
    loadPaths();
    expect(() => paths.configureProfile()).toThrow();
    expect(fs.readJsonSync(path.join(bootstrap, "storage-layout.json"))).toEqual({ ...saved, ...change });
  });
  it("conclui migração pendente da versão anterior sem apagar a origem", () => {
    const old = path.join(root, "Old", ".electron");
    const chosen = path.join(root, "Chosen");
    fs.ensureDirSync(chosen);
    fs.outputFileSync(path.join(old, "IndexedDB", "saved"), "private");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: chosen, profileSource: old });
    paths.configureProfile();
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "saved"), "utf8")).toBe("private");
    expect(fs.existsSync(old)).toBe(true);
  });
  it("disco antigo ausente interrompe antes de criar um perfil vazio", () => {
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: path.join(root, "unmounted") });
    expect(() => paths.configureProfile()).toThrow(/indisponível/);
    expect(fs.existsSync(paths.dataDir())).toBe(false);
  });
  it("âncora corrompida não é sobrescrita", () => {
    const file = path.join(bootstrap, "data-location.json");
    fs.outputFileSync(file, "broken");
    expect(() => paths.configureProfile()).toThrow(/configuração/);
    expect(fs.readFileSync(file, "utf8")).toBe("broken");
  });
  it("retoma publicação interrompida depois da cópia sem copiar preferências antigas novamente", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "saved");
    paths.configureProfile();
    fs.removeSync(path.join(bootstrap, "storage-layout.json"));
    fs.writeFileSync(path.join(paths.profileDir(), "IndexedDB", "offline"), "new-session");
    loadPaths(); paths.configureProfile();
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "offline"), "utf8")).toBe("new-session");
  });
  it("falha na cópia mantém origem e permite nova tentativa", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "saved");
    const spy = vi.spyOn(fs, "copyFileSync").mockImplementationOnce(() => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); });
    expect(() => paths.configureProfile()).toThrow("disk full");
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
    expect(fs.readFileSync(path.join(bootstrap, "IndexedDB", "offline"), "utf8")).toBe("saved");
    spy.mockRestore(); paths.configureProfile();
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "offline"), "utf8")).toBe("saved");
  });
  it("não publica perfil quando a origem muda durante a cópia", () => {
    const prefs = path.join(bootstrap, "storage", "user_data.json");
    fs.outputJsonSync(prefs, { value: "before" });
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "saved");
    const copy = fs.copyFileSync;
    vi.spyOn(fs, "copyFileSync").mockImplementation((source, target, flags) => {
      copy(source, target, flags);
      if (path.basename(source) === "database") fs.writeJsonSync(prefs, { value: "concurrent change" });
    });
    expect(() => paths.configureProfile()).toThrow(/mudaram durante/);
    expect(fs.existsSync(paths.dataDir())).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
    expect(fs.readJsonSync(prefs)).toEqual({ value: "concurrent change" });
  });
  it("não publica uma cópia incompleta se um arquivo some e reaparece com os mesmos bytes", () => {
    const saved = path.join(bootstrap, "IndexedDB", "database");
    fs.outputFileSync(saved, "private bytes");
    const exists = fs.existsSync;
    let removed = false;
    const unavailable = vi.spyOn(fs, "existsSync").mockImplementation((file) => {
      // fingerprint usa lstat/hash; existsSync neste arquivo só acontece ao
      // copiá-lo. Simula um rename temporário depois do manifesto inicial.
      if (file === saved && !removed) {
        removed = true;
        fs.unlinkSync(saved);
        return false;
      }
      return exists(file);
    });
    try {
      expect(() => require("../storageLayout.js").initialize({
        bootstrap, documents: locations.documents, programDir: paths.appRoot(),
        onProgress({ phase }) {
          // Sem conferir a cobertura, a comparação final da origem aceitaria
          // estes mesmos bytes mesmo sem eles existirem no destino copiado.
          if (phase === "verifying" && removed) fs.outputFileSync(saved, "private bytes");
        },
      })).toThrow(/cópia do perfil ficou incompleta/);
    } finally {
      unavailable.mockRestore();
      if (removed) fs.outputFileSync(saved, "private bytes");
    }
    expect(removed).toBe(true);
    expect(fs.existsSync(paths.dataDir())).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
    expect(fs.readFileSync(saved, "utf8")).toBe("private bytes");
  });
  it.skipIf(process.platform === "win32")("recusa perfil antigo com processo ainda ativo", () => {
    const old = path.join(root, "legacy");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.ensureDirSync(path.join(old, ".electron"));
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(old, ".electron", "SingletonLock"));
    expect(() => paths.configureProfile()).toThrow(/Feche o LouvorJA nas outras contas/);
    expect(fs.existsSync(paths.dataDir())).toBe(false);
  });
  it("nunca reabre a raiz antiga depois que o perfil padrão foi publicado", () => {
    paths.configureProfile(); const saved = paths.storageLayout();
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: path.join(root, "not-ours") });
    loadPaths(); paths.configureProfile();
    expect(paths.storageLayout()).toEqual(saved);
  });
});
