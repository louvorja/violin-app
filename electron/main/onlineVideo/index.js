"use strict";

const path = require("path");
const paths = require("../paths.js");
const { createTools } = require("./tools.js");
const { createManager } = require("./manager.js");
const { isVideoId } = require("./ids.js");
const { safeSend } = require("../safeWebContents.js");
const { migrateDownloads } = require("./migration.js");
const { createYoutubeAccount, PARTITION } = require("./youtubeAccount.js");

let _account = null;
/** Conta do YouTube do operador (sessão separada do app; cookies fora da pasta de dados). */
function account() {
  if (!_account) {
    const { app, session, BrowserWindow } = require("electron");
    _account = createYoutubeAccount({
      session: () => session.fromPartition(PARTITION),
      cookiesFile: path.join(paths.bootstrapDir(), "youtube-cookies.txt"),
      createWindow: (opts) => new BrowserWindow(opts),
      userAgent: app.userAgentFallback,
    });
  }
  return _account;
}

let _manager = null;
let _ready = null;
let _dataDirChange = null;
let streamFailureReporter = null;
let presentationActive = false;

function setPresentationActive(active) {
  presentationActive = active === true;
  _manager?.setPresentationActive(presentationActive);
}

function setStreamFailureReporter(reporter) {
  streamFailureReporter = typeof reporter === "function" ? reporter : null;
}

/**
 * Forma estável do estado inativo. É deliberadamente síncrona e não chama
 * `getManager()`: runtime-health a consulta só ao montar um incidente e não
 * pode, por isso, criar cache, ferramentas ou trabalho de inicialização.
 */
function inactiveDiagnosticSnapshot() {
  return {
    online_video_manager_initialized: false,
    online_video_active_count: 0,
    online_video_resolving_count: 0,
    online_video_session_count: 0,
    online_video_foreground_running: 0,
    online_video_background_running: 0,
    online_video_foreground_queued: 0,
    online_video_background_queued: 0,
    online_video_streaming: 0,
    online_video_jobs: [],
    last_stream_failure: null,
  };
}

/** Instância única: vídeos em `dataDir/Videos`, ferramentas em `dataDir/bin`. */
function getManager() {
  if (!_manager) {
    const tools = createTools({ binDir: path.join(paths.dataDir(), "bin") });
    _manager = createManager({
      dir: paths.videosDir(),
      tools,
      // O YouTube passou a exigir a resolução de um desafio em JavaScript para
      // liberar os formatos. O próprio Electron, rodando como Node, faz isso sem
      // baixar mais nada (o runner liga ELECTRON_RUN_AS_NODE só para esse filho).
      jsRuntime: () => `node:${process.execPath}`,
      cookies: () => account().cookiesFor(),
      // O E2E provoca a renovação de propósito; uma renovação de minutos antes,
      // feita por uma falha passageira de rede, não pode deixá-lo sem o que testar.
      refreshCooldownMs: process.env.LJ_E2E_USER_DATA ? 0 : undefined,
      onStreamFailure: (failure) => streamFailureReporter?.(failure),
      presentationActive,
    });
    const manager = _manager;
    _ready = migrateDownloads(path.join(paths.bootstrapDir(), "online_videos"), manager.store.dir)
      .then(() => manager.init());
    // Troca o yt-dlp antigo pela versão desempacotada em segundo plano (ver tools.js).
    if (tools.needsUpgrade()) {
      void tools.ensure().catch((error) => console.warn("[onlineVideo] atualização do yt-dlp falhou:", error?.message || error));
    }
    // O boot e os pedidos IPC observam a mesma promessa, inclusive se falhar.
    void _ready.catch((error) => console.warn("[onlineVideo] inicialização falhou:", error?.message || error));
  }
  return _manager;
}

async function readyManager() {
  if (_dataDirChange) await _dataDirChange;
  const manager = getManager();
  await _ready;
  return manager;
}

/** Sem isto a falha só vira um aviso na tela, e não se sabe por quê (no Windows, sobretudo). */
function logFailure(operation, id, res) {
  // Bloqueio "não é um robô": para de adiantar consultas por um tempo (ver manager.noteBlocked).
  if (res && res.ok === false && res.error?.kind === "bot") _manager?.noteBlocked();
  if (res && res.ok === false && res.error?.kind !== "cancelled") {
    console.warn(`[onlineVideo] ${operation} falhou (${process.platform}-${process.arch}):`, id, res.error?.kind, res.error?.message);
  }
  return res;
}

/**
 * Resposta a um pedido `Range` do vídeo que ainda está baixando (protocolo
 * louvorja://onlinestream/), ou null se não há sessão dele.
 * @param {string} id
 * @param {"video"|"audio"} kind
 * @param {Request} request
 */
