"use strict";

/**
 * Rotas de TRANSMISSÃO — o que a tela Opções → Transmissão oferece como
 * URL/janela (relógio `/clock`, música `/obs`, bíblia `/obs/bible`), o
 * pipeline de projeção (open-song → song-slides → projections/close), as
 * janelas de anúncios/sorteio/libras e os dados que os displays carregam
 * (`user-data`, `db`, versões baixadas da bíblia).
 *
 * Extraído de routes.js: o motor de renderer, os validadores e os deps
 * (`getUserData`/`getDatabaseUrl`/`getApiToken`) chegam no `ctx` do
 * `register`, montado pelo setupRoutes do arquivo principal — dono do
 * contrato. Este arquivo não requer routes.js (sem ciclo).
 */
const fs = require("fs");
const jsonCache = require("../jsonCache.js");
const { safeSend } = require("../safeWebContents.js");
const { HARD_MAX_PAYLOAD_BYTES } = require("./rendererRequestRegistry.js");

const SLIDE_STATE_MAX_BYTES = 8 * 1024 * 1024;

const ANNOUNCEMENTS_MAX_BYTES = 2 * 1024 * 1024;


/**
 * Estado em memória para sorteios (replicado entre requests).
 * Mantém sintonia com o estado interno dos módulos de sorteio.
 */
