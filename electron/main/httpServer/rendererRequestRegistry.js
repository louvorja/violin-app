"use strict";

const { randomUUID } = require("crypto");

const RENDERER_RESPONSE_CHANNEL = "http:renderer-response";
const DEFAULT_MAX_PENDING = 32;
const DEFAULT_TIMEOUT_MS = 5_000;
const HARD_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_PAYLOAD_NODES = 100_000;
const PREFIX_RE = /^[a-z][a-z0-9-]{0,23}$/;
const REQUEST_ID_RE = /^([a-z][a-z0-9-]{0,23}):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

class RendererRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RendererRequestError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Mede um payload sem serializá-lo outra vez. O limite de nós impede que uma
 * resposta hostil transforme a própria validação em uma Long Task no main.
 */
function measurePayload(value, limitBytes) {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set();

  function add(amount) {
    bytes += amount;
    return bytes <= limitBytes;
  }

  function visit(item, depth) {
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES || depth > 32) return false;

    if (item === null || item === undefined) return add(4);
    if (typeof item === "boolean") return add(1);
    if (typeof item === "number") return Number.isFinite(item) && add(8);
    if (typeof item === "string") return add(Buffer.byteLength(item, "utf8"));
    if (typeof item !== "object") return false;

    if (Buffer.isBuffer(item)) return add(item.byteLength);
    if (item instanceof ArrayBuffer) return add(item.byteLength);
    if (ArrayBuffer.isView(item)) return add(item.byteLength);

    if (seen.has(item)) return false;
    seen.add(item);

    if (Array.isArray(item)) {
      // Arrays binários devem atravessar IPC como Uint8Array. Isso mantém a
      // validação O(1) para bundles e limita arrays JSON a um volume razoável.
      if (item.length > MAX_PAYLOAD_NODES) return false;
      for (const value of item) {
        if (!visit(value, depth + 1)) return false;
      }
      return true;
    }

    if (!isPlainObject(item)) return false;
    const entries = Object.entries(item);
    if (entries.length > 1_000) return false;
    for (const [key, child] of entries) {
      if (!add(Buffer.byteLength(key, "utf8")) || !visit(child, depth + 1)) return false;
    }
    return true;
  }

  return { ok: visit(value, 0), bytes };
}

class RendererRequestRegistry {
  constructor({
    getMainWindow,
    maxPending = DEFAULT_MAX_PENDING,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    createId = randomUUID,
  } = {}) {
    if (typeof getMainWindow !== "function") {
      throw new TypeError("getMainWindow é obrigatório");
    }
    this._getMainWindow = getMainWindow;
    this._maxPending = Math.max(1, Math.min(Number(maxPending) || DEFAULT_MAX_PENDING, 256));
    this._defaultTimeoutMs = Math.max(
      50,
      Math.min(Number(defaultTimeoutMs) || DEFAULT_TIMEOUT_MS, 30_000)
    );
    this._createId = createId;
    this._pending = new Map();
    this._ipcMain = null;
    this._boundResponse = (event, envelope) => this.acceptResponse(event, envelope);
  }

  attach(ipcMain) {
    if (!ipcMain || typeof ipcMain.on !== "function" || typeof ipcMain.off !== "function") {
      throw new TypeError("ipcMain inválido");
    }
    if (this._ipcMain === ipcMain) return;
    this.detach();
    this._ipcMain = ipcMain;
    ipcMain.on(RENDERER_RESPONSE_CHANNEL, this._boundResponse);
  }

  detach() {
    if (this._ipcMain) {
      this._ipcMain.off(RENDERER_RESPONSE_CHANNEL, this._boundResponse);
      this._ipcMain = null;
    }
    this.cancelAll("REGISTRY_DETACHED", "Registro de respostas desligado");
  }

