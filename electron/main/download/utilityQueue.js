"use strict";
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { workerName } = require("./workerDiagnostics.js");

/** Main-process adapter. The renderer never receives a process handle or port. */
class UtilityQueue extends EventEmitter {
  constructor({ baseUrl, apiToken, filesDir, workDir, allowedRemoteOrigins, fork, startupTimeoutMs = 10000, cancelTimeoutMs = 2000, exitTimeoutMs = 10000,
    reportDiagnostic, monotonicNow = () => performance.now() } = {}) {
    super();
    this.config = { baseUrl, apiToken, filesDir, workDir, allowedRemoteOrigins };
    this.fork = fork || ((entry, options) => require("electron").utilityProcess.fork(entry, [], options));
    this.startupTimeoutMs = startupTimeoutMs;
    this.cancelTimeoutMs = cancelTimeoutMs;
    this.exitTimeoutMs = exitTimeoutMs;
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
    this.reportDiagnostic = typeof reportDiagnostic === "function" ? reportDiagnostic : () => {};
    this.monotonicNow = monotonicNow;
    this.workerStartedAt = null;
    this.workerPhase = "starting";
    this.workerPid = undefined;
    this.workerExitObserved = false;
    this.workerExitCode = undefined;
    this.terminationIntent = "none";
    this.terminationPhase = undefined;
    this.terminationReason = undefined;
    this.killResult = "not_requested";
  }

  _diagnostic() {
    try {
      this.reportDiagnostic({
        download_worker_id: this.jobId,
        download_job_id: this.jobId,
        download_worker_pid: this.workerPid,
        download_worker_phase: this.workerPhase,
        download_worker_duration_ms: Math.max(0, Math.round(this.monotonicNow() - this.workerStartedAt)),
        download_worker_exit_observed: this.workerExitObserved,
        download_worker_exit_code: this.workerExitCode,
        download_worker_termination_intent: this.terminationIntent,
        download_worker_termination_phase: this.terminationPhase,
        download_worker_termination_reason: this.terminationReason,
        download_worker_kill_result: this.killResult,
      });
    } catch { /* diagnostics cannot interrupt download or termination */ }
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
    this.workerStartedAt = this.monotonicNow();
    this._diagnostic();
    this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
    this.targets = new Map(this.queue.map((file) => [file.remote, path.resolve(this.config.filesDir, file.local)]));
    try {
      this.child = this.fork(path.join(__dirname, "utilityWorker.cjs"), { serviceName: workerName(this.jobId), stdio: "ignore" });
      this.child.once("spawn", () => {
        if (Number.isSafeInteger(this.child.pid) && this.child.pid > 0) this.workerPid = this.child.pid;
        if (this.workerPhase === "starting") this.workerPhase = "spawned";
        this._diagnostic();
      });
      this.child.on("message", (message) => this._message(message));
      this.child.once("exit", (code) => {
        this.terminationPhase ||= this.workerPhase;
        this.workerExitObserved = true;
        this.workerExitCode = Number.isInteger(code) ? code : undefined;
        this.workerPhase = "exited";
        this._diagnostic();
        this.emit("worker-exited");
        if (!this.done) this._fail("download_worker_exited");
      });
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
      this.workerPhase = "ready";
      this._diagnostic();
      this._send("start", { ...this.config, files: this.queue });
      if (this.paused) this._send("pause");
      if (this.cancelled) this._send("cancel");
      return;
    }
    if (message.jobId !== this.jobId) return;
    const { type, data } = message;
    if (type === "started") {
      if (!this.cancelled) clearTimeout(this.timer);
      this.workerPhase = this.cancelled ? "cancelling" : this.paused ? "paused" : "downloading";
      this._diagnostic();
      return;
    }
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
    }, code);
  }

  _finish(type, data, reason = type === "queue-cancelled" ? "queue_cancelled" : "queue_done") {
    if (this.done) return;
    this.done = true;
    this.running = false;
    clearTimeout(this.timer);
    this.terminationReason = reason;
    this.terminationPhase ||= this.workerPhase;
    if (!this.workerExitObserved && this.child) {
      this.terminationIntent = data?.error ? "failed" : type === "queue-cancelled" ? "cancelled" : "completed";
      this.workerPhase = "finishing";
      this.killResult = "pending";
    }
    // Capture intent before kill: app.child-process-gone can arrive before
    // queue terminal listeners run or while a new queue has already started.
    this._diagnostic();
    try {
      const result = this.child?.kill();
      if (this.child) this.killResult = result === true ? "accepted" : result === false ? "rejected" : "unknown";
    } catch { this.killResult = "threw"; /* already exited */ }
    this._diagnostic();
    this.resolveCompletion?.();
    this.emit(type, data);
  }

  pause() { if (this.running && !this.cancelled) { this.paused = true; this.workerPhase = "paused"; this._diagnostic(); if (this.ready) this._send("pause"); } }
  resume() { if (this.running && !this.cancelled) { this.paused = false; this.workerPhase = this.ready ? "downloading" : "starting"; this._diagnostic(); if (this.ready) this._send("resume"); } }
  cancel() {
    if (!this.running || this.done) return;
    this.cancelled = true;
    this.paused = false;
    this.workerPhase = "cancelling";
    this._diagnostic();
    if (this.ready) this._send("cancel");
    this._deadline(this.cancelTimeoutMs, () => this._finish("queue-cancelled", undefined, "cancel_deadline"));
  }
  async shutdown() {
    this.cancel();
    await this.completion;
    if (!this.child || this.workerExitObserved) return;
    // kill() só confirma que o sinal foi pedido. O lease do main precisa durar
    // até o processo gravador realmente sair, inclusive após o timeout de cancel.
    await new Promise((resolve, reject) => {
      const exited = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.off("worker-exited", exited);
        const error = new Error("O processo de download ainda não encerrou. Aguarde e tente fechar o aplicativo novamente.");
        error.code = "DOWNLOAD_WORKER_STILL_RUNNING";
        reject(error);
      }, this.exitTimeoutMs);
      this.once("worker-exited", exited);
      if (this.workerExitObserved) { this.off("worker-exited", exited); exited(); }
    });
  }
}

module.exports = { UtilityQueue };
