"use strict";

// A cópia precisa acabar antes de configurar a sessão Chromium definitiva.
// Um Electron auxiliar usa exclusivamente um perfil temporário para mostrar
// progresso. O processo principal conserva seu singleton e continua no mesmo
// PID ao terminar: não derruba o Vite nem perde a conexão do Playwright.
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { createHostLeases } = require("./storageCollectionLeaseBridge.cjs");
const FLAG = "--lj-storage-bootstrap";
const REQUEST_ENV = "LJ_STORAGE_BOOTSTRAP_REQUEST";
const PHASES = new Set(["scanning", "copying", "verifying", "publishing", "complete"]);

function validateRequest(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.ownedBootstrapPid)
    || value.ownedBootstrapPid <= 0 || value.ownedBootstrapPid === process.pid
    || ["bootstrap", "documents", "videos", "sharedMedia", "programDir"].some((key) =>
      typeof value[key] !== "string" || !path.isAbsolute(value[key]) || value[key].includes("\0"))) {
    throw new Error("A solicitação de migração é inválida.");
  }
  return value;
}

function prepare(app, options) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "louvorja-storage-startup-"));
  fs.chmodSync(temporary, 0o700);
  const requestFile = path.join(temporary, "request.json");
  fs.writeJsonSync(requestFile, { version: 1, ...options, ownedBootstrapPid: process.pid }, { mode: 0o600 });
  const env = { ...process.env, [REQUEST_ENV]: requestFile };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = app.isPackaged ? [FLAG] : [app.getAppPath(), FLAG];
  // Respeitar somente opções explícitas do processo pai (por exemplo o wrapper
  // de desenvolvimento); o auxiliar não altera sandbox nem backend gráfico.
  if (app.commandLine.hasSwitch("no-sandbox")) args.push("--no-sandbox");
  const ozone = app.commandLine.getSwitchValue("ozone-platform");
  if (ozone) args.push(`--ozone-platform=${ozone}`);
  console.info("[storage] Preparando os dados; a janela de migração mostrará o progresso.");
  try {
    const result = spawnSync(process.execPath, args, { env, stdio: ["ignore", "inherit", "inherit"] });
    if (result.error) throw result.error;
    let status;
    try { status = fs.readJsonSync(path.join(temporary, "result.json")); } catch { /* processo interrompido */ }
    if (result.status !== 0 || status?.ok !== true) {
      throw new Error(status?.error || "A preparação dos dados foi interrompida. Os arquivos originais foram preservados; abra o aplicativo novamente para tentar de novo.");
    }
  } finally {
    // Nunca remover staging/origem aqui: pertencem ao protocolo de migração.
    // No Windows, Chromium/antivírus podem manter um handle por instantes após
    // o auxiliar sair. Limpar sua UI temporária não pode impedir o boot pronto.
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) { console.warn("[storage] A limpeza da janela temporária ficou pendente:", error.code || error.message); }
  }
}

function validProgress(value) {
  return value && PHASES.has(value.phase) && Number.isSafeInteger(value.files) && value.files >= 0
    && Number.isFinite(value.bytes) && value.bytes >= 0;
}

function runHelper() {
  const { app, BrowserWindow } = require("electron");
  let request, temporary;
  try {
    const file = process.env[REQUEST_ENV];
    if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("Solicitação de migração ausente.");
    temporary = path.dirname(file);
    request = validateRequest(fs.readJsonSync(file));
    // O filho nunca abre o perfil original nem o destino em preparação.
    const userData = path.join(temporary, "ui-profile");
    fs.ensureDirSync(userData, { mode: 0o700 });
    app.setName("LouvorJA Violin");
    app.setPath("userData", userData);
    app.setPath("sessionData", userData);
    for (const name of ["logs", "crashDumps"]) {
      const dir = path.join(userData, name);
      fs.ensureDirSync(dir);
      app.setPath(name, dir);
    }
  } catch (error) {
    console.error("[storage] Não foi possível abrir a preparação:", error.message);
    app.exit(1);
    return;
  }

  let worker = null, window = null, finished = false, exitCode = 1;
  const collectionLeases = createHostLeases(require("./storageAccess.js").acquire);
  let lastProgress = { phase: "scanning", files: 0, bytes: 0 };
  const saveResult = (value) => fs.writeJsonSync(path.join(temporary, "result.json"), value, { mode: 0o600 });
  const update = (value) => {
    if (window && !window.isDestroyed()) {
      window.webContents.executeJavaScript(`window.updateStorageProgress(${JSON.stringify(value)})`).catch(() => {});
    }
  };
  const fail = (message) => {
    if (finished) return;
    finished = true;
    console.error("[storage] Preparação interrompida:", message);
    saveResult({ ok: false, error: message });
    update({ error: message });
    // Ninguém fecha uma janela que não aparece: sem isso a abertura esperaria para sempre.
    if (!window || window.isDestroyed() || !window.isVisible()) app.exit(1);
  };
  const watchdog = setInterval(() => {
    try { process.kill(request.ownedBootstrapPid, 0); }
    catch {
      // A origem e o staging ficam intactos. Sem o pai não há singleton que
      // autorize continuar ou publicar uma cópia enquanto outra instância abre.
      void worker?.terminate().finally(() => app.exit(1));
      if (!worker) app.exit(1);
    }
  }, 250);
  app.on("before-quit", (event) => { if (!finished) event.preventDefault(); });
  app.on("window-all-closed", () => app.exit(exitCode));
  app.on("will-quit", () => clearInterval(watchdog));
  app.whenReady().then(async () => {
    const language = app.getLocale().startsWith("es") ? "es" : "pt";
    window = new BrowserWindow({
      width: 520, height: 250, useContentSize: true, resizable: false,
      autoHideMenuBar: true, show: false, title: "LouvorJA Violin",
      webPreferences: { partition: "storage-preparation", contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.on("close", (event) => { if (!finished) event.preventDefault(); });
    window.once("ready-to-show", () => {
      if (process.env.LJ_E2E_BACKGROUND_WINDOWS !== "1") window.show();
    });
    await window.loadFile(path.join(__dirname, "..", "storage-bootstrap.html"), { query: { language } });
    update(lastProgress);
    worker = new Worker(path.join(__dirname, "storageBootstrapWorker.cjs"), { workerData: request });
    worker.on("message", (message) => {
      if (finished) return;
      if (collectionLeases.handle(message)) return;
      if (message?.type === "progress" && validProgress(message.progress)) {
        lastProgress = message.progress;
        update(lastProgress);
      } else if (message?.type === "complete") {
        finished = true;
        exitCode = 0;
        saveResult({ ok: true });
        clearInterval(watchdog);
        app.exit(0);
      } else if (message?.type === "error" && typeof message.message === "string") fail(message.message);
    });
    worker.on("error", (error) => fail(error.message));
    worker.on("exit", (code) => {
      collectionLeases.releaseAll();
      if (!finished) fail(`A preparação dos dados foi interrompida (código ${code}).`);
    });
  }).catch((error) => {
    fail(error.message);
    app.exit(1);
  });
}

module.exports = { FLAG, REQUEST_ENV, prepare, runHelper, validateRequest, validProgress };
