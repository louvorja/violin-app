"use strict";

const path = require("path");
const paths = require("../paths.js");
const { createTools } = require("./tools.js");
const { createManager } = require("./manager.js");
const { isVideoId } = require("./ids.js");
const { safeSend } = require("../safeWebContents.js");

let _manager = null;

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

/** Instância única: cache em `userData/online_videos`, ferramentas em `userData/bin`. */
function getManager() {
  if (!_manager) {
    const userData = paths.userData();
    const tools = createTools({ binDir: path.join(userData, "bin") });
    _manager = createManager({
      dir: path.join(userData, "online_videos"),
      tools,
      // O YouTube passou a exigir a resolução de um desafio em JavaScript para
      // liberar os formatos. O próprio Electron, rodando como Node, faz isso sem
      // baixar mais nada (o runner liga ELECTRON_RUN_AS_NODE só para esse filho).
      jsRuntime: () => `node:${process.execPath}`,
      // O E2E provoca a renovação de propósito; uma renovação de minutos antes,
      // feita por uma falha passageira de rede, não pode deixá-lo sem o que testar.
      refreshCooldownMs: process.env.LJ_E2E_USER_DATA ? 0 : undefined,
    });
  }
  return _manager;
}

/** Sem isto a falha só vira um aviso na tela, e não se sabe por quê (no Windows, sobretudo). */
function logFailure(operation, id, res) {
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
  return getManager().serveStream(id, kind, request.headers.get("range"), request.signal);
}

/** Caminho em disco do vídeo já baixado, ou null. Usado pelo protocolo louvorja://. */
function fileFor(id) {
  if (!isVideoId(id)) return null;
  const m = getManager();
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
  ipcMain.handle("onlineVideo:status", () => getManager().status());

  ipcMain.handle("onlineVideo:ensure", async (event, id, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const options = {
      maxHeight: o.maxHeight,
      priority: o.priority === "background" ? "background" : "foreground",
      keep: o.keep === true,
    };
    return logFailure("ensure", id, await getManager().ensure(id, options, (progress) => {
      safeSend(event.sender, "onlineVideo:progress", progress);
    }));
  });

  ipcMain.handle("onlineVideo:stream", async (_event, id, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return logFailure("stream", id, await getManager().stream(id, { maxHeight: o.maxHeight, keep: o.keep === true }));
  });

  ipcMain.handle("onlineVideo:cancel", (_event, id) => getManager().cancel(id));
  // O play consulta um único ID. A listagem completa do cache pode fazer centenas de
  // stats sequenciais e atrasar a primeira imagem em discos lentos/antivírus.
  ipcMain.handle("onlineVideo:has", (_event, id) => isVideoId(id) && getManager().store.has(id));
  ipcMain.handle("onlineVideo:keep", (_event, id) => getManager().keep(id));
  ipcMain.handle("onlineVideo:prepare", () => getManager().prepare());
  ipcMain.handle("onlineVideo:list", () => getManager().list());
  ipcMain.handle("onlineVideo:remove", (_event, id) => getManager().remove(id));
  ipcMain.handle("onlineVideo:clear", () => getManager().clear());
}

function init() {
  return getManager().init();
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
  shutdown,
  diagnosticSnapshot,
};
