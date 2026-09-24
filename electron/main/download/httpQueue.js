"use strict";
const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const { EventEmitter } = require("events");

const DEFAULT_PROGRESS_INTERVAL_MS = 100;
const MAX_REDIRECTS = 3;

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
  constructor({ baseUrl, apiToken, concurrency, progressIntervalMs, filesDir } = {}) {
    super();
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.apiToken = apiToken || null;
    this.filesDir = filesDir;
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

  _downloadOne(url, localPath, onProgress, redirectCount = 0, tokenAllowed = true) {
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
            tokenAllowed && next.origin === target.origin
          ).then(resolve, reject);
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

  async _processItem(item, total, getNextIndex) {
    const idx = getNextIndex();
    const url = item.remoteUrl || this._buildUrl(item.remote);
    const tmp = `${item.local}.tmp`;

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

      await this._downloadOne(url, tmp, (bytes, totalBytes) => {
        this._queueProgress(idx, {
          current: idx,
          total,
          file: item.remote,
          bytes,
          totalBytes: totalBytes || item.expectedSize || 0,
        });
      });
      if (this.cancelled) throw new Error("cancelled");

      // `file-done` nunca ultrapassa a última posição conhecida do arquivo.
      this._flushPendingProgress(idx);
      await this._assertDestination(item.local, tmp);
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

    // Pool de workers concorrentes — cada um consome o queue até esvaziar.
    const worker = async () => {
      while (!this.cancelled) {
        await this._waitWhilePaused();
        if (this.cancelled) break;
        // A pausa pode chegar entre o Promise resolvido e este microtask.
        if (this.paused) continue;
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
