"use strict";

/**
 * jsonCache.js — Cache local de respostas JSON do servidor remoto.
 *
 * Salva cada arquivo JSON em <dados>/json_db/<caminho>.json com TTL diário.
 * Quando offline ou server retorna erro, serve o cache stale (melhor que falhar).
 *
 * Faz parte da Fase D2 — Cache de JSON do banco.
 */

const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const paths = require("./paths.js");
const netHealth = require("./netHealth.js");

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/** Avaliado em runtime para acompanhar a pasta escolhida em Armazenamento. */
function CACHE_DIR() {
  return paths.jsonCacheDir();
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Verifica se um arquivo cacheado ainda é válido (dentro do TTL).
 * @param {string} filePath
 * @returns {boolean}
 */
async function isCacheValid(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Faz uma requisição HTTP/HTTPS retornando o body como Buffer.
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<{status: number, body: Buffer, contentType: string}>}
 */
function httpRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "application/json",
        });
      });
    });
    req.on("error", (err) => {
      console.error(`[jsonCache] Erro na requisição para ${url}:`, err.message);
      reject(err);
    });
    req.setTimeout(15000, () => {
      console.warn(`[jsonCache] Timeout (15s) na requisição para ${url}`);
      req.destroy(new Error("Request timeout"));
    });
  });
}

/**
 * Sanitiza o caminho relativo para evitar path traversal e mapear para o fs.
 * Remove '..' e barras duplas, garante extensão .json.
 *
 * @param {string} relPath  Ex: "/pt_musics" ou "music_123"
 * @returns {string}        Caminho absoluto seguro em CACHE_DIR
 */
function safeLocalPath(relPath) {
  const cleaned = relPath
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "..")
    .join("/");

  // Garantir extensão .json (evitar duplicar se já vier com ela)
  const withJson = cleaned.endsWith(".json") ? cleaned : cleaned + ".json";
  return path.join(CACHE_DIR(), withJson);
}

// ---------------------------------------------------------------------------
// Deduplicação de requests in-flight
// ---------------------------------------------------------------------------

/**
 * Mapa de promises em andamento por path local.
 * Evita race condition quando múltiplas chamadas concorrentes pedem o mesmo arquivo.
 */
const _inflight = new Map();

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Resolve uma requisição de JSON: verifica cache local; se válido retorna do
 * disco; se não (ou stale), baixa do servidor remoto.
 *
 * Em caso de falha de rede/HTTP, serve o cache stale se existir.
 * Múltiplas chamadas concorrentes para o mesmo path compartilham a mesma promise.
 *
 * @param {string} relPath        Ex: "/pt_musics" ou "/music_123"
 * @param {string} remoteBaseUrl  Ex: "https://api.louvorja.workers.dev/json_db"
 * @param {object} headers        Headers para a requisição (Api-Token, etc.)
 * @returns {Promise<{body: Buffer|null, contentType: string, fromCache: boolean, status: number}>}
 */
