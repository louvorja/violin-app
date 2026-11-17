"use strict";

/**
 * Rotas de chat do controle remoto.
 *
 * POST /api/chat         — envia uma mensagem
 * GET  /api/chat/history — últimas mensagens (somente leitura)
 */
const devices = require("../../devices.js");
const docStore = require("../../docStore.js");
const { safeSend } = require("../../safeWebContents.js");

/** Coleção (docStore) onde o histórico do chat é persistido — igual ao renderer. */
const CHAT_MESSAGES_COLLECTION = "chat.messages";


/** Rate limit simples: 1 msg/500ms por device. */
const _chatRateLimit = new Map();


/**
 * Registra as rotas de chat.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const { getValidMainWindow, hasDevicePermission } = ctx;

  // ---------------------------------------------------------------
  // POST /api/chat — enviar mensagem de chat
  // Body: { text: string, sender: string }
  // Headers: X-Device-Id (opcional)
  // ---------------------------------------------------------------
  app.post("/api/chat", (req, res) => {
    const { text, sender } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text obrigatório" });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: "text excede 2000 caracteres" });
    }

    // Rate limit: 1 msg/seg por device
    const deviceId = req.headers && req.headers["x-device-id"];
    const rateKey = deviceId || req.ip;
    const now = Date.now();
    const last = _chatRateLimit.get(rateKey) || 0;
    if (now - last < 1000) {
      return res.status(429).json({ error: "Rate limit: 1 msg/seg" });
    }
    _chatRateLimit.set(rateKey, now);

    // Verifica permissão "chat" do device (se identificado)
    if (deviceId) {
      const device = devices.findById(String(deviceId));
      if (device && device.permissions && !device.permissions.includes("chat") && !device.permissions.includes("root")) {
        return res.status(403).json({ error: "Device sem permissão de chat" });
      }
    }

    const foundDevice = deviceId ? devices.findById(String(deviceId)) : null;
    const deviceName = foundDevice?.name;

    // Id gerado pelo client (app) para casar a mensagem otimista com o eco SSE
    // e evitar duplicata na tela. Aceita só strings curtas; senão gera um UUID.
    const rawId = req.body && req.body.id;
    const id =
      typeof rawId === "string" && rawId.trim().length > 0 && rawId.trim().length <= 64
        ? rawId.trim()
        : crypto.randomUUID();

    const msg = {
      id,
      sender: deviceName || sender || "Dispositivo",
      deviceId: deviceId || undefined,
      platform: foundDevice?.platform || undefined,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    // Publica via SSE para todos os clients conectados
    // (require preguiçoso preserva a ordem de carga de antes da extração).
    const events = require("../events.js");
    events.publish({ type: "chat_message", payload: msg });

    // Envia IPC para o renderer local
    const mainWindow = getValidMainWindow();
    if (mainWindow) {
      safeSend(mainWindow, "transmission:chat-message", msg);
    }

    res.json({ ok: true, id: msg.id });
  });


  // ---------------------------------------------------------------
  // GET /api/chat/history — últimas mensagens do chat (somente leitura)
  //
  // Devolve até `chat_history_limit` mensagens (definido nas opções do
  // desktop), da mais antiga para a mais recente. O app usa isso para
  // preencher lacunas após reconectar.
  // ---------------------------------------------------------------
  app.get("/api/chat/history", (req, res) => {
    if (!hasDevicePermission(req, "chat")) {
      console.log("[httpServer] chat/history → 403 (device sem a permission chat)");
      return res.status(403).json({ error: "Device sem permissão de chat" });
    }
    const limit = devices.getChatHistoryLimit();
    let messages = [];
    try {
      messages = docStore.read(CHAT_MESSAGES_COLLECTION);
    } catch (e) {
      console.warn("[httpServer] /api/chat/history: falha ao ler o histórico:", e.message);
    }
    const ordenadas = [...messages].sort((a, b) =>
      String(a && a.timestamp ? a.timestamp : "").localeCompare(
        String(b && b.timestamp ? b.timestamp : ""),
      ),
    );
    res.json({ status: "ok", messages: ordenadas.slice(-limit) });
  });
}


module.exports = { register };