function serveStream(id, kind, request) {
  return _manager?.serveStream(id, kind, request.headers.get("range"), request.signal) ?? null;
}

/** Caminho em disco do vídeo já baixado, ou null. Usado pelo protocolo louvorja://. */
async function fileFor(id) {
  if (!isVideoId(id)) return null;
  const m = await readyManager();
  return m.store.has(id) ? m.store.pathFor(id) : null;
}

/**
 * Registra os handlers IPC. Cada operação é específica e recebe só o ID do
 * vídeo (validado), uma altura máxima entre valores permitidos e duas opções
 * booleanas de escolha fechada (`priority`, `keep`): o renderer não escolhe URL,
 * caminho nem argumento do yt-dlp. O que volta de `stream` são endereços
 * `louvorja://onlinestream/…` do próprio app: os links do YouTube (só de hosts
 * googlevideo, que o main confere) nunca chegam ao renderer.
 */
function registerIpc(ipcMain) {
  ipcMain.handle("onlineVideo:status", async () => (await readyManager()).status());

  ipcMain.handle("onlineVideo:ensure", async (event, id, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const options = {
      maxHeight: o.maxHeight,
      priority: o.priority === "background" ? "background" : "foreground",
      keep: o.keep === true,
    };
    return logFailure("ensure", id, await (await readyManager()).ensure(id, options, (progress) => {
      safeSend(event.sender, "onlineVideo:progress", progress);
    }));
  });

  ipcMain.handle("onlineVideo:stream", async (_event, id, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return logFailure("stream", id, await (await readyManager()).stream(id, { maxHeight: o.maxHeight, keep: o.keep === true }));
  });

  ipcMain.handle("onlineVideo:cancel", (_event, id) => _manager?.cancel(id) ?? false);
  // O play consulta um único ID. A listagem completa do cache pode fazer centenas de
  // stats sequenciais e atrasar a primeira imagem em discos lentos/antivírus.
  ipcMain.handle("onlineVideo:has", async (_event, id) => isVideoId(id) && (await readyManager()).store.has(id));
  ipcMain.handle("onlineVideo:keep", async (_event, id) => (await readyManager()).keep(id));
  ipcMain.handle("onlineVideo:prepare", async () => (await readyManager()).prepare());
  ipcMain.handle("onlineVideo:list", async () => (await readyManager()).list());
  // Conta do YouTube: o renderer só pede abrir o login, sair ou o estado — nunca vê os cookies.
  ipcMain.handle("onlineVideo:accountStatus", () => account().status());
  ipcMain.handle("onlineVideo:accountLogin", () => account().login());
  ipcMain.handle("onlineVideo:accountLogout", () => account().logout());
  // Resolve os links antes do play (prévia, "a seguir"); só ID e altura máxima, como `stream`.
  ipcMain.handle("onlineVideo:prefetch", async (_event, id, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return logFailure("prefetch", id, await (await readyManager()).prefetch(id, { maxHeight: o.maxHeight }));
  });
  // Canal ou playlist: `source` é `{ kind, id }`, validado e transformado em URL no main.
  ipcMain.handle("onlineVideo:collection", async (_event, source, range) =>
    logFailure("collection", source?.id, await (await readyManager()).collection(source, range))
  );
  ipcMain.handle("onlineVideo:remove", async (_event, id) => (await readyManager()).remove(id));
  ipcMain.handle("onlineVideo:clear", async () => (await readyManager()).clear());
}

function init() {
  getManager();
  return _ready;
}

/** Solta processos e trilhas antes de a pasta de dados ser movida ou trocada. */
async function releaseDataDir() {
  if (!_manager) return;
  await _ready.catch(() => {});
  await _manager.close();
  _manager = null;
  _ready = null;
}

/** Pedidos de vídeo aguardam a troca da raiz antes de resolver qualquer caminho. */
async function withDataDirChange(operation) {
  if (_dataDirChange) throw new Error("Mudança da pasta de dados já em andamento");
  let complete;
  _dataDirChange = new Promise((resolve) => { complete = resolve; });
  try {
    await releaseDataDir();
    return await operation();
  } finally {
    _dataDirChange = null;
    complete();
  }
}

function shutdown() {
  if (_manager) _manager.cancelAll();
}

function diagnosticSnapshot() {
  return _manager ? _manager.diagnosticSnapshot() : inactiveDiagnosticSnapshot();
}

module.exports = {
  getManager,
  fileFor,
  serveStream,
  registerIpc,
  init,
  releaseDataDir,
  withDataDirChange,
  shutdown,
  diagnosticSnapshot,
  setStreamFailureReporter,
  setPresentationActive,
};
