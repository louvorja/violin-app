"use strict";
const path = require("path");
const https = require("https");
const http = require("http");
const paths = require("../paths.js");
const apiClient = require("./api.js");
const integrity = require("./integrity.js");
const { UtilityQueue } = require("./utilityQueue.js");
const { validateDownloadEntries } = require("./requestValidation.js");
const { safeSend } = require("../safeWebContents.js");

// Apenas as origens do acervo oficial. A base configurada também é aceita
// pelo validador; origens recebidas do renderer nunca entram nesta lista.
const TRUSTED_MEDIA_ORIGINS = ["https://cdn.louvorja.com", "https://api.louvorja.com.br"];

let _activeQueue = null;
let _startingDownload = false;
let _filesUrl = "";
let _apiUrl = "";
let _apiToken = "";

function _validatedFiles(files, filesDir, filesUrl) {
  const entries = validateDownloadEntries(files, {
    filesDir,
    filesBaseUrl: filesUrl,
    allowedRemoteOrigins: TRUSTED_MEDIA_ORIGINS,
  });
  const destinations = new Set();
  for (const entry of entries) {
    const absolute = path.resolve(filesDir, entry.local);
    const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (destinations.has(key)) throw new TypeError("download files: destino duplicado");
    destinations.add(key);
  }
  return entries;
}

function setApiConfig(cfg) {
  apiClient.setConfig(cfg);
  if (cfg?.filesUrl) _filesUrl = cfg.filesUrl;
  if (cfg?.apiUrl) _apiUrl = cfg.apiUrl;
  if (cfg?.apiToken) _apiToken = cfg.apiToken;
}

async function getParams(force = false) {
  return await apiClient.getParams({ force });
}

