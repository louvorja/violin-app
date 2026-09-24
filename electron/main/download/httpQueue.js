"use strict";
const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const { EventEmitter } = require("events");
const paths = require("../paths.js");

const DEFAULT_PROGRESS_INTERVAL_MS = 100;

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
   * @param {{ baseUrl: string, apiToken?: string, concurrency?: number, progressIntervalMs?: number }} options
   */
  constructor({ baseUrl, apiToken, concurrency, progressIntervalMs } = {}) {
    super();
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.apiToken = apiToken || null;
    this.concurrency = Math.max(1, Math.min(16, concurrency ?? 6));
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
        : path.join(paths.filesDir(), item.local);
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
    this._resumeWaiters.forEach((res) => res());
    this._resumeWaiters = [];
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
    this._resumeWaiters.forEach((res) => res());
    this._resumeWaiters = [];
    this.emit("resumed");
  }

  _waitIfPaused() {
    if (!this.paused) return Promise.resolve();
    return new Promise((res) => this._resumeWaiters.push(res));
  }

  _buildUrl(remote) {
    const rel = String(remote).replace(/^\/+/, "");
    // Espaços e acentos quebram o servidor sem encode. encodeURIComponent
    // por segmento preserva os "/" do path.
    const encoded = rel.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    return `${this.baseUrl}/${encoded}`;
  }

  _downloadOne(url, localPath, onProgress) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith("https") ? https : http;
      const headers = {};
      if (this.apiToken) headers["Api-Token"] = this.apiToken;

      const req = lib.get(url, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Segue redirect uma vez
          const loc = res.headers.location;
          res.resume();
          this._activeReqs.delete(req);
          if (!loc) {
            reject(new Error(`HTTP ${res.statusCode} sem Location`));
            return;
          }
          this._downloadOne(loc, localPath, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let bytes = 0;
        const out = fs.createWriteStream(localPath);
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
              reject(new Error(`Download incompleto: ${bytes}/${total} bytes`));
              return;
            }
            resolve();
          })
        );
        out.on("error", reject);
        res.on("error", reject);
      });

      req.on("error", reject);
      req.on("close", () => this._activeReqs.delete(req));
      req.setTimeout(60000, () => req.destroy(new Error("HTTP timeout")));
      this._activeReqs.add(req);
    });
  }

  async _processItem(item, total, getNextIndex) {
    const idx = getNextIndex();
    const url = item.remoteUrl || this._buildUrl(item.remote);
    const tmp = `${item.local}.tmp`;

    try {
      await fs.ensureDir(path.dirname(item.local));
      this._activeTmps.add(tmp);

      await this._downloadOne(url, tmp, (bytes, totalBytes) => {
        this._queueProgress(idx, {
          current: idx,
          total,
          file: item.remote,
          bytes,
          totalBytes: totalBytes || item.expectedSize || 0,
        });
      });

      // `file-done` nunca ultrapassa a última posição conhecida do arquivo.
      this._flushPendingProgress(idx);
      await fs.move(tmp, item.local, { overwrite: true });
      this._activeTmps.delete(tmp);
      this.emit("file-done", { file: item.remote, localPath: item.local });
      return { ok: true };
    } catch (err) {
      if (!this.cancelled) this._flushPendingProgress(idx);
      if (this._activeTmps.has(tmp)) {
        try { await fs.remove(tmp); } catch (_) { /* ignore */ }
        this._activeTmps.delete(tmp);
      }
      if (this.cancelled) return { ok: false, cancelled: true };
      console.warn(`[httpQueue] falhou ${url}: ${err.message}`);
      this.emit("file-error", { file: item.remote, error: err.message });
      return { ok: false };
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

    // Pool de workers concorrentes — cada um consome o queue até esvaziar.
    const worker = async () => {
      while (!this.cancelled) {
        await this._waitIfPaused();
        if (this.cancelled) break;
        if (this.queue.length === 0) break;
        const item = this.queue.shift();
        if (!item) break;
        const r = await this._processItem(item, total, getNextIndex);
        if (r.ok) downloaded++;
        else if (!r.cancelled) failed++;
      }
    };

    const workers = [];
    for (let i = 0; i < this.concurrency; i++) workers.push(worker());
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
