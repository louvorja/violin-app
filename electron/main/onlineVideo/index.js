"use strict";

const path = require("path");
const paths = require("../paths.js");
const storageAccess = require("../storageAccess.js");
const { createTools } = require("./tools.js");
const { createManager } = require("./manager.js");
const runner = require("./runner.js");
const { createSpawnHost } = require("./spawnHost.js");
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
const { WorkPriority, canStartWork } = require("../presentationAdmission.js");

/** Depois do boot, para não disputar a abertura do app. */
const MAINTENANCE_DELAY_MS = 3 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Adiada por projeção aberta ou download em curso: tenta de novo logo. */
const MAINTENANCE_RETRY_MS = 10 * 60 * 1000;

let _manager = null;
let _spawnHost = null;
let _ready = null;
let streamFailureReporter = null;
let presentationActive = false;
let _maintenanceTimer = null;
let _maintaining = null;

function setPresentationActive(active) {
  const wasActive = presentationActive;
  presentationActive = active === true;
  _manager?.setPresentationActive(presentationActive);
  if (wasActive && !presentationActive && _maintenanceTimer) scheduleMaintenance(MAINTENANCE_RETRY_MS);
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
    // yt-dlp e ffmpeg nascem num processo utilitário: no Windows, criar o processo
    // espera o antivírus e, no main, congelaria todas as janelas.
    const host = (_spawnHost ||= createSpawnHost());
    const children = { spawnImpl: host.spawn, killImpl: host.killTree };
    const tools = createTools({ binDir: path.join(paths.dataDir(), "bin"), execFileImpl: host.execFile });
    // Antes de qualquer yt-dlp deste processo rodar; não segura a inicialização.
    void tools.cleanup().catch((error) => console.warn("[onlineVideo] limpeza do yt-dlp falhou:", error?.message || error));
    _manager = createManager({
      dir: paths.videosDir(),
      workDir: paths.videoWorkDir(),
      shared: storageAccess.status().videos?.shared === true,
      canWrite: () => storageAccess.canWrite("videos"),
      canMaintain: () => storageAccess.canMaintain("videos"),
      tools,
      run: (opts) => {
        tools.markUsed();
        return runner.run({ ...opts, ...children });
      },
      resolve: (opts) => {
        tools.markUsed();
        return runner.resolveStreams({ ...opts, ...children });
      },
      mux: (opts) => runner.muxCopy({ ...opts, ...children }),
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
    _ready = (storageAccess.canWrite("videos")
      ? migrateDownloads(path.join(paths.bootstrapDir(), "online_videos"), manager.store.dir, {
        workDir: paths.videoWorkDir(), shared: storageAccess.status().videos?.shared === true,
      })
      : Promise.resolve())
      .then(() => manager.init());
    // O boot e os pedidos IPC observam a mesma promessa, inclusive se falhar.
    void _ready.catch((error) => console.warn("[onlineVideo] inicialização falhou:", error?.message || error));
  }
  return _manager;
}

async function readyManager() {
  const manager = getManager();
  await _ready;
  return manager;
}

/** A opção "Baixar" de Opções → Vídeos On-line (ligada por padrão). */
function downloadPreferenceEnabled() {
  try {
    const userData = require("../userStore.js").read("user_data");
    return userData?.options?.online_video_projection?.download !== false;
  } catch {
    return true;
  }
}

/**
 * Deixa as ferramentas instaladas e o yt-dlp em dia sem que ninguém peça: quem
 * abre um vídeo não espera a instalação (13 s na mediana do Windows, 105 s no
 * p90), e o yt-dlp acompanha o YouTube sem o app ser atualizado. Trabalho de
 * fundo: não começa com projeção aberta nem com vídeo baixando.
 *
 * @param {{ ignoreDormancy?: boolean }} [opts] o operador acabou de abrir um módulo de vídeo
 * @returns {Promise<{ action: string }>}
 */
function maintainTools(opts = {}) {
  if (_maintaining) return _maintaining;
  _maintaining = (async () => {
    if (!canStartWork(WorkPriority.BACKGROUND, presentationActive)) return { action: "presentation" };
    const manager = await readyManager();
    const snapshot = manager.diagnosticSnapshot();
    if (snapshot.online_video_active_count > 0 || snapshot.online_video_resolving_count > 0) {
      return { action: "busy" };
    }
    const tools = manager.tools;
    if (!tools.ready() || tools.needsPot?.()) {
      if (!downloadPreferenceEnabled()) return { action: "disabled" };
      return tools.preinstall();
    }
    return tools.checkForUpdate(opts);
  })()
    .catch((error) => {
      console.warn("[onlineVideo] manutenção das ferramentas falhou:", error?.kind || "", error?.message || error);
      return { action: "error" };
    })
    .finally(() => {
      _maintaining = null;
    });
  return _maintaining;
}

function scheduleMaintenance(delay = MAINTENANCE_DELAY_MS) {
  clearTimeout(_maintenanceTimer);
  _maintenanceTimer = setTimeout(async () => {
    const { action } = await maintainTools();
    const deferred = action === "presentation" || action === "busy";
    scheduleMaintenance(deferred ? MAINTENANCE_RETRY_MS : MAINTENANCE_INTERVAL_MS);
  }, delay);
  _maintenanceTimer.unref?.();
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
  ipcMain.handle("onlineVideo:prepare", async (event) => {
    const manager = await readyManager();
    const result = await manager.prepare((progress) => {
      safeSend(event.sender, "onlineVideo:progress", { id: "__tools__", ...progress });
    });
    // Quem volta a usar vídeo depois de um tempo parado recebe o yt-dlp em dia, ao fundo.
    if (result?.ok) void maintainTools({ ignoreDormancy: true });
    return result;
  });
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
  // O E2E usa perfil isolado e não pode baixar ferramentas por conta própria no meio do teste.
  if (!process.env.LJ_E2E_USER_DATA) scheduleMaintenance();
  return _ready;
}

/** Solta processos e trilhas antes de a pasta de dados ser movida ou trocada. */
async function releaseDataDir() {
  clearTimeout(_maintenanceTimer);
  _maintenanceTimer = null;
  await _maintaining;
  if (!_manager) return;
  await _ready.catch(() => {});
  await _manager.close();
  _manager = null;
  _ready = null;
}

/** Cancela tudo e espera (no máximo 2 s) o processo utilitário encerrar os filhos. */
async function shutdown() {
  clearTimeout(_maintenanceTimer);
  _maintenanceTimer = null;
  if (_manager) _manager.cancelAll();
  await _spawnHost?.settle(2_000);
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
  maintainTools,
  releaseDataDir,
  shutdown,
  diagnosticSnapshot,
  setStreamFailureReporter,
  setPresentationActive,
};
