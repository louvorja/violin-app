/** Caminhos do desktop. O perfil é privado; acervo e vídeos têm raízes próprias. */
const { app } = require("electron");
const path = require("node:path");
const fs = require("fs-extra");
const layout = require("./storageLayout.js");
let resolved = null;

function bootstrapDir() {
  const isolated = process.env.LJ_E2E_USER_DATA?.trim();
  return isolated ? path.resolve(isolated) : path.join(app.getPath("appData"), "LouvorJA Violin");
}
function documentsDir() {
  try { return app.getPath("documents"); }
  catch { return path.join(bootstrapDir(), "media"); }
}
function programDir() {
  if (!app.isPackaged) return app.getAppPath();
  const directory = path.dirname(process.execPath);
  // No macOS todo o bundle .app pertence ao programa, não apenas app.asar.
  return process.platform === "darwin" ? path.resolve(directory, "../..") : directory;
}
function config() {
  if (!resolved) {
    const machineDefaults = process.platform === "win32" && !process.env.LJ_E2E_USER_DATA && process.env.ProgramData
      ? layout.readJson(path.join(process.env.ProgramData, "LouvorJA Violin", "storage-defaults.json")) : null;
    resolved = layout.initialize({ bootstrap: bootstrapDir(), documents: documentsDir(), programDir: programDir(), machineDefaults });
  }
  return resolved;
}
module.exports = {
  bootstrapDir,
  programDir,
  userData: () => app.getPath("userData"),
  dataDir: () => path.join(bootstrapDir(), "profile"),
  profileDir() { return path.join(this.dataDir(), ".electron"); },
  privateMediaDir() { return path.join(this.dataDir(), "attachments", "media"); },
  videoWorkDir() { return path.join(this.dataDir(), "video-work"); },
  initialize() { return config(); },
  storageLayout() { return structuredClone(config()); },
  saveLayout(value) {
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
  profileRestartRequired: () => !!config().pending,
  dataDirIssue: () => null,
  mediaDir: () => config().mediaDir,
  filesDir: () => config().mediaDir,
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
      { from: path.join(origin.legacyRoot, "canva"), to: path.join(this.dataDir(), "canva") },
      { from: path.join(bootstrapDir(), "canva"), to: path.join(this.dataDir(), "canva") },
    ].filter(({ from, to }) => path.resolve(from) !== path.resolve(to));
  },
};