async function fetchJson(relPath, remoteBaseUrl, headers = {}, { fresh = false } = {}) {
  let localPath = safeLocalPath(relPath);
  const requestKey = `${localPath}|${fresh ? "fresh" : "cached"}`;

  // Cache válido — retornar do disco (sem deduplicação necessária)
  if (!fresh && await isCacheValid(localPath)) {
    console.log(`[jsonCache] HIT ${relPath}`);
    return {
      body: await fs.readFile(localPath),
      contentType: "application/json",
      fromCache: true,
      status: 200,
    };
  }

  // Deduplicação: se já tem request em andamento para este path, reutiliza
  if (_inflight.has(requestKey)) {
    return _inflight.get(requestKey);
  }

  const promise = (async () => {
    let reached = false;
    try {
      // Remover barra inicial duplicada entre base e relPath
      const sep = relPath.startsWith("/") ? "" : "/";
      const remoteUrl = remoteBaseUrl + sep + relPath + (fresh ? `?_=${Date.now()}` : "");
      console.log(`[jsonCache] MISS ${relPath} — baixando: ${remoteUrl}`);
      const response = await httpRequest(remoteUrl, headers);
      localPath = safeLocalPath(relPath);
      reached = true;
      console.log(`[jsonCache] Resposta de ${relPath}: status=${response.status}`);

      netHealth.report(true, "jsonCache");

      if (response.status >= 200 && response.status < 300) {
        if (!response.body || response.body.length === 0) {
          throw new Error(`Resposta vazia do servidor para ${relPath}`);
        }
        try {
          JSON.parse(response.body.toString("utf-8"));
        } catch (parseErr) {
          console.warn(`[jsonCache] Resposta não é JSON válido: ${relPath} - Erro: ${parseErr.message}`);
          // Se falhou o parse mas temos cache stale, vamos usar o stale
          if (fs.existsSync(localPath)) {
            console.warn(`[jsonCache] Usando cache stale para ${relPath} devido a JSON inválido remoto`);
            return {
              body: await fs.readFile(localPath),
              contentType: "application/json",
              fromCache: true,
              status: 200,
            };
          }
          throw new Error(`JSON inválido: ${relPath}`);
        }

        // Escrita atômica: .tmp único (timestamp + random) → rename
        await fs.ensureDir(path.dirname(localPath));
        const tmp = `${localPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
        try {
          await fs.writeFile(tmp, response.body);
          await fs.move(tmp, localPath, { overwrite: true });
        } catch (writeErr) {
          // Limpar tmp órfão em caso de erro
          try { await fs.remove(tmp); } catch (_) { /* ignore */ }
          throw writeErr;
        }
        console.log(`[jsonCache] Cached ${relPath} → ${localPath}`);

        return {
          body: response.body,
          contentType: "application/json",
          fromCache: false,
          status: response.status,
        };
      }

      if (fs.existsSync(localPath)) {
        console.warn(
          `[jsonCache] HTTP ${response.status} para ${relPath}, usando cache stale`
        );
        return {
          body: await fs.readFile(localPath),
          contentType: "application/json",
          fromCache: true,
          status: 200,
        };
      }

      // 404 sem cache: recurso inexistente (ex. music_* órfão) — não lançar exceção
      if (response.status === 404) {
        console.warn(`[jsonCache] HTTP 404 para ${relPath} (sem cache local)`);
        return {
          body: null,
          contentType: "application/json",
          fromCache: false,
          status: 404,
        };
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (e) {
      localPath = safeLocalPath(relPath);
      // Resposta ruim (5xx, JSON inválido, disco) não é falta de internet: o
      // servidor foi alcançado, e contar isso adiantaria a queda por falso positivo.
      if (!reached) {
        netHealth.report(false, "jsonCache");
        e.networkFailure = true;
      }
      if (fs.existsSync(localPath)) {
        console.warn(
          `[jsonCache] Erro de rede, usando stale: ${relPath} (${e.message})`
        );
        return {
          body: await fs.readFile(localPath),
          contentType: "application/json",
          fromCache: true,
          status: 200,
        };
      }
      throw e;
    } finally {
      _inflight.delete(requestKey);
    }
  })();

  _inflight.set(requestKey, promise);
  return promise;
}

/**
 * Invalida (remove) todo o cache JSON.
 * Útil para o módulo de update forçar re-download.
 */
async function clearCache() {
  const dir = CACHE_DIR();
  if (await fs.pathExists(dir)) {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    console.log("[jsonCache] Cache limpo:", dir);
  }
}

/** Arquivo, dentro do cache, que guarda a versão do app que o preencheu. */
const VERSION_MARKER = ".app-version";

/**
 * Expira os JSONs ao atualizar o app, preservando-os como fallback offline.
 * A próxima leitura tenta a rede antes do disco, sem apagar um banco utilizável.
 */
async function expireOnAppUpdate(appVersion) {
  const dir = CACHE_DIR();
  const marker = path.join(dir, VERSION_MARKER);
  let stored = null;
  try { stored = (await fs.readFile(marker, "utf8")).trim(); } catch { /* primeira versão */ }
  if (stored === appVersion) return { expired: 0 };
  await fs.ensureDir(dir);
  let expired = 0;
  async function expireDirectory(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await expireDirectory(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        await fs.utimes(file, new Date(0), new Date(0));
        expired++;
      }
    }
  }
  await expireDirectory(dir);
  await fs.writeFile(marker, String(appVersion));
  return { expired };
}

/**
 * Retorna o caminho do diretório de cache (debug / módulo update).
 * @returns {string}
 */
function dir() {
  return CACHE_DIR();
}

module.exports = { fetchJson, clearCache, dir, safeLocalPath, expireOnAppUpdate };
