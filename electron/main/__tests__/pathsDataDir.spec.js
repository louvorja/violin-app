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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-paths-data-"));
  bootstrap = path.join(root, "appData", "LouvorJA Violin");
  locations = { appData: path.join(root, "appData"), userData: bootstrap, documents: path.join(root, "Documents") };
  loadPaths();
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); delete require.cache[require.resolve("../paths.js")]; fs.removeSync(root);
});
describe("perfil privado e destinos independentes", () => {
  it("instalação nova cria perfil no sistema e mantém mídia em Documentos", () => {
    paths.configureProfile();
    expect(paths.dataDir()).toBe(path.join(bootstrap, "profile"));
    expect(locations.userData).toBe(path.join(bootstrap, "profile", ".electron"));
    expect(locations.sessionData).toBe(locations.userData);
    expect(paths.filesDir()).toBe(path.join(locations.documents, "LouvorJA Violin", "Acervo"));
    expect(paths.videosDir()).toBe(path.join(locations.documents, "LouvorJA Violin", "Videos"));
    expect(paths.storageLayout().setupCompleted).toBe(false);
  });
  it("copia perfil, documentos, Canva e anexos privados sem deslocar o acervo existente", () => {
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
    expect(paths.filesDir()).toBe(path.join(old, "files"));
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
  it("reconhece acervo plano anterior à raiz única e preserva o IndexedDB do sistema", () => {
    const media = path.join(locations.documents, "LouvorJA Violin");
    fs.outputFileSync(path.join(media, "musics", "song.mp3"), "music");
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "private");
    paths.configureProfile();
    expect(paths.filesDir()).toBe(media);
    expect(paths.videosDir()).toBe(path.join(media, "Videos"));
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB", "database"), "utf8")).toBe("private");
    loadPaths(); paths.configureProfile();
    expect(paths.filesDir()).toBe(media);
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
