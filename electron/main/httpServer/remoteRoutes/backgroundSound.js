"use strict";

/**
 * Rotas do som de fundo no controle remoto.
 *
 * GET  /api/background-sound — estado + biblioteca (metadados)
 * POST /api/background-sound — play/pause/resume/stop/play-default
 */
const { safeSend } = require("../../safeWebContents.js");


/**
 * Registra as rotas do som de fundo.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    isPlainObject,
    isBackgroundSoundStateResponse,
    hasDevicePermission,
  } = ctx;

  // ---------------------------------------------------------------
  // /api/background-sound — Som de fundo no controle remoto
  // GET  → estado + biblioteca (metadados; os bytes ficam no renderer)
  // POST → play/pause/resume/stop (o player single do desktop, sem o módulo aberto)
  // Permission: background_sound (ou root)
  // ---------------------------------------------------------------
  app.get("/api/background-sound", async (req, res) => {
    if (!hasDevicePermission(req, "background_sound")) {
      console.log("[httpServer] background-sound → 403 (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de som de fundo" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:background-sound",
        { action: "state" },
        {
          prefix: "background-sound",
          timeoutMs: 4_000,
          maxPayloadBytes: 4 * 1024 * 1024,
          validatePayload: isBackgroundSoundStateResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        console.log(
          `[httpServer] background-sound → estado ok (${data.files.length} sons, playing=${data.playing})`
        );
        res.json(data);
      }
    } catch (error) {
      console.warn(
        `[httpServer] background-sound estado falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar o som de fundo");
    }
  });


  const BACKGROUND_SOUND_ACTIONS = new Set(["play", "pause", "resume", "stop", "play-default"]);
  app.post("/api/background-sound", async (req, res) => {
    if (!hasDevicePermission(req, "background_sound")) {
      console.log("[httpServer] background-sound → 403 no comando (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de som de fundo" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const action = req.body && req.body.action;
    if (!BACKGROUND_SOUND_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida", valid: [...BACKGROUND_SOUND_ACTIONS] });
    }
    const id = typeof req.body.id === "string" ? req.body.id.trim().slice(0, 256) : "";
    if (action === "play" && !id) {
      return res.status(400).json({ error: "id é obrigatório para play" });
    }

    // play-default precisa da resposta do renderer (é o único com feedback):
    // idempotente no renderer (padrão já tocando → ok sem reiniciar) e 404
    // quando não há som marcado — o módulo Apresentador mostra o motivo.
    if (action === "play-default") {
      try {
        const data = await requestRenderer(mainWindow, res, "http:background-sound", { action }, {
          prefix: "background-sound",
          timeoutMs: 4_000,
          maxPayloadBytes: 8_192,
          validatePayload: (payload) =>
            isPlainObject(payload) &&
            (payload.status === "ok" || (payload.status === "error" && typeof payload.error === "string")),
        });
        if (!res.headersSent && !res.writableEnded) {
          if (data.status === "error") {
            return res.status(404).json({ error: data.error });
          }
          res.json({ status: "ok", action });
        }
      } catch (error) {
        console.warn(
          `[httpServer] background-sound play-default falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao iniciar o som de fundo");
      }
      return;
    }

    safeSend(mainWindow, "http:background-sound", { action, ...(id ? { id } : {}) });
    res.json({ status: "ok", action });
  });
}


module.exports = { register };
