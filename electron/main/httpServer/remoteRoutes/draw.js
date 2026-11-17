"use strict";

/**
 * Rotas do Sorteio no controle remoto.
 *
 * GET  /api/draw — estado atual (modo, nomes, intervalo, sorteados)
 * POST /api/draw — executa uma ação e devolve o estado resultante
 */

/** Estado do Sorteio devolvido pelo renderer (`http:draw`). */
function isDrawResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (payload.status === "error") return typeof payload.error === "string";
  if (payload.status !== "ok" || !payload.state || typeof payload.state !== "object") return false;
  const state = payload.state;
  if (state.status !== "ok") return false;
  if (state.mode !== "number" && state.mode !== "names") return false;
  if (!Array.isArray(state.names) || state.names.length > 10_000) return false;
  if (!state.names.every((name) => typeof name === "string" && name.length <= 200)) return false;
  if (!state.range || !Number.isInteger(state.range.min) || !Number.isInteger(state.range.max)) {
    return false;
  }
  if (state.current !== null && typeof state.current !== "string") return false;
  if (!Array.isArray(state.drawn) || state.drawn.length > 100_000) return false;
  if (!state.drawn.every((value) => typeof value === "string" && value.length <= 200)) return false;
  if (!Number.isInteger(state.total) || state.total < 0) return false;
  if (!Number.isInteger(state.remaining) || state.remaining < 0) return false;
  return (
    typeof state.animating === "boolean" &&
    typeof state.running === "boolean" &&
    typeof state.canDraw === "boolean" &&
    typeof state.projecting === "boolean"
  );
}


/**
 * Registra as rotas do Sorteio.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    hasDevicePermission,
  } = ctx;

  // ---------------------------------------------------------------
  // GET/POST /api/draw — Sorteio (números ou nomes)
  //
  // GET  devolve o estado atual (modo, nomes, intervalo, sorteados).
  // POST executa uma ação e devolve o estado resultante. O `draw` responde
  // imediatamente com `animating: true`; o cliente consulta o estado até a
  // roda assentar (não seguramos a requisição por até 60 s de efeito).
  //
  // Permission: draw (ou root).
  // ---------------------------------------------------------------
  async function drawStateViaRenderer(mainWindow, res, body) {
    const data = await requestRenderer(mainWindow, res, "http:draw", body, {
      prefix: "draw",
      timeoutMs: 5_000,
      maxPayloadBytes: 4_194_304,
      validatePayload: isDrawResponse,
    });
    if (data.status === "error") {
      if (!res.headersSent && !res.writableEnded) {
        res.status(400).json({ error: data.error || "falha no sorteio" });
      }
      return;
    }
    if (!res.headersSent && !res.writableEnded) res.json(data);
  }

  app.get("/api/draw", async (req, res) => {
    if (!hasDevicePermission(req, "draw")) {
      console.log("[httpServer] draw → 403 (device sem a permission draw)");
      return res.status(403).json({ error: "Device sem permissão de sorteio" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return res.status(503).json({ error: "Janela principal não disponível" });
    try {
      await drawStateViaRenderer(mainWindow, res, { action: "state" });
    } catch (error) {
      sendRendererError(res, error, "Timeout ao consultar o sorteio");
    }
  });

  app.post("/api/draw", async (req, res) => {
    if (!hasDevicePermission(req, "draw")) {
      console.log("[httpServer] draw → 403 (device sem a permission draw)");
      return res.status(403).json({ error: "Device sem permissão de sorteio" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return res.status(503).json({ error: "Janela principal não disponível" });

    const body = req.body || {};
    const action = body.action;
    const actions = [
      "state",
      "draw",
      "reset",
      "set-mode",
      "set-range",
      "add-name",
      "remove-name",
      "rename-name",
      "replace-names",
      "set-running",
      "set-projection",
    ];
    if (!actions.includes(action)) {
      return res.status(400).json({ error: "action inválida", valid: actions });
    }

    const payload = { action };
    if (action === "set-mode") {
      if (body.mode !== "number" && body.mode !== "names") {
        return res.status(400).json({ error: "mode deve ser number ou names" });
      }
      payload.mode = body.mode;
    } else if (action === "set-range") {
      if (
        !Number.isSafeInteger(body.min) ||
        !Number.isSafeInteger(body.max) ||
        body.min < -2_147_483_648 ||
        body.min > 2_147_483_647 ||
        body.max < -2_147_483_648 ||
        body.max > 2_147_483_647
      ) {
        return res.status(400).json({ error: "min e max devem ser inteiros de 32 bits" });
      }
      if (Math.abs(body.max - body.min) > 100_000) {
        return res.status(400).json({ error: "intervalo máximo de 100000 números" });
      }
      payload.min = body.min;
      payload.max = body.max;
    } else if (action === "add-name" || action === "remove-name" || action === "rename-name") {
      if (action !== "remove-name" && typeof body.name !== "string") {
        return res.status(400).json({ error: "name é obrigatório" });
      }
      if (action === "remove-name" && typeof body.name !== "string" && !Number.isInteger(body.index)) {
        return res.status(400).json({ error: "name ou index é obrigatório" });
      }
      if (action === "rename-name" && !Number.isInteger(body.index)) {
        return res.status(400).json({ error: "index é obrigatório" });
      }
      if (body.name !== undefined) payload.name = body.name;
      if (body.index !== undefined) payload.index = body.index;
    } else if (action === "replace-names") {
      if (
        !Array.isArray(body.names) ||
        body.names.length > 10_000 ||
        !body.names.every((name) => typeof name === "string")
      ) {
        return res.status(400).json({ error: "names deve ser uma lista de textos (máx. 10000)" });
      }
      payload.names = body.names;
    } else if (action === "set-running") {
      if (typeof body.running !== "boolean") {
        return res.status(400).json({ error: "running deve ser boolean" });
      }
      payload.running = body.running;
    } else if (action === "set-projection") {
      if (typeof body.active !== "boolean") {
        return res.status(400).json({ error: "active deve ser boolean" });
      }
      payload.active = body.active;
    }

    try {
      await drawStateViaRenderer(mainWindow, res, payload);
    } catch (error) {
      sendRendererError(res, error, "Timeout ao atualizar o sorteio");
    }
  });
}


module.exports = { register };
