"use strict";
const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const paths = require("../paths.js");
const apiConfig = require("../apiConfig.js");

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_FILE = () => path.join(paths.userData(), "configweb.json");

let _config = {
  paramsUrl: "",
  apiToken: "",
};

function setConfig(cfg) {
  _config = { ..._config, ...cfg };
}

/**
 * Parser INI simples (key=value por linha, ignora seções [...] e comentários #/;).
 * @param {string} text
 * @returns {Record<string,string>}
 */
function parseIni(text) {
  const result = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("[")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) result[key] = value;
  });
  return result;
}

function httpRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timeout")));
  });
}

/**
 * Constrói URL de fallback para paramsUrl.
 * Se paramsUrl aponta para a API principal, retorna o equivalente na API de fallback.
 */
function _getFallbackParamsUrl() {
  const cfg = apiConfig.getConfig();
  if (!cfg.apiUrlFallback || !_config.paramsUrl) return null;
  if (_config.paramsUrl.startsWith(cfg.apiUrl)) {
    return _config.paramsUrl.replace(cfg.apiUrl, cfg.apiUrlFallback);
  }
  return null;
}

/**
 * Lê params (com cache TTL diário). Retorna objeto com todos os endpoints.
 * Tenta a API principal; se falhar, tenta a API de fallback.
 * @param {{ force?: boolean }} options
 * @returns {Promise<Record<string,string>>}
 */
async function getParams({ force = false } = {}) {
  const cacheFile = CACHE_FILE();

  if (!force && fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < TTL_MS) {
      try {
        return await fs.readJson(cacheFile);
      } catch (_) { /* invalido, refetch */ }
    }
  }

  if (!_config.paramsUrl) {
    if (fs.existsSync(cacheFile)) {
      console.warn("[download.api] paramsUrl não configurada — usando cache stale");
      return await fs.readJson(cacheFile);
    }
    throw new Error(
      "download.api: paramsUrl não configurada. O renderer envia via setApiConfig no boot."
    );
  }

  console.log(`[download.api] Buscando params: ${_config.paramsUrl}`);
  let response = await httpRequest(_config.paramsUrl, { "Api-Token": _config.apiToken });

  // Fallback: se a API principal falhou, tenta a API de fallback
  if (response.status !== 200) {
    const fallbackUrl = _getFallbackParamsUrl();
    if (fallbackUrl) {
      const cfg = apiConfig.getConfig();
      console.log(`[download.api] Fallback params: ${fallbackUrl}`);
      response = await httpRequest(fallbackUrl, { "Api-Token": cfg.apiUrlFallbackToken || cfg.apiToken || "" });
    }
  }

  if (response.status !== 200) {
    // Fallback: usar cache stale se existir
    if (fs.existsSync(cacheFile)) {
      console.warn(`[download.api] HTTP ${response.status}, usando cache stale`);
      return await fs.readJson(cacheFile);
    }
    throw new Error(`HTTP ${response.status} ao buscar params`);
  }

  const text = response.body.toString("utf-8");
  const params = parseIni(text);

  // Persistir cache
  await fs.ensureDir(path.dirname(cacheFile));
  await fs.writeJson(cacheFile, params, { spaces: 2 });
  console.log(`[download.api] Params atualizados (${Object.keys(params).length} chaves)`);

  return params;
}

module.exports = { getParams, setConfig, parseIni };
