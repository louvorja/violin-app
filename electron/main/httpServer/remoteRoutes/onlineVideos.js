"use strict";

/**
 * Rotas de vídeos online no controle remoto.
 *
 * GET  /api/online-videos       — álbuns, vídeos e busca
 * GET  /api/online-videos/image — miniatura em binário
 * POST /api/online-videos       — projeta uma URL do YouTube / encerra
 */
const { safeSend } = require("../../safeWebContents.js");


/** Teto dos dois acervos de vídeo (catálogo remoto + Meus Vídeos). */
const ONLINE_VIDEOS_MAX_BYTES = 8 * 1024 * 1024;

/** Miniatura servida em binário (blob do IDB do renderer). */
const ONLINE_VIDEOS_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ONLINE_VIDEOS_READ_ACTIONS = new Set(["albums", "videos", "search"]);

const ONLINE_VIDEOS_IMAGE_KINDS = new Set(["video", "category"]);


/**
 * Extrai o id de um link do YouTube (`watch?v=`, `youtu.be`, `embed`, `shorts`,
 * `live`) ou de um id cru de 11 caracteres.
 *
 * Só o **id** segue para o renderer: a URL nunca vira argumento de comando, e
 * id inválido vira 400 na hora (em vez de um 200 que não projeta nada).
 */
function extractYoutubeVideoId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}


/**
 * Registra as rotas de vídeos online.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    isOnlineVideosAlbumsResponse,
    isOnlineVideosVideosResponse,
    isOnlineVideoImageResponse,
    hasOnlineVideosPermission,
  } = ctx;

  // ---------------------------------------------------------------
  // /api/online-videos — Vídeos Online (controle remoto)
  //
  // GET  action=albums|videos|search — consulta os DOIS acervos no renderer
  //      (catálogo remoto `{lang}_collections_online` + Meus Vídeos no IDB)
  // POST action=play|close           — projeta uma URL do YouTube / encerra
  //
  // Devices pareados exigem a permission `online_videos` (ou `root`).
  // ---------------------------------------------------------------
  app.get("/api/online-videos", async (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos → 403 (device sem a permission online_videos)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.query.action || "albums";
    if (!ONLINE_VIDEOS_READ_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida para GET", valid: [...ONLINE_VIDEOS_READ_ACTIONS] });
    }

    const lang = req.query.lang === "es" ? "es" : "pt";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const album = typeof req.query.album === "string" ? req.query.album.trim().slice(0, 512) : "";
    if (action === "videos" && !album) {
      return res.status(400).json({ error: "album obrigatório" });
    }

    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:online-videos",
        { action, lang, q, album },
        {
          prefix: "online-videos",
          timeoutMs: 8_000,
          maxPayloadBytes: ONLINE_VIDEOS_MAX_BYTES,
          validatePayload:
            action === "albums" ? isOnlineVideosAlbumsResponse : isOnlineVideosVideosResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        // O log de recebimento (middleware) não mostra o desfecho — aqui sim:
        // é o que aparece no terminal quando a aba Vídeos Online consulta.
        const count = Array.isArray(data?.albums)
          ? data.albums.length
          : Array.isArray(data?.videos)
            ? data.videos.length
            : 0;
        console.log(`[httpServer] online-videos → ${action} ok (${count} itens)`);
        res.json(data);
      }
    } catch (error) {
      console.warn(
        `[httpServer] online-videos → ${action} falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar vídeos online");
    }
  });


  // ---------------------------------------------------------------
  // GET /api/online-videos/image?kind=video|category&id=...
  // Miniatura dos **Meus Vídeos** (blob no IndexedDB do renderer) e dos
  // ícones de imagem das categorias. As do catálogo remoto não passam por
  // aqui: são URLs públicas (ytimg) que o cliente carrega direto.
  // ---------------------------------------------------------------
  app.get("/api/online-videos/image", async (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos image → 403 (device sem a permission online_videos)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const id = typeof req.query.id === "string" ? req.query.id.trim().slice(0, 256) : "";
    if (!ONLINE_VIDEOS_IMAGE_KINDS.has(kind)) {
      return res.status(400).json({ error: "kind inválido", valid: [...ONLINE_VIDEOS_IMAGE_KINDS] });
    }
    if (!id) {
      return res.status(400).json({ error: "id obrigatório" });
    }

    try {
      const image = await requestRenderer(
        mainWindow,
        res,
        "http:online-videos",
        { action: "image", kind, id },
        {
          prefix: "online-videos",
          timeoutMs: 5_000,
          maxPayloadBytes: ONLINE_VIDEOS_IMAGE_MAX_BYTES,
          validatePayload: isOnlineVideoImageResponse,
        }
      );
      if (res.headersSent || res.writableEnded) return;

      if (!image.data) {
        console.log(`[httpServer] online-videos image → 404 (${kind}:${id})`);
        return res.status(404).json({ error: "Miniatura não encontrada" });
      }
      const bytes = ArrayBuffer.isView(image.data)
        ? Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
        : Buffer.from(image.data);
      res.set("Content-Type", image.mime);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(bytes);
    } catch (error) {
      console.warn(
        `[httpServer] online-videos image → falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar a miniatura");
    }
  });


  app.post("/api/online-videos", (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos → 403 no comando (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.body && req.body.action;
    if (action === "play") {
      const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
      const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 500) : "";
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        return res.status(400).json({ error: "url do YouTube inválida" });
      }
      safeSend(mainWindow, "http:online-videos", { action: "play", videoId, title });
      return res.json({ status: "ok", action: "play" });
    }

    if (action === "close") {
      safeSend(mainWindow, "http:online-videos", { action: "close" });
      return res.json({ status: "ok", action: "close" });
    }

    res.status(400).json({ error: "action inválida", valid: ["play", "close"] });
  });
}


module.exports = { register, extractYoutubeVideoId };
