"use strict";

/**
 * Rotas da liturgia no controle remoto.
 *
 * POST /api/liturgy-execute — executa um item da liturgia
 * GET  /api/liturgy         — itens da liturgia do dia
 */
const { safeSend } = require("../../safeWebContents.js");

const KEY_LITURGY_DAYS = "modules.liturgy.days";

const KEY_LITURGY_ACTIVE_DAY = "modules.liturgy.active_day";


/**
 * Registra as rotas da liturgia.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const { getValidMainWindow, getUserData, hasDevicePermission } = ctx;

  // ---------------------------------------------------------------
  // POST /api/liturgy-execute — executa item da liturgia
  // Body: { id: string, tag?: string }
  // ---------------------------------------------------------------
  app.post("/api/liturgy-execute", (req, res) => {
    // Executar item projeta música/bíblia/mídia no desktop pelo renderer — a
    // rota é da liturgia, então a role que manda é `liturgy`.
    if (!hasDevicePermission(req, "liturgy")) {
      console.log("[httpServer] liturgy-execute → 403 (device sem a permission liturgy)");
      return res.status(403).json({ error: "Device sem permissão de liturgia" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const id = req.body && req.body.id;
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório" });
    }

    // O dia que o cliente exibiu (a rota GET devolve o `day` da lista): o
    // renderer busca o item nele e só cai no fallback (hoje → dia ativo) se
    // faltar ou vier fora de 0..6.
    const rawDay = req.body && req.body.day;
    const parsedDay = typeof rawDay === "string" && rawDay.trim() !== "" ? Number(rawDay) : rawDay;
    const day = Number.isInteger(parsedDay) && parsedDay >= 0 && parsedDay <= 6 ? parsedDay : undefined;

    const payload = {
      action: "liturgy-execute",
      id,
      tag: req.body.tag,
      ...(day !== undefined ? { day } : {}),
    };
    safeSend(mainWindow, "http:song-slides", payload);
    res.json({ status: "ok", action: "liturgy-execute", payload });
  });


  // ---------------------------------------------------------------
  // /api/liturgy — itens da liturgia do dia (GET)
  // ---------------------------------------------------------------
  app.get("/api/liturgy", (req, res) => {
    if (!hasDevicePermission(req, "liturgy")) {
      console.log("[httpServer] liturgy → 403 (device sem a permission liturgy)");
      return res.status(403).json({ error: "Device sem permissão de liturgia" });
    }
    const userData = typeof getUserData === "function" ? getUserData() : {};
    const day = req.query.day != null ? parseInt(req.query.day, 10) : new Date().getDay();

    function getByPath(obj, path, fallback) {
      if (!path || !obj) return fallback;
      const keys = path.split(".");
      let cur = obj;
      for (const key of keys) {
        if (cur[key] === undefined || cur[key] === null) return fallback;
        cur = cur[key];
      }
      return cur;
    }

    const allDays = getByPath(userData, KEY_LITURGY_DAYS, {});
    let items = allDays[day] || [];

    if (items.length === 0) {
      const activeDay = getByPath(userData, KEY_LITURGY_ACTIVE_DAY, day);
      if (activeDay !== day) {
        items = allDays[activeDay] || [];
        return res.json({ status: "ok", day: activeDay, items, is_active_day: true });
      }
    }

    res.json({ status: "ok", day, items });
  });
}


module.exports = { register };
