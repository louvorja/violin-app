"use strict";

/**
 * Fiação compartilhada das rotas de estado do renderer (Player e Cronômetro).
 *
 * Não registra endpoints: `player.js` e `stopwatch.js` usam
 * `createRendererStateResponders(ctx)` para falar com o renderer pelo mesmo
 * _round-trip_ (`requestRenderer` com `requestId`) e devolver o mesmo envelope
 * de erro — 400/409/503/504.
 */
const { isPlainObject } = require("../payloadValidation");

const STATE_TIMEOUT_MS = 5_000;
const STATE_MAX_PAYLOAD_BYTES = 64 * 1024;


function isStateEnvelope(payload, validateState) {
  if (!isPlainObject(payload)) return false;
  if (payload.status === "error") {
    return typeof payload.code === "string" && typeof payload.error === "string";
  }
  return payload.status === "ok" && validateState(payload.state);
}


function errorStatus(code) {
  if (typeof code === "string" && code.startsWith("INVALID_")) return 400;
  if (code === "NO_MEDIA" || code === "BUSY") return 409;
  return 409;
}


/**
 * Monta os helpers de resposta a partir do `ctx` do `setupRoutes`.
 *
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function createRendererStateResponders(ctx) {
  const { requestRenderer, sendRendererError } = ctx;

  async function requestState(mainWindow, res, event, payload, prefix, validate, timeoutMessage) {
    try {
      const data = await requestRenderer(mainWindow, res, event, payload, {
        prefix,
        timeoutMs: STATE_TIMEOUT_MS,
        maxPayloadBytes: STATE_MAX_PAYLOAD_BYTES,
        validatePayload: (value) => isStateEnvelope(value, validate),
      });
      if (res.headersSent || res.writableEnded) return;
      if (data.status === "error") {
        const code = data.code || "COMMAND_FAILED";
        const message = data.error || "Falha no comando";
        res.status(errorStatus(code)).json({ status: "error", code, message, error: message });
        return;
      }
      res.json(data);
    } catch (error) {
      sendRendererError(res, error, timeoutMessage);
    }
  }

  function denied(res, label) {
    console.log(`[httpServer] ${label} → 403 (device sem a permission)`);
    res.status(403).json({
      status: "error",
      code: "FORBIDDEN",
      message: `Device sem permissão de ${label}`,
      error: `Device sem permissão de ${label}`,
    });
  }

  function unavailable(res) {
    res.status(503).json({
      status: "error",
      code: "RENDERER_UNAVAILABLE",
      message: "Janela principal não disponível",
      error: "Janela principal não disponível",
    });
  }

  return { requestState, denied, unavailable };
}


module.exports = { createRendererStateResponders, isStateEnvelope, errorStatus };
