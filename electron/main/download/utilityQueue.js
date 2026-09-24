"use strict";
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

/** Main-process adapter. The renderer never receives a process handle or port. */
class UtilityQueue extends EventEmitter {
  constructor({ baseUrl, apiToken, filesDir, allowedRemoteOrigins, fork, startupTimeoutMs = 10000, cancelTimeoutMs = 2000 } = {}) {
    super();
    this.config = { baseUrl, apiToken, filesDir, allowedRemoteOrigins };
    this.fork = fork || ((entry, options) => require("electron").utilityProcess.fork(entry, [], options));
    this.startupTimeoutMs = startupTimeoutMs;
    this.cancelTimeoutMs = cancelTimeoutMs;
    this.queue = [];
    this.running = false;
    this.paused = false;
    this.cancelled = false;
    this.child = null;
    this.jobId = randomUUID();
    this.done = false;
    this.ready = false;
    this.downloaded = new Set();
    this.timer = null;
  }

  add(files) {
    if (this.running || this.done) throw new Error("Download já iniciado");
    // integrity.diff annotates damaged files with actualSize. Only transport
    // download-contract fields; the worker validates this closed shape again.
    this.queue.push(...files.map(({ remote, local, remoteUrl, expectedSize }) => ({
      remote, local,
      ...(remoteUrl === undefined ? {} : { remoteUrl }),
      ...(expectedSize === undefined ? {} : { expectedSize }),
    })));
  }

  start() {
    if (this.running || this.done) throw new Error("Download já iniciado");
    this.running = true;
    this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
    this.targets = new Map(this.queue.map((file) => [file.remote, path.resolve(this.config.filesDir, file.local)]));
    try {
      this.child = this.fork(path.join(__dirname, "utilityWorker.cjs"), { serviceName: "LouvorJA Downloads", stdio: "ignore" });
      this.child.on("message", (message) => this._message(message));
      this.child.once("exit", () => { if (!this.done) this._fail("download_worker_exited"); });
      this.child.once("error", () => this._fail("download_worker_error"));
      this._deadline(this.startupTimeoutMs, () => this._fail("download_worker_start_timeout"));
    } catch {
      this._fail("download_worker_spawn_failed");
    }
    return this.completion;
  }

  _deadline(ms, callback) {
    clearTimeout(this.timer);
    this.timer = setTimeout(callback, ms);
    this.timer.unref?.();
  }

  _send(type, data) {
    try { this.child.postMessage({ version: 1, jobId: this.jobId, type, data }); }
    catch { this._fail("download_worker_disconnected"); }
  }

  _message(message) {
    if (this.done || !message || message.version !== 1) return;
    if (message.type === "ready" && !this.ready) {
      this.ready = true;
      this._send("start", { ...this.config, files: this.queue });
      if (this.paused) this._send("pause");
      if (this.cancelled) this._send("cancel");
      return;
    }
    if (message.jobId !== this.jobId) return;
    const { type, data } = message;
    if (type === "started") { if (!this.cancelled) clearTimeout(this.timer); return; }
    if (type === "fatal") { this._fail("download_worker_failed"); return; }
    if (type === "queue-cancelled") { this._finish(type); return; }
    if (type === "queue-done") {
      if (!data || !Number.isInteger(data.downloaded) || !Number.isInteger(data.failed) || data.downloaded < 0 || data.failed < 0 || data.downloaded + data.failed !== this.queue.length) {
        this._fail("download_worker_invalid_result");
      } else this._finish(type, { downloaded: data.downloaded, failed: data.failed });
      return;
    }
    if (!data || !this.targets.has(data.file)) return;
    if (type === "file-done" && data.localPath === this.targets.get(data.file)) {
      if (this.downloaded.has(data.file)) return;
      this.downloaded.add(data.file);
      this.emit(type, { file: data.file, localPath: data.localPath });
    } else if (type === "file-error") {
      this.emit(type, { file: data.file, error: typeof data.error === "string" ? data.error.slice(0, 300) : "Download falhou" });
    } else if (type === "progress" && [data.current, data.total, data.bytes, data.totalBytes].every((n) => Number.isFinite(n) && n >= 0) && data.total === this.queue.length && data.current <= data.total) {
      this.emit(type, { file: data.file, current: data.current, total: data.total, bytes: data.bytes, totalBytes: data.totalBytes });
    }
  }

  _fail(code) {
    this._finish(this.cancelled ? "queue-cancelled" : "queue-done", {
      downloaded: this.downloaded.size, failed: this.queue.length - this.downloaded.size, error: code,
    });
  }

  _finish(type, data) {
    if (this.done) return;
    this.done = true;
    this.running = false;
    clearTimeout(this.timer);
    try { this.child?.kill(); } catch { /* already exited */ }
    this.resolveCompletion?.();
    this.emit(type, data);
  }

  pause() { if (this.running && !this.cancelled) { this.paused = true; if (this.ready) this._send("pause"); } }
  resume() { if (this.running && !this.cancelled) { this.paused = false; if (this.ready) this._send("resume"); } }
  cancel() {
    if (!this.running || this.done) return;
    this.cancelled = true;
    this.paused = false;
    if (this.ready) this._send("cancel");
    this._deadline(this.cancelTimeoutMs, () => this._finish("queue-cancelled"));
  }
  shutdown() { this.cancel(); return this.completion || Promise.resolve(); }
}

module.exports = { UtilityQueue };
