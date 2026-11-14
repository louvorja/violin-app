// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let root, paths, locations, bootstrap, sharedMedia;
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
  vi.stubEnv("LJ_E2E_USER_DATA", bootstrap);
  sharedMedia = path.join(bootstrap, "shared", "LouvorJA Violin", "Acervo");
  locations = { appData: path.join(root, "appData"), userData: bootstrap, documents: path.join(root, "Documents"), videos: path.join(root, "Movies") };
  loadPaths();
});
function thrown(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error("esperava uma falha");
}
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); delete require.cache[require.resolve("../paths.js")]; fs.removeSync(root);
});
describe("perfil privado e destinos independentes", () => {
  it("mantém a origem de Mover quando o boot é interrompido antes de publicar o layout", () => {
    paths.configureProfile();
    const source = path.join(root, "private-media"), target = path.join(root, "moved-media");
    fs.outputFileSync(path.join(source, "musics/song.mp3"), "original audio");
    fs.ensureDirSync(target);
    const current = { ...paths.storageLayout(), mediaDir: source, mediaShared: false,
      pending: { id: "11111111-1111-4111-8111-111111111111", mediaDir: target,
        videosDir: paths.videosDir(), mediaAction: "move", videosAction: "reuse" } };
    paths.saveLayout(current);
    const layout = require("../storageLayout.js");
    expect(() => layout.initialize({ ...paths.migrationOptions(), onProgress(event) {
      if (event.phase === "publishing") throw new Error("parent closed before publication");
    } })).toThrow("parent closed before publication");
    expect(fs.readFileSync(path.join(source, "musics/song.mp3"), "utf8")).toBe("original audio");
    expect(fs.readJsonSync(path.join(bootstrap, "storage-layout.json"))).toEqual(current);
  });

  it("instalação nova usa perfil privado, acervo comum e vídeos na pasta nativa", () => {
    paths.configureProfile();
    expect(paths.dataDir()).toBe(path.join(bootstrap, "profile"));
    expect(locations.userData).toBe(path.join(bootstrap, "profile", ".electron"));
    expect(locations.sessionData).toBe(locations.userData);
    expect(paths.filesDir()).toBe(sharedMedia);
    expect(paths.videosDir()).toBe(path.join(locations.videos, "LouvorJA Violin"));
    expect(paths.storageLayout().setupCompleted).toBe(false);
  });
  it("migra perfil e anexos e mantém acervo e vídeos onde estavam, sem copiá-los", () => {
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
    expect(paths.videosDir()).toBe(path.join(old, "Videos"));
    expect(paths.storageLayout()).toEqual({ version: 1, setupCompleted: true, legacyRoot: old, mediaDir: path.join(old, "files"), videosDir: path.join(old, "Videos") });
    expect(fs.existsSync(sharedMedia)).toBe(false);
    expect(fs.existsSync(path.join(locations.videos, "LouvorJA Violin"))).toBe(false);
    expect(fs.readFileSync(path.join(paths.filesDir(), "musics/pt/song.mp3"), "utf8")).toBe("saved:files/musics/pt/song.mp3");
    expect(fs.readFileSync(path.join(paths.videosDir(), "abcdefghijk.mp4"), "utf8")).toBe("saved:Videos/abcdefghijk.mp4");
    expect(fs.readFileSync(path.join(paths.privateMediaDir(), "private.mp4"), "utf8")).toBe("saved:files/library/media/private.mp4");
    expect(paths.privatePathMappings()).toContainEqual({ from: path.join(old, "files/library/media"), to: paths.privateMediaDir() });
    expect(paths.storageLayout().setupCompleted).toBe(true);
  });
  it("leva o cache do Canva da beta.18 (files/canva) ao perfil e reescreve a playlist", () => {
    const old = path.join(locations.documents, "LouvorJA Violin");
    const pdf = path.join(old, "files", "canva", "D1.pdf");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.outputFileSync(pdf, "pdf");
    fs.outputFileSync(path.join(old, "files", "canva", "D1.pdf.json"), "{}");
    fs.outputFileSync(path.join(old, "files", "musics", "pt", "song.mp3"), "song");
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), {
      modules: { media_library: { playlist: [{ type: "pdf", path: pdf }] } },
    });
    paths.configureProfile();
    expect(fs.readFileSync(path.join(paths.canvaDir(), "D1.pdf"), "utf8")).toBe("pdf");
    expect(fs.existsSync(path.join(paths.canvaDir(), "D1.pdf.json"))).toBe(true);
    expect(paths.filesDir()).toBe(path.join(old, "files"));
    expect(fs.existsSync(sharedMedia)).toBe(false);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json")).modules.media_library.playlist[0].path)
      .toBe(path.join(paths.canvaDir(), "D1.pdf"));
    expect(paths.privatePathMappings()).toContainEqual({ from: path.join(old, "files", "canva"), to: paths.canvaDir() });
    expect(fs.readFileSync(pdf, "utf8")).toBe("pdf");
  });

  it("leva os PDFs do PowerPoint de <dados>/pptx ao perfil e reescreve a playlist", () => {
    const old = path.join(root, "legacy");
    const pdf = path.join(old, "pptx", "abc-powerpoint.pdf");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.outputFileSync(pdf, "pdf");
    fs.outputFileSync(path.join(old, "pptx", "fonts", "manual", "Brich.ttf"), "font");
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), {
      modules: { media_library: { playlist: [{ type: "pdf", path: pdf }] } },
    });
    paths.configureProfile();
    const moved = path.join(paths.dataDir(), "pptx", "abc-powerpoint.pdf");
    expect(fs.readFileSync(moved, "utf8")).toBe("pdf");
    expect(fs.readFileSync(path.join(paths.dataDir(), "pptx", "fonts", "manual", "Brich.ttf"), "utf8")).toBe("font");
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json")).modules.media_library.playlist[0].path).toBe(moved);
    expect(paths.privatePathMappings()).toContainEqual({ from: path.join(old, "pptx"), to: path.join(paths.dataDir(), "pptx") });
    expect(fs.readFileSync(pdf, "utf8")).toBe("pdf");
  });

  it("preserva perfil antigo plano no endereço do sistema", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "saved");
    paths.configureProfile();
    expect(fs.readFileSync(path.join(locations.userData, "IndexedDB", "offline"), "utf8")).toBe("saved");
    expect(fs.existsSync(path.join(bootstrap, "IndexedDB", "offline"))).toBe(true);
  });
  it("layout já publicado não volta ao auxiliar nem move acervo e vídeos", () => {
    const old = path.join(locations.documents, "LouvorJA Violin");
    const previous = { version: 1, setupCompleted: true, legacyRoot: old, mediaDir: path.join(old, "files"), videosDir: path.join(old, "Videos") };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), previous);
    fs.outputJsonSync(path.join(bootstrap, "profile", ".layout-origin.json"), previous);
    fs.outputJsonSync(path.join(bootstrap, "profile", "storage", "user_data.json"), { session: "current" });
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), { session: "old" });
    fs.outputFileSync(path.join(previous.mediaDir, "musics/song.opus"), "song");
    expect(paths.needsMigration()).toBe(false);
    paths.configureProfile();
    expect(paths.storageLayout()).toEqual(previous);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage/user_data.json"))).toEqual({ session: "current" });
    expect(fs.existsSync(sharedMedia)).toBe(false);
  });
  it("leva os downloads de vídeo interrompidos ao perfil na primeira migração", () => {
    const old = path.join(root, "legacy");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.outputFileSync(path.join(old, "Videos", "abcdefghijk.mp4"), "video");
    fs.outputFileSync(path.join(old, "Videos", ".partial/abcdefghijk/video.part"), "partial");
    paths.configureProfile();
    expect(paths.videosDir()).toBe(path.join(old, "Videos"));
    expect(fs.readFileSync(path.join(paths.videoWorkDir(), ".partial/abcdefghijk/video.part"), "utf8")).toBe("partial");
    expect(fs.readFileSync(path.join(old, "Videos", ".partial/abcdefghijk/video.part"), "utf8")).toBe("partial");
  });
  it("uma mudança de pasta pedida depois é o único motivo para voltar ao auxiliar", () => {
    const old = path.join(root, "legacy");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old });
    fs.outputFileSync(path.join(old, "files/musics/song.mp3"), "original");
    paths.configureProfile();
    const chosen = path.join(root, "chosen-media");
    fs.ensureDirSync(chosen);
    paths.saveLayout({ ...paths.storageLayout(), pending: { id: "11111111-1111-4111-8111-111111111111", mediaDir: chosen,
      videosDir: paths.videosDir(), mediaAction: "copy", videosAction: "reuse" } });
    loadPaths();
    expect(paths.needsMigration()).toBe(true);
    paths.configureProfile();
    expect(paths.filesDir()).toBe(chosen);
    expect(fs.readFileSync(path.join(chosen, "musics/song.mp3"), "utf8")).toBe("original");
    expect(fs.readFileSync(path.join(old, "files/musics/song.mp3"), "utf8")).toBe("original");
    loadPaths();
    expect(paths.needsMigration()).toBe(false);
  });
  it("padrão de máquina compartilha somente o acervo e usa vídeos da conta atual", () => {
    const { defaultLocations } = require("../storageLayout.js");
    for (const version of [1, 2]) {
      expect(defaultLocations({ documents: locations.documents, videos: locations.videos, sharedMedia,
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
    expect(() => layout.initialize({ bootstrap, documents: locations.documents, sharedMedia, onProgress(event) {
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
  it("ignora acervo antigo configurado em disco ausente sem recriá-lo", () => {
    const media = path.join(root, "disconnected", "Music");
    fs.outputJsonSync(path.join(bootstrap, "storage", "storage.json"), { filesDir: media });
    paths.configureProfile();
    expect(fs.existsSync(media)).toBe(false);
    expect(paths.filesDir()).toBe(path.join(bootstrap, "files"));
  });
  it.each([
    { mediaShared: "invalid" }, { pending: false }, { pending: [] },
    { mediaDir: "profile" }, { mediaDir: "program" }, { videosDir: "media" },
  ])("layout persistido inválido nunca chega aos gravadores: fica guardado e a abertura segue: %j", (change) => {
    paths.configureProfile();
    const saved = paths.storageLayout();
    if (change.mediaDir === "profile") change = { mediaDir: paths.dataDir() };
    if (change.mediaDir === "program") change = { mediaDir: paths.appRoot() };
    if (change.videosDir === "media") change = { videosDir: saved.mediaDir };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), { ...saved, ...change });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    loadPaths(); paths.configureProfile();
    if ("pending" in change) {
      // Só a mudança de pastas pedida era inválida: perde a mudança, não o resto.
      expect(paths.storageLayout()).toEqual({ ...saved, pendingError: expect.stringMatching(/descartada/) });
      return;
    }
    expect(paths.storageLayout()).toEqual(saved);
    const [kept] = fs.readdirSync(path.join(bootstrap, "recovery"));
    expect(fs.readJsonSync(path.join(bootstrap, "recovery", kept, "storage-layout.json"))).toEqual({ ...saved, ...change });
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
    expect(thrown(() => paths.configureProfile())).toMatchObject({ code: "LJ_DATA_UNAVAILABLE", dir: path.join(root, "unmounted") });
    expect(fs.existsSync(paths.dataDir())).toBe(false);
  });
  it("âncora ilegível não trava a abertura nem é regravada: procura no endereço padrão, como a versão antiga", () => {
    const file = path.join(bootstrap, "data-location.json");
    fs.outputFileSync(file, "broken");
    const old = path.join(locations.documents, "LouvorJA Violin");
    fs.outputJsonSync(path.join(old, "storage", "user_data.json"), { language: "es" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    paths.configureProfile();
    expect(paths.storageLayout().legacyRoot).toBe(old);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(fs.readFileSync(file, "utf8")).toBe("broken");
  });
  it("âncora truncada no meio da gravação ainda entrega o endereço inteiro", () => {
    const chosen = path.join(root, "Pasta escolhida");
    fs.outputJsonSync(path.join(chosen, "storage", "user_data.json"), { language: "es" });
    const file = path.join(bootstrap, "data-location.json");
    fs.outputFileSync(file, `{\n  "dataDir": ${JSON.stringify(chosen)},\n  "profileSo`);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    paths.configureProfile();
    expect(paths.storageLayout().legacyRoot).toBe(chosen);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
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

// chmod 000 em Documentos imita o TCC do macOS: a pasta existe e nada nela é legível.
const semPermissao = process.platform === "win32" || process.getuid?.() === 0;
describe.skipIf(semPermissao)("sem acesso aos dados antigos", () => {
  const old = () => path.join(locations.documents, "LouvorJA Violin");
  function negarDocumentos() { fs.ensureDirSync(locations.documents); fs.chmodSync(locations.documents, 0o000); }
  afterEach(() => { if (fs.existsSync(locations.documents)) fs.chmodSync(locations.documents, 0o755); });

  it("instalação nova não consulta Documentos, mesmo sem acesso", () => {
    negarDocumentos();
    const consultas = [];
    for (const name of ["statSync", "existsSync", "readdirSync", "lstatSync"]) {
      const original = fs[name];
      vi.spyOn(fs, name).mockImplementation((file, ...args) => {
        if (String(file).startsWith(locations.documents)) consultas.push(String(file));
        return original(file, ...args);
      });
    }
    paths.configureProfile();
    expect(consultas).toEqual([]);
    expect(paths.filesDir()).toBe(sharedMedia);
    expect(paths.storageLayout().setupCompleted).toBe(false);
  });
  it("com a âncora em Documentos sem acesso, interrompe sem criar perfil vazio", () => {
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old() });
    fs.outputJsonSync(path.join(old(), "storage", "user_data.json"), { language: "es" });
    negarDocumentos();
    expect(thrown(() => paths.configureProfile())).toMatchObject({ code: "LJ_DATA_UNAVAILABLE", dir: old() });
    expect(fs.existsSync(path.join(bootstrap, "profile"))).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
  });
  it("sem âncora e com perfil antigo no AppData, Documentos sem acesso não vira instalação nova", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "private");
    fs.outputFileSync(path.join(old(), "files", "musics", "song.mp3"), "music");
    negarDocumentos();
    expect(thrown(() => paths.needsMigration())).toMatchObject({ code: "LJ_DATA_UNAVAILABLE", dir: old() });
    expect(fs.existsSync(path.join(bootstrap, "profile"))).toBe(false);
  });
  it("o modo provisório abre fora da origem, não publica nada e a próxima abertura migra", () => {
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: old() });
    fs.outputJsonSync(path.join(old(), "storage", "user_data.json"), { language: "es" });
    fs.outputFileSync(path.join(old(), "files", "musics", "song.mp3"), "music");
    negarDocumentos();
    paths.useFallback(thrown(() => paths.configureProfile()));
    paths.configureProfile();
    const fallback = path.join(bootstrap, "fallback");
    expect(paths.dataDir()).toBe(path.join(fallback, "profile"));
    expect(locations.userData).toBe(path.join(fallback, "profile", ".electron"));
    expect([paths.filesDir(), paths.videosDir()]).toEqual([path.join(fallback, "Acervo"), path.join(fallback, "Videos")]);
    expect(paths.dataDirIssue()).toEqual({ reason: "unavailable", wanted: old(), attempts: 1, canReset: false });
    expect(paths.privatePathMappings()).toEqual([]);
    expect(() => paths.saveLayout(paths.storageLayout())).toThrow(/ainda não foram trazidos/);
    expect(fs.existsSync(path.join(bootstrap, "storage-layout.json"))).toBe(false);
    expect(fs.existsSync(path.join(bootstrap, "profile"))).toBe(false);

    fs.chmodSync(locations.documents, 0o755);
    loadPaths();
    expect(paths.needsMigration()).toBe(true);
    paths.configureProfile();
    expect(paths.dataDirIssue()).toBe(null);
    expect(paths.dataDir()).toBe(path.join(bootstrap, "profile"));
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(paths.filesDir()).toBe(path.join(old(), "files"));
  });
  it("uma falha que não é de acesso também abre o provisório, com o motivo", () => {
    paths.useFallback(new Error("Os dados antigos mudaram durante a migração"));
    paths.configureProfile();
    expect(paths.dataDirIssue()).toEqual({ reason: "failed", message: "Os dados antigos mudaram durante a migração", attempts: 1, canReset: false });
  });
});

describe("versões em uso que pulam direto para esta", () => {
  it("beta.12: dados em Documentos e perfil, json_db, bin e vídeos no AppData, tudo copiado sem mexer na origem", () => {
    const docs = path.join(locations.documents, "LouvorJA Violin");
    const inDocs = ["storage/user_data.txt", "library/liturgies.txt", "files/musics/pt/Album/song.opus", "files/covers/pt/Album.jpg"];
    const inAppData = ["IndexedDB/file__0.indexeddb.leveldb/000003.log", "Local Storage/leveldb/000003.log", "json_db/pt_musics.json", "bin/yt-dlp", "online_videos/abcdefghijk.mp4"];
    for (const file of inDocs) fs.outputFileSync(path.join(docs, file), "doc:" + file);
    for (const file of inAppData) fs.outputFileSync(path.join(bootstrap, file), "app:" + file);
    paths.configureProfile();
    expect(paths.storageLayout()).toEqual({ version: 1, setupCompleted: true, legacyRoot: docs, mediaDir: path.join(docs, "files"), videosDir: path.join(docs, "Videos") });
    for (const file of ["storage/user_data.txt", "library/liturgies.txt"]) {
      expect(fs.readFileSync(path.join(paths.dataDir(), file), "utf8")).toBe("doc:" + file);
    }
    for (const file of ["json_db/pt_musics.json", "bin/yt-dlp"]) {
      expect(fs.readFileSync(path.join(paths.dataDir(), file), "utf8")).toBe("app:" + file);
    }
    expect(fs.readFileSync(path.join(paths.profileDir(), "IndexedDB/file__0.indexeddb.leveldb/000003.log"), "utf8")).toBe("app:IndexedDB/file__0.indexeddb.leveldb/000003.log");
    for (const file of inDocs) expect(fs.readFileSync(path.join(docs, file), "utf8")).toBe("doc:" + file);
    for (const file of inAppData) expect(fs.readFileSync(path.join(bootstrap, file), "utf8")).toBe("app:" + file);
  });

  it("beta.1–3: acervo na pasta de nome antigo, Documents/LouvorJA", () => {
    const old = path.join(locations.documents, "LouvorJA");
    fs.outputFileSync(path.join(old, "musics", "pt", "song.mp3"), "music");
    fs.outputJsonSync(path.join(bootstrap, "storage", "user_data.json"), { language: "pt" });
    paths.configureProfile();
    expect(paths.filesDir()).toBe(old);
    expect(fs.readFileSync(path.join(old, "musics", "pt", "song.mp3"), "utf8")).toBe("music");
  });

  it("beta.1–3: pasta escolhida à mão vence restos sem acervo no AppData", () => {
    const chosen = path.join(root, "Escolhida");
    fs.outputFileSync(path.join(chosen, "musics", "pt", "song.mp3"), "music");
    fs.outputJsonSync(path.join(bootstrap, "storage", "storage.json"), { filesDir: chosen });
    fs.outputFileSync(path.join(bootstrap, "files", ".write-probe"), "");
    paths.configureProfile();
    expect(paths.filesDir()).toBe(chosen);
  });

  it("com âncora (beta.14+), endereços antigos não são consultados: a main já os recolheu", () => {
    const data = path.join(locations.documents, "LouvorJA Violin");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: data });
    fs.outputJsonSync(path.join(data, "storage", "user_data.json"), { language: "pt" });
    fs.outputFileSync(path.join(locations.documents, "LouvorJA", "musics", "pt", "stale.mp3"), "stale");
    paths.configureProfile();
    expect(paths.filesDir()).toBe(path.join(data, "files"));
  });

  it("um JSON corrompido nos documentos é copiado como está e não trava a migração", () => {
    const docs = path.join(locations.documents, "LouvorJA Violin");
    fs.outputFileSync(path.join(docs, "library", "liturgies.json"), '{"items": [');
    fs.outputJsonSync(path.join(docs, "library", "playlists.json"), [{ audio: path.join(docs, "files", "library", "media", "a.mp3") }]);
    fs.outputFileSync(path.join(docs, "files", "library", "media", "a.mp3"), "audio");
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "database"), "private");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    paths.configureProfile();
    expect(fs.readFileSync(path.join(paths.dataDir(), "library", "liturgies.json"), "utf8")).toBe('{"items": [');
    expect(fs.readJsonSync(path.join(paths.dataDir(), "library", "playlists.json"))).toEqual([{ audio: path.join(paths.privateMediaDir(), "a.mp3") }]);
    expect(paths.dataDirIssue()).toBeNull();
  });
});

describe("recuperação automática", () => {
  const recovery = () => require("../storageRecovery.js");
  const legacy = () => path.join(locations.documents, "LouvorJA Violin");
  function migrated() {
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: legacy() });
    fs.outputJsonSync(path.join(legacy(), "storage", "user_data.json"), { language: "es" });
    fs.outputFileSync(path.join(legacy(), "files", "musics", "pt", "song.opus"), "music");
    paths.configureProfile();
    return paths.storageLayout();
  }
  const reopen = () => { loadPaths(); paths.configureProfile(); };
  const keptIn = (reason) => {
    const folder = fs.readdirSync(path.join(bootstrap, "recovery")).find((name) => name.endsWith(reason));
    return folder && path.join(bootstrap, "recovery", folder);
  };
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("registro truncado é guardado e o perfil reabre pelo registro de origem", () => {
    const saved = migrated();
    fs.writeFileSync(path.join(bootstrap, "storage-layout.json"), '{"version": 1, "media');
    expect(paths.needsMigration()).toBe(false);
    reopen();
    expect(paths.storageLayout()).toEqual(saved);
    expect(fs.readFileSync(path.join(keptIn("registro-invalido"), "storage-layout.json"), "utf8")).toBe('{"version": 1, "media');
  });

  it("perfil sem nenhum registro ganha o registro de volta, sem copiar a pasta antiga por cima", () => {
    const saved = migrated();
    fs.outputJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"), { language: "pt", changed: "nesta versão" });
    fs.removeSync(path.join(bootstrap, "storage-layout.json"));
    fs.removeSync(path.join(paths.dataDir(), ".layout-origin.json"));
    reopen();
    expect(paths.storageLayout()).toEqual(saved);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "pt", changed: "nesta versão" });
  });

  it("perfil sumido com o registro intacto copia os dados antigos de novo e mantém o acervo escolhido", () => {
    migrated();
    const chosen = path.join(root, "Acervo escolhido");
    fs.ensureDirSync(chosen);
    const layout = { ...paths.storageLayout(), mediaDir: chosen };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), layout);
    fs.removeSync(paths.dataDir());
    expect(paths.needsMigration()).toBe(true);
    reopen();
    expect(paths.filesDir()).toBe(chosen);
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
  });

  it("cópia interrompida que não é desta rotina é guardada e a migração segue", () => {
    fs.outputFileSync(path.join(bootstrap, "profile.migrating", "lixo.txt"), "?");
    migrated();
    expect(fs.readFileSync(path.join(keptIn("copia-desconhecida"), "profile.migrating", "lixo.txt"), "utf8")).toBe("?");
  });

  it("começar do zero: perfil vazio, acervo antigo em uso e nada da origem apagado", () => {
    const saved = migrated();
    fs.outputJsonSync(path.join(paths.dataDir(), "library", "liturgies.json"), [{ title: "quebrada" }]);
    recovery().request(bootstrap, "reset");
    reopen();
    expect(fs.existsSync(path.join(paths.dataDir(), "library", "liturgies.json"))).toBe(false);
    expect(fs.existsSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toBe(false);
    expect(paths.filesDir()).toBe(saved.mediaDir);
    expect(paths.storageLayout().setupCompleted).toBe(true);
    expect(fs.readJsonSync(path.join(keptIn("comecar-do-zero"), "profile", "library", "liturgies.json"))).toEqual([{ title: "quebrada" }]);
    expect(fs.readJsonSync(path.join(legacy(), "storage", "user_data.json"))).toEqual({ language: "es" });
    reopen();
    expect(fs.existsSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toBe(false);
  });

  it("começar do zero e trazer de volta mantêm as pastas escolhidas depois da migração", () => {
    migrated();
    // Como depois de "mover para a pasta padrão": a pasta antiga do acervo já não existe.
    const chosen = path.join(root, "Acervo movido");
    fs.moveSync(path.join(legacy(), "files"), chosen);
    const layout = { ...paths.storageLayout(), mediaDir: chosen };
    fs.outputJsonSync(path.join(bootstrap, "storage-layout.json"), layout);
    fs.outputJsonSync(path.join(paths.dataDir(), "library", "liturgies.json"), [{ title: "antes" }]);

    recovery().request(bootstrap, "reset");
    reopen();
    expect(fs.existsSync(path.join(paths.dataDir(), "library", "liturgies.json"))).toBe(false);
    expect(paths.filesDir()).toBe(chosen);
    expect(paths.videosDir()).toBe(layout.videosDir);
    expect(paths.storageLayout().setupCompleted).toBe(true);
    expect(fs.readJsonSync(path.join(keptIn("comecar-do-zero"), "storage-layout.json")).mediaDir).toBe(chosen);
    expect(fs.readdirSync(path.join(bootstrap, "recovery"))).toHaveLength(1);

    recovery().request(bootstrap, "reimport");
    reopen();
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(paths.filesDir()).toBe(chosen);
    expect(fs.readJsonSync(path.join(keptIn("trazer-de-volta"), "storage-layout.json")).mediaDir).toBe(chosen);
  });

  it("começar do zero com a pasta antiga sem acesso abre nos padrões, sem cair no provisório", () => {
    migrated();
    // O acervo e os vídeos de quem atualizou moram na pasta antiga: somem com ela.
    fs.moveSync(legacy(), path.join(root, "desconectado"));
    recovery().request(bootstrap, "reset");
    reopen();
    expect(paths.dataDirIssue()).toBeNull();
    expect(paths.filesDir()).toBe(sharedMedia);
    expect(paths.storageLayout().setupCompleted).toBe(false);
  });

  it("versão anterior aberta depois da migração é percebida, e trazer de volta copia a pasta antiga de novo", () => {
    migrated();
    expect(paths.olderVersionUsed()).toBeNull();
    fs.outputJsonSync(path.join(legacy(), "storage", "user_data.json"), { language: "pt", from: "beta.18" });
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(bootstrap, "data-location.json"), later, later);
    expect(paths.olderVersionUsed()).toMatchObject({ legacyRoot: legacy() });
    recovery().request(bootstrap, "reimport");
    reopen();
    expect(fs.readJsonSync(path.join(paths.dataDir(), "storage", "user_data.json"))).toEqual({ language: "pt", from: "beta.18" });
    expect(fs.readJsonSync(path.join(keptIn("trazer-de-volta"), "profile", "storage", "user_data.json"))).toEqual({ language: "es" });
    expect(paths.olderVersionUsed()).toBeNull();
  });

  it("manter como está não pergunta de novo", () => {
    migrated();
    paths.olderVersionUsed();
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(bootstrap, "data-location.json"), later, later);
    expect(paths.olderVersionUsed()).not.toBeNull();
    paths.acknowledgeOlderVersion();
    expect(paths.olderVersionUsed()).toBeNull();
  });

  it("conta as aberturas que falharam e só oferece começar do zero a partir da segunda", () => {
    const failure = new Error("Os dados antigos mudaram durante a migração");
    paths.useFallback(failure, recovery().recordFailure(bootstrap, failure));
    expect(paths.dataDirIssue()).toMatchObject({ attempts: 1, canReset: false });
    loadPaths();
    paths.useFallback(failure, recovery().recordFailure(bootstrap, failure));
    expect(paths.dataDirIssue()).toMatchObject({ attempts: 2, canReset: true });
    recovery().recordSuccess(bootstrap);
    expect(recovery().failures(bootstrap)).toBe(0);
  });
});
