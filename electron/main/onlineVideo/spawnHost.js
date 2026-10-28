"use strict";
const { EventEmitter } = require("node:events");
const { StringDecoder } = require("node:string_decoder");
const path = require("node:path");

const IDLE_MS = 60_000;

/** O bastante de um stream de leitura para o runner: `setEncoding` e eventos `data`, em ordem. */
class RemoteStream extends EventEmitter {
  setEncoding(encoding) {
    this._decoder = new StringDecoder(encoding);
    return this;
  }

  _push(bytes) {
    const chunk = Buffer.from(bytes);
    this.emit("data", this._decoder ? this._decoder.write(chunk) : chunk);
  }

  _end() {
    const rest = this._decoder?.end();
    if (rest) this.emit("data", rest);
    this.emit("end");
  }
}

class RemoteChild extends EventEmitter {
  constructor(id, stdio, send) {
    super();
    this.id = id;
    this.pid = undefined;
    this.exitCode = null;
    this.stdout = stdio[1] === "pipe" ? new RemoteStream() : null;
    this.stderr = stdio[2] === "pipe" ? new RemoteStream() : null;
    this._send = send;
  }

  kill(signal = "SIGTERM") {
    this._send({ id: this.id, type: "kill", signal });
    return true;
  }

  killTree() {
    this._send({ id: this.id, type: "kill-tree" });
  }
}

/**
 * `spawn` e `execFile` que rodam num processo utilitário, com a forma que o runner e as
 * ferramentas já usam. O processo nasce no primeiro pedido e sai depois de `idleMs` sem
 * nenhum filho vivo — custa ~30 MB só enquanto há vídeo online em uso.
 */
function createSpawnHost({
  fork = (entry, options) => require("electron").utilityProcess.fork(entry, [], options),
  idleMs = IDLE_MS,
} = {}) {
  let worker = null;
  let ready = false;
  let pending = [];
  let nextId = 1;
  let idleTimer = null;
  /** @type {Map<number, RemoteChild>} */
  const children = new Map();
  /** @type {Set<() => void>} */
  const settled = new Set();

  function send(message) {
    if (!worker) return;
    if (!ready) {
      pending.push(message);
      return;
    }
    try {
      worker.postMessage(message);
    } catch {
      lost();
    }
  }

  function lost() {
    const orphans = [...children.values()];
    children.clear();
    worker = null;
    ready = false;
    pending = [];
    for (const child of orphans) {
      child.emit("error", new Error("O processo auxiliar das ferramentas de vídeo encerrou"));
      finish(child, null, null);
    }
    for (const resolve of settled) resolve();
  }

  function finish(child, code, signal) {
    child.exitCode = code;
    child.stdout?._end();
    child.stderr?._end();
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
  }

  function receive(message) {
    if (message?.type === "ready") {
      ready = true;
      const queued = pending;
      pending = [];
      for (const item of queued) send(item);
      return;
    }
    const child = children.get(message?.id);
    if (!child) return;
    if (message.type === "spawn") {
      child.pid = message.pid;
      child.emit("spawn");
    } else if (message.type === "stdout") child.stdout?._push(message.data);
    else if (message.type === "stderr") child.stderr?._push(message.data);
    else if (message.type === "error") {
      child.emit("error", Object.assign(new Error(message.message), { code: message.code }));
    } else if (message.type === "close") {
      children.delete(child.id);
      finish(child, message.code, message.signal);
      if (!children.size) {
        scheduleIdle();
        for (const resolve of settled) resolve();
      }
    }
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs);
    idleTimer.unref?.();
  }

  function ensureWorker() {
    clearTimeout(idleTimer);
    if (worker) return;
    const current = fork(path.join(__dirname, "spawnWorker.cjs"), {
      serviceName: "LouvorJA video tools",
      stdio: "ignore",
    });
    worker = current;
    ready = false;
    current.on("message", (message) => {
      if (worker === current) receive(message);
    });
    current.once("exit", () => {
      if (worker === current) lost();
    });
  }

  function spawn(bin, args, options = {}) {
    ensureWorker();
    const id = nextId++;
    const stdio = Array.isArray(options.stdio) ? options.stdio : ["pipe", "pipe", "pipe"];
    const child = new RemoteChild(id, stdio, send);
    children.set(id, child);
    send({ id, type: "spawn", bin, args, options: { ...options, stdio } });
    return child;
  }

  /** Mesmo contrato do `child_process.execFile` usado pelas ferramentas: timeout e callback. */
  function execFile(bin, args, options, callback) {
    const { timeout = 0, ...rest } = options || {};
    const child = spawn(bin, args, { ...rest, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let failure = null;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const timer = timeout
      ? setTimeout(() => {
          failure = new Error(`não respondeu em ${timeout} ms`);
          child.killTree();
        }, timeout)
      : null;
    child.on("error", (error) => {
      failure ||= error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!failure && code !== 0) {
        failure = Object.assign(new Error(`terminou com ${signal || `código ${code}`}: ${stderr.trim()}`), { code, signal });
      }
      callback(failure, stdout, stderr);
    });
    return child;
  }

  /** Espera os filhos vivos terminarem, sem passar de `timeoutMs`. */
  function settle(timeoutMs) {
    if (!children.size) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        settled.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      settled.add(done);
    });
  }

  function killTree(child) {
    child?.killTree?.();
  }

  function stop() {
    clearTimeout(idleTimer);
    if (!worker || children.size) return;
    const current = worker;
    worker = null;
    ready = false;
    pending = [];
    try {
      current.kill();
    } catch {
      /* já saiu */
    }
  }

  return { spawn, execFile, killTree, settle, stop, running: () => worker !== null };
}

module.exports = { createSpawnHost };
