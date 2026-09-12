"use strict";

const path = require("path");
const fs = require("fs");
const jsonCache = require("../jsonCache.js");
const devices = require("../devices.js");

const KEY_LITURGY_DAYS = "modules.liturgy.days";
const KEY_LITURGY_ACTIVE_DAY = "modules.liturgy.active_day";

/**
 * Estado em memória para sorteios (replicado entre requests).
 * Mantém sintonia com o estado interno dos módulos de sorteio.
 */
const _sorteios = {
  number: { last: null, history: [] },
  name: { last: null, history: [] },
};

function setupRoutes(app, { getMainWindow, getUserData, jsonCache: _cache, getDatabaseUrl, getApiToken }) {

  /** Retorna mainWindow apenas se existir e não estiver destruída. */
  function getValidMainWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win;
  }

  // ---------------------------------------------------------------
  // /api/ping — health check
  // ---------------------------------------------------------------
  app.get("/api/ping", (req, res) => {
    res.json({ status: "ok", app: "LouvorJA" });
  });

  // ---------------------------------------------------------------
  // /api/clock — hora do servidor
  // ---------------------------------------------------------------
  app.get("/api/clock", (req, res) => {
    const now = new Date();
    res.json({
      time: now.toTimeString().slice(0, 8),
      date: now.toISOString().slice(0, 10),
      timestamp: now.getTime(),
    });
  });

  // ---------------------------------------------------------------
  // POST /api/keyboard — simular tecla
  // Body: { key: string, modifiers?: string[] }
  // ---------------------------------------------------------------
  app.post("/api/keyboard", (req, res) => {
    const mainWindow = getValidMainWindow();
    const key = req.body && req.body.key;
    const modifiers = (req.body && req.body.modifiers) || [];
    if (!key || !mainWindow) {
      return res.status(400).json({ error: "key faltando ou janela indisponível" });
    }
    try {
      mainWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
      mainWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
      res.json({ status: "ok", key, modifiers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // POST /api/song-slides — ações de slides
  // Body: { action: string, index?: number }
  // ---------------------------------------------------------------
  app.post("/api/song-slides", (req, res) => {
    const mainWindow = getValidMainWindow();
    const action = req.body && req.body.action;
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const validActions = [
      "next", "previous", "playing-check", "close",
      "go-to-slide", "bible-next", "bible-prev", "bible-close",
    ];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: "action inválida", valid: validActions });
    }

    const payload = { action };
    if (action === "go-to-slide") {
      payload.index = parseInt(req.body.index, 10);
    }

    mainWindow.webContents.send("http:song-slides", payload);
    res.json({ status: "ok", action, payload });
  });

  // ---------------------------------------------------------------
  // POST /api/bible — projeta versículo ou encerra projeção
  // Body: { action?: "close"|"next"|"prev", text?, reference?, bookId?, chapter?, verse? }
  // ---------------------------------------------------------------
  app.post("/api/bible", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const { action, text, reference, bookId, chapter, verse } = req.body || {};

    if (action === "close") {
      const payload = { action: "bible-close" };
      mainWindow.webContents.send("http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-close", payload });
    }

    if (action === "next") {
      const payload = { action: "bible-next" };
      mainWindow.webContents.send("http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-next", payload });
    }

    if (action === "prev") {
      const payload = { action: "bible-prev" };
      mainWindow.webContents.send("http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-prev", payload });
    }

    if (!text || !reference) {
      return res.status(400).json({ error: "text e reference são obrigatórios (ou action=close)" });
    }

    const userData = typeof getUserData === "function" ? getUserData() : {};
    const versionId = userData?.id_bible_version;

    const payload = {
      action: "bible-verse",
      text,
      reference,
      bookId,
      chapter: chapter ? parseInt(chapter, 10) : undefined,
      verses: verse ? [parseInt(verse, 10)] : undefined,
      versionId,
    };

    mainWindow.webContents.send("http:song-slides", payload);
    res.json({ status: "ok", action: "bible-verse", payload });
  });

  // ---------------------------------------------------------------
  // POST /api/liturgy-execute — executa item da liturgia
  // Body: { id: string, tag?: string }
  // ---------------------------------------------------------------
  app.post("/api/liturgy-execute", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const id = req.body && req.body.id;
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório" });
    }

    const payload = { action: "liturgy-execute", id, tag: req.body.tag };
    mainWindow.webContents.send("http:song-slides", payload);
    res.json({ status: "ok", action: "liturgy-execute", payload });
  });

  // ---------------------------------------------------------------
  // POST /api/open-song — abre música para projeção
  // Body: { id: number, tag?: number, id_liturgy?: string }
  // tag: 1=audio, 2=instrumental, 3=no_audio
  // ---------------------------------------------------------------
  app.post("/api/open-song", (req, res) => {
    const mainWindow = getValidMainWindow();
    const id = parseInt(req.body && req.body.id, 10);
    const tag = parseInt((req.body && req.body.tag) || "3", 10);
    const id_liturgy = req.body && req.body.id_liturgy;

    if (isNaN(id) || !mainWindow) {
      return res.status(400).json({ error: "id inválido ou janela indisponível" });
    }

    const modeMap = { 1: "audio", 2: "instrumental", 3: "no_audio" };
    const mode = modeMap[tag] || "no_audio";

    mainWindow.webContents.send("http:open-song", { id_music: id, mode, id: id_liturgy });
    res.json({ status: "ok", id, mode });
  });

  // ---------------------------------------------------------------
  // /api/music-search?q=...&lang=pt (GET — somente leitura)
  // ---------------------------------------------------------------
  app.get("/api/music-search", (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 2) {
      return res.json({ status: "ok", results: [] });
    }
    const lang = req.query.lang || "pt";
    const query = q
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    try {
      const filePath = jsonCache.safeLocalPath(`${lang}_musics`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error: "Base de músicas não encontrada localmente. Faça uma atualização do banco.",
        });
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const all = JSON.parse(raw);

      const results = all
        .filter((m) => {
          const name = (m.name || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          const albums = (m.albums_names || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          return name.includes(query) || albums.includes(query);
        })
        .slice(0, 20);

      res.json({ status: "ok", results, total: results.length });
    } catch (e) {
      console.error("[httpServer] /api/music-search error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // /api/drawing-number
  // GET  action=get-last — consulta último sorteado
  // POST action=draw     — sortear número
  // ---------------------------------------------------------------
  app.get("/api/drawing-number", (req, res) => {
    const action = req.query.action;
    if (action === "get-last") {
      return res.json({ status: "ok", last: _sorteios.number.last });
    }
    res.status(400).json({ error: "action inválida", valid: ["get-last"] });
  });

  app.post("/api/drawing-number", (req, res) => {
    const mainWindow = getValidMainWindow();
    const { action, min, max } = req.body || {};

    if (action === "draw") {
      const minVal = parseInt(min || "1", 10);
      const maxVal = parseInt(max || "100", 10);
      const num = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
      _sorteios.number.last = num;
      _sorteios.number.history.push(num);

      if (mainWindow) {
        mainWindow.webContents.send("http:drawing-number", { number: num });
      }

      return res.json({ status: "ok", number: num, history: _sorteios.number.history });
    }

    res.status(400).json({ error: "action inválida", valid: ["draw"] });
  });

  // ---------------------------------------------------------------
  // /api/drawing-name
  // GET  action=get-last — consulta último sorteado
  // POST action=draw     — sortear nome
  // ---------------------------------------------------------------
  app.get("/api/drawing-name", (req, res) => {
    const action = req.query.action;
    if (action === "get-last") {
      return res.json({ status: "ok", last: _sorteios.name.last });
    }
    res.status(400).json({ error: "action inválida", valid: ["get-last"] });
  });

  app.post("/api/drawing-name", (req, res) => {
    const mainWindow = getValidMainWindow();
    const { action, names: namesRaw } = req.body || {};

    if (action === "draw") {
      const namesStr = namesRaw || "";
      const names = namesStr.split(",").map((n) => n.trim()).filter(Boolean);

      if (names.length === 0) {
        return res.status(400).json({ error: "names ausente ou vazio" });
      }

      const name = names[Math.floor(Math.random() * names.length)];
      _sorteios.name.last = name;
      _sorteios.name.history.push(name);

      if (mainWindow) {
        mainWindow.webContents.send("http:drawing-name", { name });
      }

      return res.json({ status: "ok", name, history: _sorteios.name.history });
    }

    res.status(400).json({ error: "action inválida", valid: ["draw"] });
  });

  // ---------------------------------------------------------------
  // /api/bible-downloaded — versões da Bíblia baixadas no host (GET)
  // ---------------------------------------------------------------
  app.get("/api/bible-downloaded", (req, res) => {
    const lang = req.query.lang || "pt";
    try {
      const versionsPath = jsonCache.safeLocalPath(`${lang}_bible_version`);
      const booksPath = jsonCache.safeLocalPath(`${lang}_bible_book`);
      if (!fs.existsSync(versionsPath) || !fs.existsSync(booksPath)) {
        return res.json({ status: "ok", downloaded: [] });
      }
      const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8"));
      const books = JSON.parse(fs.readFileSync(booksPath, "utf8"));
      if (!Array.isArray(versions) || !Array.isArray(books)) {
        return res.json({ status: "ok", downloaded: [] });
      }

      const userData = typeof getUserData === "function" ? getUserData() : {};
      const flaggedVersions = new Set(
        Array.isArray(userData?.storage?.bible_downloaded_versions)
          ? userData.storage.bible_downloaded_versions
          : []
      );

      const downloaded = [];
      for (const v of versions) {
        if (flaggedVersions.has(v.id_bible_version)) {
          downloaded.push(v.id_bible_version);
          continue;
        }
        let allPresent = true;
        for (const b of books) {
          const chCount = b.chapters || 1;
          for (let c = 1; c <= chCount; c++) {
            const chapterPath = jsonCache.safeLocalPath(
              `bible_${v.id_bible_version}_${b.id_bible_book}_${c}`
            );
            if (!fs.existsSync(chapterPath)) {
              allPresent = false;
              break;
            }
          }
          if (!allPresent) break;
        }
        if (allPresent) downloaded.push(v.id_bible_version);
      }
      res.json({ status: "ok", downloaded });
    } catch (e) {
      console.error("[httpServer] /api/bible-downloaded error:", e.message);
      res.json({ status: "ok", downloaded: [] });
    }
  });

  // ---------------------------------------------------------------
  // /api/announcements
  // GET  action=list       — lista anúncios (somente leitura)
  // POST action=project|next|prev|stop — controle de anúncios
  // ---------------------------------------------------------------
  app.get("/api/announcements", (req, res) => {
    const mainWindow = getValidMainWindow();
    const action = req.query.action || "list";

    if (action === "list") {
      if (!mainWindow) {
        return res.status(503).json({ error: "Janela principal não disponível" });
      }
      const { ipcMain } = require("electron");
      const channel = "_announcements_list_reply_" + Date.now();
      let sent = false;
      const timeout = setTimeout(() => {
        if (sent) return;
        sent = true;
        ipcMain.removeAllListeners(channel);
        res.status(504).json({ error: "Timeout ao buscar anúncios" });
      }, 5000);
      ipcMain.once(channel, (_event, data) => {
        if (sent) return;
        sent = true;
        clearTimeout(timeout);
        res.json(data);
      });
      mainWindow.webContents.send("http:song-slides", { action: "announcements-list", replyChannel: channel });
      return;
    }

    res.status(400).json({ error: "action inválida para GET, use POST para comandos" });
  });

  app.post("/api/announcements", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.body && req.body.action;

    if (action === "project") {
      const ids = req.body.ids || [];
      mainWindow.webContents.send("http:song-slides", { action: "announcements-project", ids });
      return res.json({ status: "ok", action: "announcements-project" });
    }

    if (action === "next") {
      mainWindow.webContents.send("http:song-slides", { action: "announcements-next" });
      return res.json({ status: "ok", action: "announcements-next" });
    }

    if (action === "prev") {
      mainWindow.webContents.send("http:song-slides", { action: "announcements-prev" });
      return res.json({ status: "ok", action: "announcements-prev" });
    }

    if (action === "stop") {
      mainWindow.webContents.send("http:song-slides", { action: "announcements-stop" });
      return res.json({ status: "ok", action: "announcements-stop" });
    }

    res.status(400).json({ error: "action inválida", valid: ["project", "next", "prev", "stop"] });
  });

  // ---------------------------------------------------------------
  // POST /api/projections/close — encerra todas as projeções ativas
  // ---------------------------------------------------------------
  app.post("/api/projections/close", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    mainWindow.webContents.send("http:projections-close");
    res.json({ status: "ok", action: "projections-close" });
  });

  // ---------------------------------------------------------------
  // /libras/:token — bundles de animação VLibras (GET)
  // ---------------------------------------------------------------
  app.get("/libras/:token", async (req, res) => {
    const token = req.params.token;
    if (!token) {
      return res.status(400).json({ error: "token obrigatório" });
    }

    try {
      const { ipcMain } = require("electron");
      const channel = "_libras_bundle_reply_" + Date.now();
      let sent = false;
      const timeout = setTimeout(() => {
        if (sent) return;
        sent = true;
        ipcMain.removeAllListeners(channel);
        res.status(504).json({ error: "Timeout ao buscar bundle" });
      }, 5000);

      ipcMain.once(channel, (_event, data) => {
        if (sent) return;
        sent = true;
        clearTimeout(timeout);
        if (data && data.data) {
          const buffer = Buffer.from(data.data);
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", buffer.length);
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.send(buffer);
        }
        res.status(404).json({ error: "Bundle não encontrado", token });
      });

      const mainWindow = getValidMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send("http:libras-bundle", { token, replyChannel: channel });
      } else {
        clearTimeout(timeout);
        ipcMain.removeAllListeners(channel);
        res.status(503).json({ error: "Janela principal não disponível" });
      }
    } catch (e) {
      console.error("[httpServer] /libras error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // /api/liturgy — itens da liturgia do dia (GET)
  // ---------------------------------------------------------------
  app.get("/api/liturgy", (req, res) => {
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

  // ---------------------------------------------------------------
  // /api/user-data?path=... (GET — somente leitura)
  // ---------------------------------------------------------------
  app.get("/api/user-data", (req, res) => {
    const path = req.query.path;
    if (!path) return res.status(400).json({ error: "path obrigatório" });

    const userData = typeof getUserData === "function" ? getUserData() : {};

    function getByPath(obj, path, fallback) {
      if (!path || !obj) return fallback;
      const keys = path.split(".");
      let cur = obj;
      for (const key of keys) {
        if (!cur || cur[key] === undefined || cur[key] === null) return fallback;
        cur = cur[key];
      }
      return cur;
    }

    const value = getByPath(userData, path, null);
    res.json({ status: "ok", path, value });
  });

  // ---------------------------------------------------------------
  // GET /api/db/:path(*) — cache JSON (somente leitura)
  // ---------------------------------------------------------------
  app.get("/api/db/:path(*)", async (req, res) => {
    const rawPath = req.params.path;
    if (!rawPath) {
      return res.status(400).json({ error: "path é obrigatório" });
    }
    const sanitized = rawPath.replace(/^\/+/g, "").replace(/\.\.\//g, "");
    try {
      const filePath = jsonCache.safeLocalPath(sanitized);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        return res.json(JSON.parse(raw));
      }

      const databaseUrl = typeof getDatabaseUrl === "function" ? getDatabaseUrl() : "";
      const apiToken = typeof getApiToken === "function" ? getApiToken() : "";
      const headers = apiToken ? { "Api-Token": apiToken } : {};

      const result = await jsonCache.fetchJson(sanitized, databaseUrl, headers);
      if (result.status === 200 && result.body) {
        return res.json(JSON.parse(result.body.toString("utf-8")));
      }

      return res.status(404).json({
        error: "Arquivo não encontrado no cache local nem no servidor remoto",
        path: sanitized,
      });
    } catch (e) {
      console.error("[httpServer] /api/db error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // GET/POST /api/settings/devices — configurações de dispositivos
  // GET: retorna { only_authorized_devices: boolean }
  // POST: { only_authorized_devices: boolean } — grava e retorna novo estado
  // ---------------------------------------------------------------
  app.get("/api/settings/devices", (_req, res) => {
    res.json(devices.getSettings());
  });

  app.post("/api/settings/devices", (req, res) => {
    const body = req.body || {};
    if (typeof body.only_authorized_devices !== "boolean") {
      return res.status(400).json({ error: "only_authorized_devices deve ser boolean" });
    }
    const updated = devices.updateSettings({ only_authorized_devices: body.only_authorized_devices });
    res.json(updated);
  });
}

module.exports = { setupRoutes };
