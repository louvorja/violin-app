/** Caminhos do desktop. O perfil é privado; acervo e vídeos têm raízes próprias. */
const { app } = require("electron");
const path = require("node:path");
const fs = require("fs-extra");
const layout = require("./storageLayout.js");
let resolved = null;
let fallback = null;

function bootstrapDir() {
  const isolated = process.env.LJ_E2E_USER_DATA?.trim();
  return isolated ? path.resolve(isolated) : path.join(app.getPath("appData"), "LouvorJA Violin");
}
function documentsDir() {
  try { return app.getPath("documents"); }
  catch { return path.join(bootstrapDir(), "media"); }
}
function videosDir() {
  // Respeita Known Folders, XDG e o nome Movies do macOS, inclusive redirecionamentos.
  const folder = app.getPath("videos");
  if (!layout.absolute(folder)) throw new Error("A pasta de vídeos do sistema não está disponível.");
  return folder;
}
function sharedMediaDir() {
  const isolated = process.env.LJ_E2E_USER_DATA?.trim();
  if (isolated) return path.join(path.resolve(isolated), "shared", "LouvorJA Violin", "Acervo");
  if (process.platform === "darwin") return "/Users/Shared/LouvorJA Violin/Acervo";
  if (process.platform === "linux") return "/var/lib/louvorja-violin/acervo";
  if (process.platform === "win32" && layout.absolute(process.env.PUBLIC)) {
    return path.join(process.env.PUBLIC, "Documents", "LouvorJA Violin", "Acervo");
  }
  throw new Error("Não foi possível localizar a pasta de acervo compartilhado do sistema.");
}
function migrationOptions() {
  const machineDefaults = process.platform === "win32" && !process.env.LJ_E2E_USER_DATA && process.env.ProgramData
    ? layout.readJson(path.join(process.env.ProgramData, "LouvorJA Violin", "storage-defaults.json")) : null;
  return { bootstrap: bootstrapDir(), documents: documentsDir(), videos: videosDir(), sharedMedia: sharedMediaDir(), programDir: programDir(), machineDefaults };
}
function programDir() {
  if (!app.isPackaged) return app.getAppPath();
  const directory = path.dirname(process.execPath);
  // No macOS todo o bundle .app pertence ao programa, não apenas app.asar.
  return process.platform === "darwin" ? path.resolve(directory, "../..") : directory;
}
function config() {
  if (!resolved) {
    resolved = layout.initialize(migrationOptions());
  }
  return resolved;
}
module.exports = {
  bootstrapDir,
  programDir,
  userData: () => app.getPath("userData"),
  dataDir: () => fallback?.profile || path.join(bootstrapDir(), "profile"),
  profileDir() { return path.join(this.dataDir(), ".electron"); },
  privateMediaDir() { return path.join(this.dataDir(), "attachments", "media"); },
  videoWorkDir() { return path.join(this.dataDir(), "temp", "videos"); },
  migrationOptions,
  needsMigration() {
    // A primeira instalação não tem um perfil grande para copiar. Layouts já
    // publicados só voltam ao auxiliar para aplicar uma mudança de pasta pedida.
    const current = layout.readJson(path.join(bootstrapDir(), "storage-layout.json"))
      || layout.readJson(path.join(this.dataDir(), ".layout-origin.json"));
    if (current) {
      layout.validateLayout(current, { profileDir: this.dataDir(), programDir: programDir() });
      return !!current.pending;
    }
    return layout.resolveInitial(this.migrationOptions()).layout.setupCompleted;
  },
  initialize() { return config(); },
  acceptPreparedLayout() {
    // O auxiliar já executou a tentativa deste boot. Um pendingError deve ir
    // para a UI, sem repetir imediatamente a cópia síncrona no processo pai.
    const current = layout.readJson(path.join(bootstrapDir(), "storage-layout.json"));
    layout.validateLayout(current, { profileDir: this.dataDir(), programDir: programDir() });
    const stat = fs.lstatSync(this.dataDir());
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("A pasta privada do usuário não está disponível.");
    resolved = structuredClone(current);
  },
  storageLayout() { return structuredClone(config()); },
  saveLayout(value) {
    // Publicar aqui marcaria a migração como feita e a origem nunca mais seria lida.
    if (fallback) throw new Error("Seus dados ainda não foram trazidos para esta versão. Abra o LouvorJA de novo depois de resolver o aviso.");
    layout.validateLayout(value, { profileDir: this.dataDir(), programDir: programDir() });
    layout.atomicJson(path.join(bootstrapDir(), "storage-layout.json"), value);
    resolved = structuredClone(value);
  },
  configureProfile() {
    config();
    const dir = this.profileDir();
    fs.ensureDirSync(dir, { mode: 0o700 });
    app.setPath("userData", dir);
    app.setPath("sessionData", dir);
    for (const [name, sub] of [["logs", "logs"], ["crashDumps", "Crashpad"]]) {
      const folder = path.join(dir, sub);
      fs.ensureDirSync(folder);
      app.setPath(name, folder);
    }
    return dir;
  },
  /**
   * Abre num perfil provisório quando os dados não puderam ser preparados. Nada
   * é publicado: a origem fica intacta e a próxima abertura tenta de novo.
   */
  useFallback(error) {
    const root = path.join(bootstrapDir(), "fallback");
    fallback = {
      profile: path.join(root, "profile"),
      issue: error?.code === "LJ_DATA_UNAVAILABLE"
        ? { reason: "unavailable", wanted: error.dir }
        : { reason: "failed", message: String(error?.message || error) },
    };
    resolved = { version: 1, setupCompleted: true, mediaDir: path.join(root, "Acervo"), videosDir: path.join(root, "Videos") };
    for (const dir of [fallback.profile, resolved.mediaDir, resolved.videosDir]) fs.ensureDirSync(dir, { mode: 0o700 });
  },
  profileRestartRequired: () => !!config().pending,
  dataDirIssue: () => fallback?.issue || null,
  mediaDir: () => config().mediaDir,
  filesDir: () => config().mediaDir,
  /** Cache de export do Canva: da conta, nunca no acervo compartilhado. */
  canvaDir() { return path.join(this.dataDir(), "canva"); },
  videosDir: () => config().videosDir,
  jsonCacheDir() { return path.join(this.dataDir(), "json_db"); },
  tempDir: () => app.getPath("temp"),
  appRoot: () => app.getAppPath(),
  webBuild: () => path.join(app.getAppPath(), "dist"),
  legacyMediaDirs() { return []; },
  privatePathMappings() {
    const origin = layout.readJson(path.join(this.dataDir(), ".layout-origin.json"));
    if (!origin?.legacyRoot) return [];
    return [
      { from: path.join(origin.mediaDir, "library", "media"), to: this.privateMediaDir() },
      { from: path.join(origin.legacyRoot, "files", "canva"), to: this.canvaDir() },
      { from: path.join(origin.legacyRoot, "canva"), to: this.canvaDir() },
      { from: path.join(bootstrapDir(), "canva"), to: this.canvaDir() },
      // PDFs e fontes do PowerPoint (módulo de apresentação) moram em <dados>/pptx.
      { from: path.join(origin.legacyRoot, "pptx"), to: path.join(this.dataDir(), "pptx") },
    ].filter(({ from, to }) => path.resolve(from) !== path.resolve(to));
  },
};