const _sorteios = {
  number: { last: null, history: [] },
  name: { last: null, history: [] },
};


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
 * Registra as rotas de transmissão.
 *
 * @param {import("express").Application} app
 * @param {object} ctx motor de renderer, validadores e deps (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    getUserData,
    getDatabaseUrl,
    getApiToken,
    isSlideStateResponse,
    isAnnouncementsResponse,
    isLibrasBundleResponse,
  } = ctx;


  /** Consulta o estado atual sem permitir que o renderer escolha um canal IPC. */
  async function askSlideState(mainWindow, res) {
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:song-slides",
        { action: "playing-check" },
        {
          prefix: "slides",
          timeoutMs: 3_000,
          maxPayloadBytes: SLIDE_STATE_MAX_BYTES,
          validatePayload: isSlideStateResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) res.json(data);
    } catch (error) {
      sendRendererError(res, error, "Timeout ao consultar o estado dos slides");
    }
  }


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
  // POST /api/song-slides — ações de slides
  // Body: { action: string, index?: number, presentation_session?: string }
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

    // `playing-check` é consulta (não comando): devolve o estado atual.
    if (action === "playing-check") {
      return askSlideState(mainWindow, res);
    }

    const payload = { action };
    if (action === "go-to-slide") {
      const index = req.body?.index;
      if (!Number.isSafeInteger(index) || index < 0) {
        return res.status(400).json({ error: "index deve ser um inteiro não negativo" });
      }
      payload.index = index;
    }

    if (["next", "previous", "close", "go-to-slide"].includes(action)) {
      const session = req.body?.presentation_session;
      if (session !== undefined) {
        if (typeof session !== "string" || !session || session.length > 128) {
          return res.status(400).json({ error: "presentation_session inválida" });
        }
        payload.presentation_session = session;
      }
    }

    safeSend(mainWindow, "http:song-slides", payload);
    res.json({ status: "ok", action, payload });
  });



  // ---------------------------------------------------------------
  // GET /api/song-slides?action=playing-check — mesma consulta por GET
  // (clientes que só fazem GET usam esta forma).
  // ---------------------------------------------------------------
  app.get("/api/song-slides", (req, res) => {
    if (req.query.action !== "playing-check") {
      return res.status(400).json({ error: "action inválida para GET", valid: ["playing-check"] });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    return askSlideState(mainWindow, res);
  });



  // ---------------------------------------------------------------
  // POST /api/bible — projeta versículo ou encerra projeção
  // Body: { action?: "close"|"next"|"prev", text?, reference?, bookId?, versionId?, chapter?, verse? }
  // ---------------------------------------------------------------
  app.post("/api/bible", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const {
      action, text, reference, bookId, chapter, verse, versionId: requestedVersionId,
    } = req.body || {};

    if (action === "close") {
      const payload = { action: "bible-close" };
      safeSend(mainWindow, "http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-close", payload });
    }

    if (action === "next") {
      const payload = { action: "bible-next" };
      safeSend(mainWindow, "http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-next", payload });
    }

    if (action === "prev") {
      const payload = { action: "bible-prev" };
      safeSend(mainWindow, "http:song-slides", payload);
      return res.json({ status: "ok", action: "bible-prev", payload });
    }

    if (!text || !reference) {
      return res.status(400).json({ error: "text e reference são obrigatórios (ou action=close)" });
    }

    if (
      requestedVersionId != null &&
      (!Number.isSafeInteger(requestedVersionId) || requestedVersionId < 1)
    ) {
      return res.status(400).json({ error: "versionId deve ser um inteiro positivo" });
    }
    const userData = typeof getUserData === "function" ? getUserData() : {};
    const versionId = requestedVersionId ?? userData?.id_bible_version;

    const payload = {
      action: "bible-verse",
      text,
      reference,
      bookId,
      chapter: chapter ? parseInt(chapter, 10) : undefined,
      verses: verse ? [parseInt(verse, 10)] : undefined,
      versionId,
    };

    safeSend(mainWindow, "http:song-slides", payload);
    res.json({ status: "ok", action: "bible-verse", payload });
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

    // Música personalizada: o `id` do corpo é um negativo sintético (só serve
    // para listas) — a execução é sempre pelo UUID em `custom_song_id`.
    const customSongId =
      typeof req.body.custom_song_id === "string" && req.body.custom_song_id
        ? req.body.custom_song_id
        : undefined;

    safeSend(mainWindow, "http:open-song", {
      id_music: id,
      mode,
      id: id_liturgy,
      ...(customSongId ? { custom_song_id: customSongId } : {}),
    });
    res.json({ status: "ok", id, mode });
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
        safeSend(mainWindow, "http:drawing-number", { number: num });
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
        safeSend(mainWindow, "http:drawing-name", { name });
      }

      return res.json({ status: "ok", name, history: _sorteios.name.history });
    }

    res.status(400).json({ error: "action inválida", valid: ["draw"] });
  });



  // ---------------------------------------------------------------
  // /api/bible-downloaded — versões da Bíblia baixadas no host (GET)
  // ---------------------------------------------------------------
  app.get("/api/bible-downloaded", async (req, res) => {
    const lang = req.query.lang || "pt";
    try {
      const versionsPath = jsonCache.safeLocalPath(`${lang}_bible_version`);
      const booksPath = jsonCache.safeLocalPath(`${lang}_bible_book`);
      let versionsRaw;
      let booksRaw;
      try {
        [versionsRaw, booksRaw] = await Promise.all([
          fs.promises.readFile(versionsPath, "utf8"),
          fs.promises.readFile(booksPath, "utf8"),
        ]);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return res.json({ status: "ok", downloaded: [] });
      }
      const versions = JSON.parse(versionsRaw);
      const books = JSON.parse(booksRaw);
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
          for (let start = 1; start <= chCount; start += 32) {
            const end = Math.min(start + 32, chCount + 1);
            const present = await Promise.all(
              Array.from({ length: end - start }, (_, offset) => {
                const chapterPath = jsonCache.safeLocalPath(
                  `bible_${v.id_bible_version}_${b.id_bible_book}_${start + offset}`
                );
                return fs.promises.access(chapterPath).then(
                  () => true,
                  (error) => {
                    if (error.code === "ENOENT") return false;
                    throw error;
                  }
                );
              })
            );
            if (present.includes(false)) {
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
  app.get("/api/announcements", async (req, res) => {
    const mainWindow = getValidMainWindow();
    const action = req.query.action || "list";

    if (action === "list") {
      if (!mainWindow) {
        return res.status(503).json({ error: "Janela principal não disponível" });
      }
      try {
        const data = await requestRenderer(
          mainWindow,
          res,
          "http:song-slides",
          { action: "announcements-list" },
          {
            prefix: "announcements",
            timeoutMs: 5_000,
            maxPayloadBytes: ANNOUNCEMENTS_MAX_BYTES,
            validatePayload: isAnnouncementsResponse,
          }
        );
        if (!res.headersSent && !res.writableEnded) res.json(data);
      } catch (error) {
        sendRendererError(res, error, "Timeout ao buscar anúncios");
      }
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
      safeSend(mainWindow, "http:song-slides", { action: "announcements-project", ids });
      return res.json({ status: "ok", action: "announcements-project" });
    }

    if (action === "next") {
      safeSend(mainWindow, "http:song-slides", { action: "announcements-next" });
      return res.json({ status: "ok", action: "announcements-next" });
    }

    if (action === "prev") {
      safeSend(mainWindow, "http:song-slides", { action: "announcements-prev" });
      return res.json({ status: "ok", action: "announcements-prev" });
    }

    if (action === "stop") {
      safeSend(mainWindow, "http:song-slides", { action: "announcements-stop" });
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
    safeSend(mainWindow, "http:projections-close");
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
      const mainWindow = getValidMainWindow();
      if (!mainWindow) {
        return res.status(503).json({ error: "Janela principal não disponível" });
      }
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:libras-bundle",
        { token },
        {
          prefix: "libras",
          timeoutMs: 5_000,
          maxPayloadBytes: HARD_MAX_PAYLOAD_BYTES,
          validatePayload: isLibrasBundleResponse,
        }
      );
      if (res.headersSent || res.writableEnded) return;
      if (data?.data) {
        const bytes = data.data;
        const buffer = bytes instanceof ArrayBuffer
          ? Buffer.from(bytes)
          : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(buffer);
      }
      res.status(404).json({ error: "Bundle não encontrado", token });
    } catch (e) {
      if (e?.code) {
        sendRendererError(res, e, "Timeout ao buscar bundle");
        return;
      }
      console.error("[httpServer] /libras error:", e.message);
      if (!res.headersSent && !res.writableEnded) res.status(500).json({ error: e.message });
    }
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
      try {
        const raw = await fs.promises.readFile(filePath, "utf8");
        return res.json(JSON.parse(raw));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
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
}

module.exports = {
  register,
  resolveSongMode: _resolveSongMode,
};
