"use strict";
const https = require("https");
const http = require("http");
const apiClient = require("./api.js");
const integrity = require("./integrity.js");
const { HttpQueue } = require("./httpQueue.js");

let _activeQueue = null;
let _filesUrl = "";
let _apiUrl = "";
let _apiToken = "";

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
function _probeHost(urlStr) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        { method: "HEAD", host: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname || "/", headers: _apiToken ? { "Api-Token": _apiToken } : {} },
        (res) => {
          // 200/204/301/302/403/404 todos indicam servidor up. Só 5xx ou erro de rede falham.
          if (res.statusCode >= 500) {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          } else {
            resolve({ ok: true, host: url.hostname });
          }
          res.resume();
        }
      );
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.setTimeout(15000, () => {
        req.destroy(new Error("Timeout"));
        resolve({ ok: false, error: "Timeout" });
      });
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
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
  const results = await Promise.all(hosts.map(_probeHost));
  const success = results.find((r) => r.ok);
  return success || results[0];
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
  if (_activeQueue) throw new Error("Download já em andamento");
  if (!_filesUrl) throw new Error("filesUrl não configurada — chame setApiConfig antes");

  // Filtrar arquivos já OK
  const { missing, damaged } = integrity.diff(files);
  const toDownload = [...missing, ...damaged];

  if (toDownload.length === 0) {
    return { queued: 0, message: "Todos os arquivos já estão atualizados" };
  }

  _activeQueue = new HttpQueue({ baseUrl: _filesUrl, apiToken: _apiToken });
  _activeQueue.add(toDownload);

  _activeQueue.on("progress", (data) => webContents.send("download:progress", data));
  _activeQueue.on("file-done", (data) => webContents.send("download:file-done", data));
  _activeQueue.on("file-error", (data) => webContents.send("download:file-error", data));
  _activeQueue.on("queue-done", (data) => {
    webContents.send("download:queue-done", data);
    _activeQueue = null;
  });
  _activeQueue.on("queue-cancelled", () => {
    webContents.send("download:queue-cancelled");
    _activeQueue = null;
  });

  // Não await — queue roda em background, eventos reportam progresso
  _activeQueue.start();

  return { queued: toDownload.length };
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

function checkFiles(files) {
  return integrity.diff(files);
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
  checkFiles,
};
