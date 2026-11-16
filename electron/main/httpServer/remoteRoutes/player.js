"use strict";

const { isFiniteNumber, isMediaState } = require("../payloadValidation");
const { createRendererStateResponders } = require("./rendererState");

/**
 * Rotas do **Player de mídia** do controle remoto.
 *
 * O estado vive no renderer (player de arquivo/YouTube), então as rotas usam
 * o mesmo _renderer round-trip_ do Sorteio: `requestRenderer` envia
 * `http:media` com um `requestId` e o renderer responde o snapshot já
 * atualizado. O comando devolve o estado na mesma resposta — o cliente não
 * precisa de um GET extra.
 *
 * Contrato:
 *   GET  /api/media → { status:"ok", state:{...} }
 *   POST /api/media → { action: play|pause|seek|seek-relative|next|previous|close }
 *
 * Permissions: player (ou root).
 * Erros: { status:"error", code, message, error } com 400/409/503/504.
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


/**
 * Registra as rotas do Player de mídia.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const { getValidMainWindow, hasDevicePermission } = ctx;
  const { requestState, denied, unavailable } = createRendererStateResponders(ctx);

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
}


module.exports = { register, isMediaState };
