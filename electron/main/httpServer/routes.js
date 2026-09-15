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

/** Rate limit simples: 1 msg/500ms por device. */
const _chatRateLimit = new Map();

/** Modos de execução de música aceitos pelo /api/open-song. */
const SONG_MODES = new Set([
  "audio",
  "instrumental",
  "no_audio",
  "audio-only",
  "playback-only",
]);

/** Mapa legado tag → mode (clients antigos que só enviam `tag`). */
const SONG_TAG_MODES = { 1: "audio", 2: "instrumental", 3: "no_audio" };

/**
 * Resolve o modo de execução da música.
 *
 * Prioridade: `mode` válido > `tag` legado > `"audio"` (Cantado). Assim os
 * clients novos escolhem o modo explicitamente, os antigos continuam
 * funcionando pelo `tag`, e uma requisição sem nenhum dos dois abre cantado.
 */
function _resolveSongMode(body) {
  const rawMode = body && body.mode;
  if (typeof rawMode === "string" && SONG_MODES.has(rawMode)) return rawMode;
  const tag = parseInt((body && body.tag) || "", 10);
  if (SONG_TAG_MODES[tag]) return SONG_TAG_MODES[tag];
  return "audio";
}

/**
 * Códigos VK legados (modo clássico do app) → nomes de tecla do DOM.
 * O modo clássico remapeia as setas para números (37/38/39/40…).
 */
const LEGACY_VK_KEYS = {
  13: "Enter",
  27: "Escape",
  32: "Space",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
};

/** Aliases aceitos → nome DOM usado pelo `Hotkeys` do renderer. */
const KEY_ALIASES = {
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  esc: "Escape",
  " ": "Space",
  space: "Space",
  return: "Enter",
};

/**
 * Normaliza o nome da tecla recebido do client para o nome DOM.
 *
 * O app manda `ArrowRight`/`Space`/`Home`… (e o modo clássico, códigos VK).
 * O `Hotkeys` do renderer compara por `KeyboardEvent.key`, então a chave
 * precisa chegar no formato DOM.
 */
function normalizeKeyName(rawKey) {
  const str = String(rawKey ?? "");
  // Espaço literal (" ") é uma tecla, não whitespace a aparar.
  if (str === " ") return "Space";
  const trimmed = str.trim();
  if (!trimmed) return null;
  if (LEGACY_VK_KEYS[trimmed]) return LEGACY_VK_KEYS[trimmed];
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed;
}

function setupRoutes(app, { getMainWindow, getUserData, jsonCache: _cache, getDatabaseUrl, getApiToken }) {

  /** Retorna mainWindow apenas se existir e não estiver destruída. */
  function getValidMainWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win;
  }

  // ---------------------------------------------------------------
  // /api/ping — health check
  //
  // Único path acessível a devices cadastrados ainda SEM permissões
  // (ver `allowUnapprovedPaths` no auth). O app usa `authorized` para
  // saber se o host já aprovou o pareamento.
  // ---------------------------------------------------------------
  app.get("/api/ping", (req, res) => {
    const info = req.authInfo || { kind: "unknown", authorized: false, permissions: [] };
    res.json({
      status: "ok",
      app: "LouvorJA",
      authorized: info.authorized === true,
      permissions: Array.isArray(info.permissions) ? info.permissions : [],
    });
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
  //
  // Injeta um KeyboardEvent sintético no renderer em vez de usar
  // `webContents.sendInputEvent`. Dois motivos:
  //  1. `sendInputEvent` exige a BrowserWindow EM FOCO (ver docs do Electron),
  //     e o controle remoto é usado justamente com o desktop em segundo plano;
  //  2. `sendInputEvent.keyCode` só aceita códigos de Accelerator ("Right"),
  //     não nomes DOM ("ArrowRight") — era o que o app enviava.
  // O evento sintético cai no `Hotkeys` do renderer, reaproveitando todo o
  // roteamento já existente (Media × Bíblia).
  // ---------------------------------------------------------------
  app.post("/api/keyboard", (req, res) => {
    const mainWindow = getValidMainWindow();
    const rawKey = req.body && req.body.key;
    const modifiers = (req.body && req.body.modifiers) || [];
    if (!rawKey || !mainWindow) {
      return res.status(400).json({ error: "key faltando ou janela indisponível" });
    }

    const key = normalizeKeyName(rawKey);
    if (!key) {
      return res.status(400).json({ error: `key inválida: ${rawKey}` });
    }

    const mods = new Set(
      (Array.isArray(modifiers) ? modifiers : []).map((m) => String(m).toLowerCase())
    );
    const event = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.has("control") || mods.has("ctrl"),
      metaKey: mods.has("meta") || mods.has("cmd") || mods.has("command"),
      altKey: mods.has("alt"),
      shiftKey: mods.has("shift"),
    };

    try {
      // `executeJavaScript` roda independente de foco/minimização.
      mainWindow.webContents
        .executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(event)}))`
        )
        .catch(() => { /* janela ainda carregando ou destruída */ });
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
  // Body: { id: number, mode?: string, tag?: number, id_liturgy?: string }
  //
  // mode: audio | instrumental | no_audio | audio-only | playback-only
  // tag (legado): 1=audio, 2=instrumental, 3=no_audio
  // ---------------------------------------------------------------
  app.post("/api/open-song", (req, res) => {
    const mainWindow = getValidMainWindow();
    const id = parseInt(req.body && req.body.id, 10);
    const id_liturgy = req.body && req.body.id_liturgy;

    if (isNaN(id) || !mainWindow) {
      return res.status(400).json({ error: "id inválido ou janela indisponível" });
    }

    const mode = _resolveSongMode(req.body);

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
    const events = require("./events.js");
    events.publish({ type: "chat_message", payload: msg });

    // Envia IPC para o renderer local
    const mainWindow = getValidMainWindow();
    if (mainWindow) {
      try {
        mainWindow.webContents.send("transmission:chat-message", msg);
      } catch (_) { /* noop */ }
    }

    res.json({ ok: true, id: msg.id });
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

module.exports = {
  setupRoutes,
  resolveSongMode: _resolveSongMode,
  normalizeKeyName,
};