/** Sonda um único host via HEAD. Resolve, nunca rejeita. */
function _probeHost(urlStr, signal) {
  return new Promise((resolve) => {
    let req = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      req?.destroy();
      finish({ ok: false, error: "Sonda cancelada" });
    };

    if (signal?.aborted) {
      finish({ ok: false, error: "Sonda cancelada" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const url = new URL(urlStr);
      const lib = url.protocol === "https:" ? https : http;
      req = lib.request(
        { method: "HEAD", host: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname || "/", headers: _apiToken ? { "Api-Token": _apiToken } : {} },
        (res) => {
          if (settled) {
            res.resume();
            return;
          }
          // 200/204/301/302/403/404 todos indicam servidor up. Só 5xx ou erro de rede falham.
          if (res.statusCode >= 500) {
            finish({ ok: false, error: `HTTP ${res.statusCode}` });
          } else {
            finish({ ok: true, host: url.hostname });
          }
          res.resume();
        }
      );
      req.on("error", (e) => finish({ ok: false, error: e.message }));
      req.setTimeout(15000, () => {
        req.destroy(new Error("Timeout"));
        finish({ ok: false, error: "Timeout" });
      });
      req.end();
    } catch (e) {
      finish({ ok: false, error: e.message });
    }
  });
}

/**
 * Verifica conectividade sondando arquivos e API em paralelo — qualquer um
 * respondendo já conta como "online". Um único host de mídia fora do ar
 * (CDN lenta, manutenção) não pode, sozinho, marcar a internet como caída
 * quando a API principal está saudável.
 */
async function checkConnection() {
  const hosts = [_filesUrl, _apiUrl].filter(Boolean);
  if (!hosts.length) return { ok: false, error: "nenhuma URL configurada" };

  // A resposta útil deve liberar a interface imediatamente. Antes, um CDN
  // que não respondia fazia a API saudável esperar 15s porque Promise.all só
  // concluía quando o pior host terminava. As sondas perdedoras são abortadas
  // para não deixar sockets/requests pendurados no processo principal.
  const controllers = hosts.map(() => new AbortController());
  return await new Promise((resolve) => {
    let pending = hosts.length;
    let firstFailure = null;
    let settled = false;

    hosts.forEach((host, index) => {
      _probeHost(host, controllers[index].signal).then((result) => {
        if (settled) return;
        if (result.ok) {
          settled = true;
          controllers.forEach((controller, otherIndex) => {
            if (otherIndex !== index) controller.abort();
          });
          resolve(result);
          return;
        }
        firstFailure ||= result;
        pending -= 1;
        if (pending === 0) {
          settled = true;
          resolve(firstFailure || result);
        }
      });
    });
  });
}

/**
 * Inicia download de uma lista de arquivos via HTTPS.
 * Eventos via webContents.send("download:progress" | "download:file-done" | etc.)
 *
 * @param {Array<{remote:string, local:string, expectedSize?:number}>} files
 * @param {Electron.WebContents} webContents
 * @returns {Promise<{ queued: number }>}
 */
async function startDownload(files, webContents) {
  if (_activeQueue || _startingDownload) throw new Error("Download já em andamento");
  if (!_filesUrl) throw new Error("filesUrl não configurada — chame setApiConfig antes");

  _startingDownload = true;
  try {
    const filesDir = paths.filesDir();
    const filesUrl = _filesUrl;
    const apiToken = _apiToken;
    // Valida antes de qualquer stat ou socket. A lista passa a ser um snapshot
    // fechado: nada da entrada IPC não confiável chega à fila de trabalho.
    const entries = _validatedFiles(files, filesDir, filesUrl);
    // Filtrar arquivos já OK sem bloquear o main durante a varredura.
    const { missing, damaged } = await integrity.diff(entries);
    if (paths.filesDir() !== filesDir) {
      throw new Error("Pasta de arquivos alterada durante o preparo do download; tente novamente");
    }
    const toDownload = [...missing, ...damaged];

    if (toDownload.length === 0) {
      return { queued: 0, message: "Todos os arquivos já estão atualizados" };
    }

    _activeQueue = new UtilityQueue({
      baseUrl: filesUrl,
      apiToken,
      filesDir,
      allowedRemoteOrigins: TRUSTED_MEDIA_ORIGINS,
    });
    _activeQueue.add(toDownload.map((entry) => ({
      remote: entry.remote,
      remoteUrl: entry.remoteUrl,
      local: path.resolve(filesDir, entry.local),
      expectedSize: entry.expectedSize,
    })));

    _activeQueue.on("progress", (data) => safeSend(webContents, "download:progress", data));
    _activeQueue.on("file-done", (data) => safeSend(webContents, "download:file-done", data));
    _activeQueue.on("file-error", (data) => safeSend(webContents, "download:file-error", data));
    _activeQueue.on("queue-done", (data) => {
      safeSend(webContents, "download:queue-done", data);
      _activeQueue = null;
    });
    _activeQueue.on("queue-cancelled", () => {
      safeSend(webContents, "download:queue-cancelled");
      _activeQueue = null;
    });

    // Não await — queue roda em background, eventos reportam progresso
    _activeQueue.start();

    return { queued: toDownload.length };
  } finally {
    _startingDownload = false;
  }
}

function cancelDownload() {
  if (_activeQueue) {
    _activeQueue.cancel();
    return true;
  }
  return false;
}

function pauseDownload() {
  if (_activeQueue && !_activeQueue.paused) {
    _activeQueue.pause();
    return true;
  }
  return false;
}

function resumeDownload() {
  if (_activeQueue && _activeQueue.paused) {
    _activeQueue.resume();
    return true;
  }
  return false;
}

function isDownloading() {
  return !!(_activeQueue && _activeQueue.running);
}

function shutdown() {
  return _activeQueue?.shutdown() || Promise.resolve();
}

function checkFiles(files) {
  const entries = _validatedFiles(files, paths.filesDir(), _filesUrl);
  return integrity.diff(entries);
}

module.exports = {
  setApiConfig,
  getParams,
  checkConnection,
  startDownload,
  cancelDownload,
  pauseDownload,
  resumeDownload,
  isDownloading,
  shutdown,
  checkFiles,
};
