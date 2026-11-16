"use strict";

/**
 * Rota de volume do controle remoto.
 *
 * POST /api/volume — volume dos players (projeção + som de fundo)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    hasDevicePermission,
    isVolumeResponse,
  } = ctx;

  // ---------------------------------------------------------------
  // POST /api/volume — volume dos players (projeção + som de fundo)
  //   { action: up|down, step? }  → passo (padrão 1%, clamp 0..100)
  //   { action: set, value }      → nível absoluto (0..100) — iOS espelha o iPhone
  // Permission: volume (ou root). Somente modo Violin (o Delphi não serve isto).
  // ---------------------------------------------------------------
  app.post("/api/volume", async (req, res) => {
    if (!hasDevicePermission(req, "volume")) {
      console.log("[httpServer] volume → 403 (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de volume" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const action = req.body && req.body.action;
    if (!["up", "down", "set"].includes(action)) {
      return res.status(400).json({ error: "action inválida", valid: ["up", "down", "set"] });
    }
    // `== null` cobre `undefined` (campo ausente) e `null` (cliente que manda
    // a propriedade explicitamente) — os dois significam "padrão 1%".
    const step = req.body.step == null ? 1 : req.body.step;
    const value = req.body.value;
    if (!Number.isInteger(step) || step < 1 || step > 100) {
      return res.status(400).json({ error: "step deve ser um inteiro entre 1 e 100" });
    }
    if (action === "set" && (!Number.isInteger(value) || value < 0 || value > 100)) {
      return res.status(400).json({ error: "value deve ser um inteiro entre 0 e 100" });
    }
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:volume",
        { action, step, ...(action === "set" ? { value } : {}) },
        {
          prefix: "volume",
          timeoutMs: 3_000,
          maxPayloadBytes: 4_096,
          validatePayload: isVolumeResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        console.log(`[httpServer] volume → ${action} = ${data.value}%`);
        res.json(data);
      }
    } catch (error) {
      console.warn(`[httpServer] volume falhou: ${error?.code || error?.message || error}`);
      sendRendererError(res, error, "Timeout ao ajustar o volume");
    }
  });
}


module.exports = { register };