  request(prefix, { timeoutMs, maxPayloadBytes, validatePayload } = {}) {
    if (typeof prefix !== "string" || !PREFIX_RE.test(prefix)) {
      throw new RendererRequestError("INVALID_PREFIX", "Prefixo de request inválido");
    }
    if (this._pending.size >= this._maxPending) {
      throw new RendererRequestError("REGISTRY_FULL", "Limite de requests pendentes atingido");
    }
    const mainWindow = this._getMainWindow();
    const expectedSender = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (!expectedSender || expectedSender.isDestroyed()) {
      throw new RendererRequestError("RENDERER_UNAVAILABLE", "Janela principal indisponível");
    }

    const effectiveTimeout = Math.max(
      50,
      Math.min(Number(timeoutMs) || this._defaultTimeoutMs, 30_000)
    );
    const effectiveMaxPayload = Math.max(
      1,
      Math.min(Number(maxPayloadBytes) || HARD_MAX_PAYLOAD_BYTES, HARD_MAX_PAYLOAD_BYTES)
    );
    const requestId = `${prefix}:${this._createId()}`;
    if (!REQUEST_ID_RE.test(requestId)) {
      throw new RendererRequestError("INVALID_REQUEST_ID", "Gerador produziu request id inválido");
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      this._reject(
        requestId,
        new RendererRequestError("TIMEOUT", `Renderer não respondeu ${prefix} no prazo`)
      );
    }, effectiveTimeout);

    this._pending.set(requestId, {
      prefix,
      expectedSender,
      timer,
      maxPayloadBytes: effectiveMaxPayload,
      validatePayload: typeof validatePayload === "function" ? validatePayload : null,
      resolve: resolvePromise,
      reject: rejectPromise,
    });

    return {
      requestId,
      promise,
      cancel: (code = "CANCELLED", message = "Request cancelado") =>
        this._reject(requestId, new RendererRequestError(code, message)),
    };
  }

  acceptResponse(event, envelope) {
    const mainWindow = this._getMainWindow();
    const expectedSender = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (!expectedSender || expectedSender.isDestroyed() || event?.sender !== expectedSender) {
      return { accepted: false, reason: "INVALID_SENDER" };
    }
    if (!isPlainObject(envelope) || typeof envelope.requestId !== "string") {
      return { accepted: false, reason: "INVALID_ENVELOPE" };
    }

    const match = REQUEST_ID_RE.exec(envelope.requestId);
    if (!match) return { accepted: false, reason: "INVALID_REQUEST_ID" };

    const entry = this._pending.get(envelope.requestId);
    if (!entry) return { accepted: false, reason: "STALE_REQUEST" };
    if (match[1] !== entry.prefix) return { accepted: false, reason: "INVALID_PREFIX" };
    if (entry.expectedSender !== expectedSender) {
      this._reject(
        envelope.requestId,
        new RendererRequestError("WINDOW_CHANGED", "Janela principal mudou durante o request")
      );
      return { accepted: false, reason: "WINDOW_CHANGED" };
    }

    const measured = measurePayload(envelope.payload, entry.maxPayloadBytes);
    if (!measured.ok) {
      this._reject(
        envelope.requestId,
        new RendererRequestError("INVALID_PAYLOAD", "Payload inválido ou acima do limite")
      );
      return { accepted: false, reason: "INVALID_PAYLOAD" };
    }
    if (entry.validatePayload && entry.validatePayload(envelope.payload) !== true) {
      this._reject(
        envelope.requestId,
        new RendererRequestError("INVALID_PAYLOAD", "Contrato da resposta não foi atendido")
      );
      return { accepted: false, reason: "INVALID_PAYLOAD" };
    }

    this._pending.delete(envelope.requestId);
    clearTimeout(entry.timer);
    entry.resolve(envelope.payload);
    return { accepted: true, bytes: measured.bytes };
  }

  _reject(requestId, error) {
    const entry = this._pending.get(requestId);
    if (!entry) return false;
    this._pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.reject(error);
    return true;
  }

  cancelAll(code = "CANCELLED", message = "Requests cancelados") {
    for (const requestId of [...this._pending.keys()]) {
      this._reject(requestId, new RendererRequestError(code, message));
    }
  }

  get pendingCount() {
    return this._pending.size;
  }
}

module.exports = {
  DEFAULT_MAX_PENDING,
  HARD_MAX_PAYLOAD_BYTES,
  RENDERER_RESPONSE_CHANNEL,
  RendererRequestError,
  RendererRequestRegistry,
  measurePayload,
};
