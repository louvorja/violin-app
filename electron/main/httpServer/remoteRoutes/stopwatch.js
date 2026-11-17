"use strict";

const { isFiniteNumber, isStopwatchState } = require("../payloadValidation");
const { createRendererStateResponders } = require("./rendererState");

/**
 * Rotas do **Cronômetro** do controle remoto.
 *
 * O estado vive no singleton do cronômetro no renderer, então as rotas usam
 * o mesmo _renderer round-trip_ do Player: `requestRenderer` envia
 * `http:stopwatch` com um `requestId` e o renderer responde o snapshot já
 * atualizado. O comando devolve o estado na mesma resposta.
 *
 * Contrato:
 *   GET  /api/stopwatch → { status:"ok", state:{...} }
 *   POST /api/stopwatch → { action: start|pause|reset|lap|clear-laps|
 *                                   set-mode|set-target|extend-target|project|unproject, ... }
 *
 * Permissions: stopwatch (ou root).
 * Erros: { status:"error", code, message, error } com 400/409/503/504.
 */

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


/**
 * Registra as rotas do Cronômetro.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const { getValidMainWindow, hasDevicePermission } = ctx;
  const { requestState, denied, unavailable } = createRendererStateResponders(ctx);

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


module.exports = { register, isStopwatchState };
