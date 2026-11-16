"use strict";

const {
  isPlainObject,
  isFiniteNumber,
  isMediaState,
  isStopwatchState,
} = require("./payloadValidation");

/**
 * Rotas do **Player de mídia** e do **Cronômetro** do controle remoto.
 *
 * O estado vive no renderer (player de arquivo/YouTube e o singleton do
 * cronômetro), então as rotas usam o mesmo _renderer round-trip_ do Sorteio:
 * `requestRenderer` envia `http:media`/`http:stopwatch` com um `requestId` e o
 * renderer responde o snapshot já atualizado. O comando devolve o estado na
 * mesma resposta — o cliente não precisa de um GET extra.
 *
 * Contrato:
 *   GET  /api/media      → { status:"ok", state:{...} }
 *   POST /api/media      → { action: play|pause|seek|seek-relative|next|previous|close }
 *   GET  /api/stopwatch  → { status:"ok", state:{...} }
 *   POST /api/stopwatch  → { action: start|pause|reset|lap|clear-laps|
 *                                   set-mode|set-target|extend-target, ... }
 *
 * Permissions: player / stopwatch (ou root).
 * Erros: { status:"error", code, message, error } com 400/409/504.
 */

const MEDIA_ACTIONS = new Set([
  "play",
  "pause",
  "seek",
  "seek-relative",
  "next",
  "previous",
  "close",
]);
const STOPWATCH_ACTIONS = new Set([
  "start",
  "pause",
  "reset",
  "lap",
  "clear-laps",
  "set-mode",
  "set-target",
  "extend-target",
  "project",
  "unproject",
]);

const MAX_TARGET_SECONDS = 99 * 3600;

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

function register(app, ctx) {
  const { getValidMainWindow, requestRenderer, sendRendererError, hasDevicePermission } = ctx;

  async function requestState(mainWindow, res, event, payload, prefix, validate, timeoutMessage) {
    try {
      const data = await requestRenderer(mainWindow, res, event, payload, {
        prefix,
        timeoutMs: 5_000,
        maxPayloadBytes: 64 * 1024,
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

  // ---------------------------------------------------------------
  // Player de mídia
  // ---------------------------------------------------------------
  app.get("/api/media", async (req, res) => {
    if (!hasDevicePermission(req, "player")) return denied(res, "player");
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return unavailable(res);
    await requestState(
      mainWindow,
      res,
      "http:media",
      { action: "status" },
      "media",
      isMediaState,
      "Timeout ao consultar o player"
    );
  });

  app.post("/api/media", async (req, res) => {
    if (!hasDevicePermission(req, "player")) return denied(res, "player");
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return unavailable(res);

    const body = req.body || {};
    const action = body.action;
    if (!MEDIA_ACTIONS.has(action)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_ACTION",
        message: "action inválida",
        error: "action inválida",
        valid: [...MEDIA_ACTIONS],
      });
    }

    const payload = { action };
    if (action === "seek") {
      const position = Number(body.position);
      if (!isFiniteNumber(position) || position < 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_POSITION",
          message: "position deve ser um número de segundos maior ou igual a zero",
          error: "position deve ser um número de segundos maior ou igual a zero",
        });
      }
      payload.position = position;
    } else if (action === "seek-relative") {
      const seconds = Number(body.seconds);
      if (!isFiniteNumber(seconds) || seconds === 0 || Math.abs(seconds) > 3_600) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_SEEK",
          message: "seconds deve ser um número diferente de zero (máximo 1 hora por passo)",
          error: "seconds deve ser um número diferente de zero (máximo 1 hora por passo)",
        });
      }
      payload.seconds = seconds;
    }

    await requestState(
      mainWindow,
      res,
      "http:media",
      payload,
      "media",
      isMediaState,
      "Timeout ao controlar o player"
    );
  });

  // ---------------------------------------------------------------
  // Cronômetro
  // ---------------------------------------------------------------
  app.get("/api/stopwatch", async (req, res) => {
    if (!hasDevicePermission(req, "stopwatch")) return denied(res, "stopwatch");
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return unavailable(res);
    await requestState(
      mainWindow,
      res,
      "http:stopwatch",
      { action: "status" },
      "stopwatch",
      isStopwatchState,
      "Timeout ao consultar o cronômetro"
    );
  });

  app.post("/api/stopwatch", async (req, res) => {
    if (!hasDevicePermission(req, "stopwatch")) return denied(res, "stopwatch");
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return unavailable(res);

    const body = req.body || {};
    const action = body.action;
    if (!STOPWATCH_ACTIONS.has(action)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_ACTION",
        message: "action inválida",
        error: "action inválida",
        valid: [...STOPWATCH_ACTIONS],
      });
    }

    const payload = { action };
    if (action === "set-mode") {
      if (body.mode !== "countup" && body.mode !== "countdown") {
        return res.status(400).json({
          status: "error",
          code: "INVALID_MODE",
          message: "mode deve ser countup ou countdown",
          error: "mode deve ser countup ou countdown",
        });
      }
      payload.mode = body.mode;
      if (body.mode === "countdown") {
        const target = Number(body.target);
        if (!isFiniteNumber(target) || target <= 0 || target > MAX_TARGET_SECONDS) {
          return res.status(400).json({
            status: "error",
            code: "INVALID_TARGET",
            message: "target deve ser maior que zero e no máximo 99 horas, em segundos",
            error: "target deve ser maior que zero e no máximo 99 horas, em segundos",
          });
        }
        payload.target = target;
      }
    } else if (action === "set-target") {
      // 0 é válido e limpa a meta; a UI do controle remoto só envia 1 s..99 h.
      const target = Number(body.target);
      if (!isFiniteNumber(target) || target < 0 || target > MAX_TARGET_SECONDS) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_TARGET",
          message: "target deve estar entre 0 e 99 horas, em segundos",
          error: "target deve estar entre 0 e 99 horas, em segundos",
        });
      }
      payload.target = target;
    } else if (action === "extend-target") {
      const seconds = Number(body.seconds);
      if (!isFiniteNumber(seconds) || seconds === 0 || Math.abs(seconds) > MAX_TARGET_SECONDS) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_TARGET",
          message: "seconds deve ser um número diferente de zero",
          error: "seconds deve ser um número diferente de zero",
        });
      }
      payload.seconds = seconds;
    }

    await requestState(
      mainWindow,
      res,
      "http:stopwatch",
      payload,
      "stopwatch",
      isStopwatchState,
      "Timeout ao controlar o cronômetro"
    );
  });
}

module.exports = { register, isMediaState, isStopwatchState };
