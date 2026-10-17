"use strict";
const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const os = require("os");
const { EventEmitter } = require("events");
const { pathToFileURL } = require("url");

const DEFAULT_PROGRESS_INTERVAL_MS = 100;
const MAX_REDIRECTS = 3;
// Um parcial mais velho que isto não é retomado: o arquivo no servidor pode ter mudado.
const PARTIAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Esperas entre novas tentativas do mesmo arquivo; cada uma retoma de onde parou.
const DEFAULT_RETRY_DELAYS_MS = [1000, 4000];
const RESUMABLE_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED",
]);

// ESM compartilhado com o renderer (WebFileStore); o import dinâmico é o que
// permite ao CommonJS carregá-lo sem manter uma cópia.
let _adaptiveModule = null;
function loadAdaptiveConcurrency() {
  _adaptiveModule ||= import(pathToFileURL(path.join(__dirname, "adaptiveConcurrency.mjs")).href);
  return _adaptiveModule;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HttpQueue — fila de downloads HTTPS com pool de workers concorrentes.
 * Usada para baixar mídia (capas, áudio, imagens das letras) via
 * VITE_URL_FILES.
 *
 * Eventos:
 *   "progress" → { current, total, file, bytes, totalBytes }
 *   "file-done" → { file, localPath }
 *   "file-error" → { file, error }
 *   "queue-done" → { downloaded, failed }
 *   "queue-cancelled"
 */
class HttpQueue extends EventEmitter {
  /**
   * @param {{ baseUrl: string, apiToken?: string, concurrency?: number, progressIntervalMs?: number, filesDir?: string }} options
   */
  constructor({ baseUrl, apiToken, concurrency, progressIntervalMs, filesDir, retryDelaysMs } = {}) {
    super();
    this.retryDelaysMs = Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.apiToken = apiToken || null;
    this.filesDir = filesDir;
    // `concurrency` explícito fixa o número de downloads; sem ele a fila se
    // adapta à vazão (ver adaptiveConcurrency.mjs).
    this.fixedConcurrency = Number.isFinite(concurrency)
      ? Math.max(1, Math.min(16, concurrency))
      : null;
    // Teto do controlador adaptativo. Ele só sobe enquanto a vazão melhora, então
    // uma linha lenta não chega nele; uma linha rápida precisa de muitos fluxos,
    // porque cada arquivo paga a latência do primeiro byte (≈0,4 s no áudio).
    this.maxConcurrency = Math.max(6, Math.min(24, (os.cpus().length || 2) * 3));
    this.queue = [];
    this.running = false;
    this.cancelled = false;
    this.paused = false;
    this._activeReqs = new Set();
    this._activeTmps = new Set();
    this._resumeWaiters = [];
    this._progressIntervalMs = Number.isFinite(progressIntervalMs)
      ? Math.max(0, progressIntervalMs)
      : DEFAULT_PROGRESS_INTERVAL_MS;
    this._pendingProgress = new Map();
    this._progressTimer = null;
  }

  /**
   * Adiciona arquivos à fila. Cada item: { remote: "/covers/2026.bmp", local: "covers/2026.bmp" }
   * Se local não for absoluto, é relativo a userData/files/.
   */
  add(items) {
    items.forEach((item) => {
      const localAbs = path.isAbsolute(item.local)
        ? item.local
        : path.join(this.filesDir || require("../paths.js").filesDir(), item.local);
      this.queue.push({
        remote: item.remote,
        remoteUrl: item.remoteUrl,
        local: localAbs,
        expectedSize: item.expectedSize,
      });
    });
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
    this._discardPendingProgress();
    this._releasePauseWaiters();
    for (const req of this._activeReqs) {
      try { req.destroy(new Error("cancelled")); } catch (_) { /* ignore */ }
    }
    this._activeReqs.clear();
  }

  /**
   * Progresso de rede pode chegar uma vez por chunk. Mantemos só a amostra
   * mais recente de cada arquivo e fazemos fan-out numa cadência limitada,
   * evitando transformar uma resposta fragmentada em milhares de IPCs.
   */
  _queueProgress(key, payload) {
    if (this.cancelled) return;
    this._pendingProgress.set(key, payload);
    if (this._progressTimer) return;

    this._progressTimer = setTimeout(() => {
      this._progressTimer = null;
      this._flushPendingProgress();
    }, this._progressIntervalMs);
  }

  /**
   * Em conclusão/erro, a última amostra do arquivo é emitida imediatamente
   * antes do evento terminal. Sem `key`, drena todas as amostras pendentes.
   */
  _flushPendingProgress(key) {
    if (key !== undefined) {
      const payload = this._pendingProgress.get(key);
      this._pendingProgress.delete(key);
      if (this._pendingProgress.size === 0 && this._progressTimer) {
        clearTimeout(this._progressTimer);
        this._progressTimer = null;
      }
      if (payload) this.emit("progress", payload);
      return;
    }

    if (this._progressTimer) {
      clearTimeout(this._progressTimer);
      this._progressTimer = null;
    }
    const pending = [...this._pendingProgress.values()];
    this._pendingProgress.clear();
    for (const payload of pending) this.emit("progress", payload);
  }

  _discardPendingProgress() {
    if (this._progressTimer) {
      clearTimeout(this._progressTimer);
      this._progressTimer = null;
    }
    this._pendingProgress.clear();
  }

  pause() {
    if (!this.running) return;
    this.paused = true;
    this.emit("paused");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._releasePauseWaiters();
    this.emit("resumed");
  }

  _releasePauseWaiters() {
    if (!this.cancelled && this.paused) return;
    this._resumeWaiters.forEach((resolve) => resolve());
    this._resumeWaiters = [];
  }

  _waitWhilePaused() {
    if (this.cancelled || !this.paused) return Promise.resolve();
    return new Promise((res) => this._resumeWaiters.push(res));
  }

  _buildUrl(remote) {
    const rel = String(remote).replace(/^\/+/, "");
    // Espaços e acentos quebram o servidor sem encode. encodeURIComponent
    // por segmento preserva os "/" do path.
    const encoded = rel.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    return `${this.baseUrl}/${encoded}`;
  }

  /**
   * `resume`: { offset, validator, onResponse(meta) }. Com `offset > 0` pede só o
   * resto (`Range` + `If-Range`); se o servidor devolver o arquivo inteiro, o
   * parcial é descartado e o download recomeça sozinho.
   */
  _downloadOne(url, localPath, onProgress, redirectCount = 0, tokenAllowed = true, resume = null) {
    return new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(url);
        if (target.protocol !== "https:" && target.protocol !== "http:") {
          throw new Error(`Protocolo de download não permitido: ${target.protocol}`);
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (this.cancelled) {
        reject(new Error("cancelled"));
        return;
      }

      const lib = target.protocol === "https:" ? https : http;
      const headers = {};
      if (resume && resume.offset > 0) {
        headers.Range = `bytes=${resume.offset}-`;
        if (resume.validator) headers["If-Range"] = resume.validator;
      }
      // O token pertence ao servidor configurado, não a URLs de CDN nem a
      // origens alcançadas por redirects. Uma vez fora da origem, não o reenvie.
      let baseOrigin;
      try { baseOrigin = new URL(this.baseUrl).origin; } catch (_) { /* sem origem confiável */ }
      if (this.apiToken && tokenAllowed && target.origin === baseOrigin) {
        headers["Api-Token"] = this.apiToken;
      }

      let req;
      try {
        req = lib.get(target, { headers }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          res.resume();
          if (!loc) {
            reject(new Error(`HTTP ${res.statusCode} sem Location`));
            return;
          }
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Limite de ${MAX_REDIRECTS} redirecionamentos excedido`));
            return;
          }
          let next;
          try {
            next = new URL(loc, target);
            if (next.protocol !== "https:" && next.protocol !== "http:") {
              throw new Error(`Protocolo de redirect não permitido: ${next.protocol}`);
            }
            if (target.protocol === "https:" && next.protocol === "http:") {
              throw new Error("Redirect HTTPS para HTTP não permitido");
            }
          } catch (err) {
            reject(err);
            return;
          }
          if (this.cancelled) {
            reject(new Error("cancelled"));
            return;
          }
          this._downloadOne(
            next.href, localPath, onProgress, redirectCount + 1,
            tokenAllowed && next.origin === target.origin, resume
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          const error = new Error(`HTTP ${res.statusCode}`);
          error.status = res.statusCode;
          reject(error);
          return;
        }
        let total = parseInt(res.headers["content-length"] || "0", 10);
        let bytes = 0;
        let append = false;
        if (res.statusCode === 206) {
          // Só vale se for exatamente o pedaço pedido; qualquer outra coisa
          // anexada ao parcial produziria um arquivo corrompido.
          const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(res.headers["content-range"] || "");
          if (!resume || !(resume.offset > 0) || !range || Number(range[1]) !== resume.offset) {
            res.resume();
            const error = new Error("Resposta parcial inesperada");
            error.discardPartial = true;
            reject(error);
            return;
          }
          append = true;
          bytes = resume.offset;
          total = range[3] === "*" ? 0 : Number(range[3]);
        }
        resume?.onResponse?.({
          etag: res.headers.etag || null,
          lastModified: res.headers["last-modified"] || null,
          total,
        });
        const out = fs.createWriteStream(localPath, { flags: append ? "a" : "w" });
        res.on("data", (chunk) => {
          bytes += chunk.length;
          onProgress?.(bytes, total);
        });
        res.pipe(out);
        out.on("finish", () =>
          out.close(() => {
            // Conexão que cai no meio entrega um arquivo curto sem erro nenhum,
            // e ele viraria acervo "baixado" que não toca.
            if (total > 0 && bytes !== total) {
              const error = new Error(`Download incompleto: ${bytes}/${total} bytes`);
              error.status = 0;
              reject(error);
              return;
            }
            resolve();
          })
        );
        out.on("error", reject);
        res.on("error", reject);
        });
      } catch (err) {
        reject(err);
        return;
      }

      req.on("error", reject);
      req.on("close", () => this._activeReqs.delete(req));
      req.setTimeout(60000, () => req.destroy(new Error("HTTP timeout")));
      this._activeReqs.add(req);
    });
  }

  /** Erro de rede ou de servidor: o que já chegou ao disco continua valendo. */
  _isResumable(err) {
    if (!err || err.discardPartial) return false;
    if (typeof err.status === "number" && err.status > 0) {
      return err.status >= 500 || err.status === 429 || err.status === 408;
    }
    if (err.code && RESUMABLE_CODES.has(err.code)) return true;
    return /timeout|incompleto|aborted|socket hang up/i.test(err.message || "");
  }

  /** Quanto do arquivo já está no disco e como provar ao servidor que é o mesmo. */
  async _readResume(tmp, item) {
    const meta = `${tmp}.meta`;
    const discard = async () => {
      await fs.remove(tmp).catch(() => {});
      await fs.remove(meta).catch(() => {});
      return { offset: 0, validator: null };
    };
    let stat;
    try {
      stat = await fs.stat(tmp);
    } catch (error) {
      if (error.code === "ENOENT") return { offset: 0, validator: null };
      throw error;
    }
    if (!stat.isFile() || stat.size === 0 || Date.now() - stat.mtimeMs > PARTIAL_MAX_AGE_MS) {
      return discard();
    }
    let saved = null;
    try { saved = await fs.readJson(meta); } catch (_) { /* sem validador */ }
    const validator = saved?.etag || saved?.lastModified || null;
    if (!validator) return discard();
    if (item.expectedSize > 0 && stat.size >= item.expectedSize) return discard();
    if (saved?.total > 0 && stat.size >= saved.total) return discard();
    return { offset: stat.size, validator };
  }

  async _processItem(item, total, getNextIndex) {
    const idx = getNextIndex();
    const url = item.remoteUrl || this._buildUrl(item.remote);
    const tmp = `${item.local}.tmp`;
    const metaPath = `${tmp}.meta`;
    let receivedBytes = 0;

    try {
      await this._prepareDestination(item.local);
      await this._assertDestination(item.local, tmp);
      this._activeTmps.add(tmp);

      // A preparação do diretório é assíncrona; respeite uma pausa explícita
      // que tenha chegado antes de abrir o socket deste arquivo.
      while (!this.cancelled && this.paused) {
        await this._waitWhilePaused();
      }
      if (this.cancelled) throw new Error("cancelled");

      const attempts = 1 + this.retryDelaysMs.length;
      for (let attempt = 1; ; attempt++) {
        const resume = await this._readResume(tmp, item);
        resume.onResponse = (meta) => {
          fs.outputJson(metaPath, meta).catch(() => {});
        };
        try {
          await this._downloadOne(url, tmp, (bytes, totalBytes) => {
            receivedBytes = bytes;
            this._queueProgress(idx, {
              current: idx,
              total,
              file: item.remote,
              bytes,
              totalBytes: totalBytes || item.expectedSize || 0,
            });
          }, 0, true, resume);
          break;
        } catch (error) {
          if (this.cancelled) throw error;
          // Parcial que o servidor não reconhece: recomeça do zero, sem gastar tentativa.
          if (error.discardPartial || error.status === 416) {
            await fs.remove(tmp).catch(() => {});
            await fs.remove(metaPath).catch(() => {});
            if (attempt >= attempts) throw error;
            continue;
          }
          if (!this._isResumable(error) || attempt >= attempts) throw error;
          console.warn(`[httpQueue] ${url}: ${error.message}; retomando (${attempt}/${attempts - 1})`);
          await sleep(this.retryDelaysMs[attempt - 1]);
          if (this.cancelled) throw new Error("cancelled");
        }
      }
      if (this.cancelled) throw new Error("cancelled");

      // `file-done` nunca ultrapassa a última posição conhecida do arquivo.
      this._flushPendingProgress(idx);
      await this._assertDestination(item.local, tmp);
      await fs.move(tmp, item.local, { overwrite: true });
      await fs.remove(metaPath).catch(() => {});
      this._activeTmps.delete(tmp);
      this.emit("file-done", { file: item.remote, localPath: item.local });
      return { ok: true, bytes: receivedBytes };
    } catch (err) {
      if (!this.cancelled) this._flushPendingProgress(idx);
      // Falha de rede ou de servidor guarda o parcial: a próxima tentativa (ou
      // o próximo "baixar") pede só o que falta. Cancelar e erro definitivo
      // (404, destino inválido…) apagam o temporário.
      const keepPartial = !this.cancelled && this._isResumable(err);
      if (this._activeTmps.has(tmp)) {
        if (!keepPartial) {
          try { await fs.remove(tmp); } catch (_) { /* ignore */ }
          try { await fs.remove(metaPath); } catch (_) { /* ignore */ }
        }
        this._activeTmps.delete(tmp);
      }
      if (this.cancelled) return { ok: false, cancelled: true };
      console.warn(`[httpQueue] falhou ${url}: ${err.message}`);
      this.emit("file-error", { file: item.remote, error: err.message });
      return { ok: false };
    }
  }

  async _prepareDestination(local) {
    if (!this.filesDir) return fs.ensureDir(path.dirname(local));
    const relative = path.relative(this.filesDir, path.dirname(local));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Destino fora da pasta de arquivos");
    }
    await fs.ensureDir(this.filesDir);
    let current = this.filesDir;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try { await fs.mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Diretório de destino inválido");
    }
  }

  async _assertDestination(local, tmp) {
    if (!this.filesDir) return;
    const root = await fs.realpath(this.filesDir);
    const parent = await fs.realpath(path.dirname(local));
    const relative = path.relative(root, parent);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Destino fora da pasta de arquivos");
    }
    for (const target of [local, tmp]) {
      try {
        if ((await fs.lstat(target)).isSymbolicLink()) throw new Error("Link simbólico não permitido no destino");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  async start() {
    if (this.running) throw new Error("HttpQueue já está em execução");
    if (!this.baseUrl) throw new Error("HttpQueue: baseUrl não configurada");
    if (this.queue.length === 0) {
      this._discardPendingProgress();
      this.emit("queue-done", { downloaded: 0, failed: 0 });
      return;
    }

    this.running = true;
    this.cancelled = false;

    const total = this.queue.length;
    let started = 0;
    let downloaded = 0;
    let failed = 0;
    const getNextIndex = () => ++started;

    let adaptive = null;
    if (this.fixedConcurrency === null) {
      const { createAdaptiveConcurrency } = await loadAdaptiveConcurrency();
      adaptive = createAdaptiveConcurrency({
        min: 2,
        start: 4,
        max: this.maxConcurrency,
        ramp: "geometric",
      });
    }
    const slots = this.fixedConcurrency ?? this.maxConcurrency;

    // Pool de workers concorrentes — cada um consome o queue até esvaziar.
    // Todos os workers existem; só os de índice abaixo do limite atual pegam
    // trabalho, os demais esperam o limite subir.
    const worker = async (index) => {
      while (!this.cancelled) {
        await this._waitWhilePaused();
        if (this.cancelled) break;
        // A pausa pode chegar entre o Promise resolvido e este microtask.
        if (this.paused) continue;
        if (this.queue.length === 0) break;
        if (adaptive && index >= adaptive.limit()) {
          await sleep(250);
          continue;
        }
        const item = this.queue.shift();
        if (!item) break;
        const r = await this._processItem(item, total, getNextIndex);
        if (r.ok) {
          downloaded++;
          adaptive?.report({ bytes: r.bytes, ok: true });
        } else if (!r.cancelled) {
          failed++;
          adaptive?.report({ ok: false });
        }
      }
    };

    const workers = [];
    for (let i = 0; i < slots; i++) workers.push(worker(i));
    await Promise.all(workers);

    this.running = false;

    if (this.cancelled) {
      this._discardPendingProgress();
      this.emit("queue-cancelled");
    } else {
      // Garante que nenhuma amostra final fique presa em timer ao encerrar.
      this._flushPendingProgress();
      this.emit("queue-done", { downloaded, failed });
    }
  }
}

module.exports = { HttpQueue };
