"use strict";

/**
 * Rotas HTTP do desktop — ARQUIVO PRINCIPAL (infra + contratos + motor).
 *
 * A organização ficou em três arquivos:
 *   - routes.js (este): infra do servidor (`ping`, `settings/devices`),
 *     os validadores/payloads (contratos exportados para os specs) e o motor
 *     de renderer compartilhado (`requestRenderer`/`sendRendererError`/
 *     `getValidMainWindow`), além do orquestrador `setupRoutes`;
 *   - transmissionRoutes.js: as URLs/janelas da tela Opções → Transmissão
 *     (relógio, música, bíblia, projeções, anúncios, sorteio, libras) e os
 *     dados que esses displays carregam (`user-data`, `db`);
 *   - remoteRoutes.js: as features do controle remoto (teclado, liturgia,
 *     músicas, vídeos online, som de fundo, volume, chat).
 *
 * Os dois registros recebem tudo por `ctx` — por isso **nunca** requerem este
 * arquivo (sem require circular) — e o `module.exports` mantém o mesmo
 * contrato de antes, com chaves literais para o `import { … }` ESM dos specs
 * continuar resolvendo (cjs-module-lexer não enxerga spread).
 */

const devices = require("../devices.js");
const { safeSend } = require("../safeWebContents.js");
const transmissionRoutes = require("./transmissionRoutes.js");
const remoteRoutes = require("./remoteRoutes.js");


function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


function isSlideStateResponse(payload) {
  return (
    isPlainObject(payload) &&
    payload.status === "ok" &&
    typeof payload.supported === "boolean" &&
    typeof payload.playing === "boolean" &&
    Array.isArray(payload.slides) &&
    payload.slides.length <= 10_000 &&
    Number.isInteger(payload.currentSlideIndex) &&
    payload.currentSlideIndex >= 0 &&
    typeof payload.title === "string"
  );
}


function isAnnouncementsResponse(payload) {
  return (
    isPlainObject(payload) &&
    payload.status === "ok" &&
    Array.isArray(payload.announcements) &&
    payload.announcements.length <= 10_000 &&
    payload.announcements.every(
      (item) =>
        isPlainObject(item) &&
        typeof item.id === "string" &&
        item.id.length <= 256 &&
        (item.nome == null || typeof item.nome === "string") &&
        (item.ordem == null || Number.isFinite(item.ordem)) &&
        typeof item.hasImage === "boolean" &&
        typeof item.hasVideo === "boolean"
    )
  );
}


function isLibrasBundleResponse(payload) {
  if (payload === null) return true;
  if (!isPlainObject(payload)) return false;
  return payload.data instanceof ArrayBuffer || ArrayBuffer.isView(payload.data);
}


/**
 * Acervo pessoal vindo do renderer (`http:custom-music`).
 *
 * Só os campos que o controle remoto consome; `custom_song_id` é o UUID que a
 * execução usa (o `id_music` é um negativo sintético, só para listas).
 */
function isCustomSongsSearchResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.songs)) {
    return false;
  }
  if (payload.songs.length > 5_000) return false;
  return payload.songs.every(
    (song) =>
      isPlainObject(song) &&
      Number.isInteger(song.id_music) &&
      typeof song.name === "string" &&
      song.name.length <= 500 &&
      typeof song.albums_names === "string" &&
      song.albums_names.length <= 1_000 &&
      (song.custom_song_id === null ||
        song.custom_song_id === undefined ||
        typeof song.custom_song_id === "string") &&
      Number.isInteger(song.has_instrumental_music) &&
      Number.isInteger(song.has_audio)
  );
}


/**
 * Miniatura de um item: URL (catálogo público ou caminho servido por
 * `/api/online-videos/image`) ou `null`. Teto de 4 KB — é caminho, não bytes.
 */
const ONLINE_VIDEOS_MAX_ITEMS = 10_000;

function isImageField(value) {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.length <= 4_096;
}


/**
 * Um vídeo dos dois acervos, no formato que o cliente consome.
 * `source` distingue o catálogo remoto (`online`) dos Meus Vídeos (`custom`) e
 * `channel` é o canal dono do vídeo (terceira linha do card; `null` em Meus
 * Vídeos, que não têm canal).
 */
function isOnlineVideoItem(item) {
  return (
    isPlainObject(item) &&
    typeof item.id === "string" &&
    item.id.length <= 256 &&
    typeof item.title === "string" &&
    item.title.length <= 1_000 &&
    typeof item.url === "string" &&
    item.url.length <= 2_048 &&
    (item.source === "online" || item.source === "custom") &&
    isImageField(item.image) &&
    (item.channel === null ||
      item.channel === undefined ||
      (typeof item.channel === "string" && item.channel.length <= 1_000))
  );
}


function isOnlineVideosAlbumsResponse(payload) {
  return (
    isPlainObject(payload) &&
    payload.status === "ok" &&
    Array.isArray(payload.albums) &&
    payload.albums.length <= ONLINE_VIDEOS_MAX_ITEMS &&
    payload.albums.every(
      (album) =>
        isPlainObject(album) &&
        typeof album.id === "string" &&
        album.id.length <= 256 &&
        (album.title == null || (typeof album.title === "string" && album.title.length <= 1_000)) &&
        (album.subtitle == null ||
          (typeof album.subtitle === "string" && album.subtitle.length <= 1_000)) &&
        Number.isInteger(album.count) &&
        album.count >= 0 &&
        (album.source === "online" || album.source === "custom") &&
        isImageField(album.image)
    )
  );
}


function isOnlineVideosVideosResponse(payload) {
  return (
    isPlainObject(payload) &&
    payload.status === "ok" &&
    Array.isArray(payload.videos) &&
    payload.videos.length <= ONLINE_VIDEOS_MAX_ITEMS &&
    payload.videos.every(isOnlineVideoItem)
  );
}


/**
 * Binário da miniatura vindo do renderer (`?action=image`): `data` é o blob do
 * IndexedDB ou `null` quando não existe (a rota responde 404).
 */
function isOnlineVideoImageResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok") return false;
  if (payload.data === null) return true;
  if (!(payload.data instanceof ArrayBuffer) && !ArrayBuffer.isView(payload.data)) return false;
  return typeof payload.mime === "string" && /^image\/[a-z0-9.+-]+$/i.test(payload.mime);
}


/**
 * Permission de um device para um endpoint — mesmo molde do chat.
 *
 * Sem `authInfo` o acesso já veio garantido pelo middleware (token global ou
 * localhost), então segue liberado.
 */
function hasDevicePermission(req, permission) {
  const permissions = (req.authInfo && req.authInfo.permissions) || null;
  if (!permissions) return true;
  return permissions.includes("root") || permissions.includes(permission);
}


/** Vídeos Online exigem a permission `online_videos` (ou `root`). */
function hasOnlineVideosPermission(req) {
  return hasDevicePermission(req, "online_videos");
}

/** Biblioteca de Mídia exige a permission `media_library` (ou `root`). */
function hasMediaLibraryPermission(req) {
  return hasDevicePermission(req, "media_library");
}


/**
 * Estado da biblioteca de som de fundo (só metadados — os bytes ficam no
 * renderer e nunca saem por aqui).
 */
function isBackgroundSoundStateResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok") return false;
  if (typeof payload.playing !== "boolean") return false;
  if (!Number.isInteger(payload.volume) || payload.volume < 0 || payload.volume > 100) return false;
  if (payload.currentId !== null && payload.currentId !== undefined && typeof payload.currentId !== "string") {
    return false;
  }
  if (!Array.isArray(payload.files) || payload.files.length > 5_000) return false;
  if (!Array.isArray(payload.categories) || payload.categories.length > 2_000) return false;
  const filesOk = payload.files.every(
    (file) =>
      isPlainObject(file) &&
      typeof file.id === "string" &&
      file.id.length <= 256 &&
      typeof file.name === "string" &&
      file.name.length <= 500 &&
      (file.fileName === null || file.fileName === undefined || typeof file.fileName === "string") &&
      (file.categoryId === null || file.categoryId === undefined || typeof file.categoryId === "string")
  );
  const categoriesOk = payload.categories.every(
    (category) =>
      isPlainObject(category) &&
      typeof category.id === "string" &&
      category.id.length <= 256 &&
      typeof category.name === "string" &&
      category.name.length <= 200 &&
      (category.color === null || category.color === undefined || typeof category.color === "string")
  );
  return filesOk && categoriesOk;
}


/** Volume aplicado: valor resultante inteiro em 0..100. */
function isVolumeResponse(payload) {
  return (
    isPlainObject(payload) &&
    payload.status === "ok" &&
    Number.isInteger(payload.value) &&
    payload.value >= 0 &&
    payload.value <= 100
  );
}


/**
 * Biblioteca de Mídia — um item do acervo do operador (`http:media-library`).
 *
 * Só metadados: os bytes nunca cruzam o main→cliente por aqui (miniatura vai
 * por `?action=image`). `thumb` é caminho servido por `/api/media-library/image`
 * (ou `null`); `type` é livre (extensão manda no desktop) e `addedAt` é epoch ms.
 */
function isMediaLibraryItem(item) {
  return (
    isPlainObject(item) &&
    typeof item.id === "string" &&
    item.id.length <= 256 &&
    typeof item.name === "string" &&
    item.name.length <= 500 &&
    typeof item.type === "string" &&
    item.type.length <= 32 &&
    isImageField(item.thumb) &&
    (item.categoryId === null || item.categoryId === undefined || typeof item.categoryId === "string") &&
    (item.addedAt === null || item.addedAt === undefined || Number.isFinite(item.addedAt))
  );
}


/** Itens + categorias da biblioteca de mídia (renderer → IndexedDB). */
function isMediaLibraryItemsResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.items)) {
    return false;
  }
  if (payload.items.length > 5_000) return false;
  if (!Array.isArray(payload.categories) || payload.categories.length > 2_000) return false;
  return (
    payload.items.every(isMediaLibraryItem) &&
    payload.categories.every(
      (category) =>
        isPlainObject(category) &&
        typeof category.id === "string" &&
        category.id.length <= 256 &&
        typeof category.name === "string" &&
        category.name.length <= 200 &&
        (category.color === null || category.color === undefined || typeof category.color === "string")
    )
  );
}


/**
 * Um item do Canva no formato remoto (`http:media-library`).
 * `type` ∈ folder|design|image; designs não têm `url` estável (só `thumb`),
 * images têm `url` de thumbnail — projeção de design passa pelo export PDF.
 */
function isMediaLibraryCanvaItem(item) {
  if (!isPlainObject(item)) return false;
  if (item.type !== "folder" && item.type !== "design" && item.type !== "image") return false;
  if (typeof item.id !== "string" || item.id.length > 256) return false;
  if (typeof item.name !== "string" || item.name.length > 1_000) return false;
  if (!isImageField(item.thumb)) return false;
  if (item.url !== null && item.url !== undefined && (typeof item.url !== "string" || item.url.length > 4_096)) {
    return false;
  }
  if (
    item.pageCount !== null &&
    item.pageCount !== undefined &&
    (!Number.isInteger(item.pageCount) || item.pageCount < 0)
  ) {
    return false;
  }
  return (
    item.updatedAt === null ||
    item.updatedAt === undefined ||
    (Number.isFinite(item.updatedAt) && item.updatedAt >= 0)
  );
}


/**
 * Página de itens do Canva + PDFs já exportados (cache do desktop).
 *
 * Aceita também o envelope de erro do renderer (`{status:"error", error}`) —
 * sem isso a mensagem real ("Canva desconectado") chegava ao cliente como
 * 502 genérico de payload inválido.
 */
function isMediaLibraryCanvaResponse(payload) {
  if (!isPlainObject(payload)) return false;
  if (payload.status === "error" && typeof payload.error === "string") return true;
  if (payload.status !== "ok" || !Array.isArray(payload.items)) {
    return false;
  }
  if (payload.items.length > 2_000) return false;
  if (payload.continuation !== null && payload.continuation !== undefined && typeof payload.continuation !== "string") {
    return false;
  }
  const cached = payload.cached;
  if (cached !== null && cached !== undefined) {
    if (!isPlainObject(cached)) return false;
    const keys = Object.keys(cached);
    if (keys.length > 2_000) return false;
    if (!keys.every((key) => key.length <= 256 && Number.isFinite(cached[key]))) return false;
  }
  return payload.items.every(isMediaLibraryCanvaItem);
}


/**
 * Resposta do `canva-export`: o arquivo saiu (ou já estava) no cache.
 * Aceita também o envelope de erro do renderer com o motivo real.
 */
function isMediaLibraryCanvaExportResponse(payload) {
  if (!isPlainObject(payload)) return false;
  if (payload.status === "error" && typeof payload.error === "string") return true;
  if (payload.status !== "ok") return false;
  return (
    typeof payload.cached === "boolean" &&
    (payload.title == null || typeof payload.title === "string") &&
    (payload.pageCount == null || Number.isInteger(payload.pageCount))
  );
}


/**
 * Resposta do `add-canva` na playlist: o item que entrou. Mesmo molde do
 * `isMediaLibraryItem` — o shell devolve `{id, name, type}` do arquivo.
 */
function isMediaLibraryPlaylistAddResponse(payload) {
  if (!isPlainObject(payload)) return false;
  if (payload.status === "error" && typeof payload.error === "string") return true;
  if (payload.status !== "ok") return false;
  return isMediaLibraryItem(payload.item);
}


/** Resposta de comando com feedback do renderer (project). */
function isMediaLibraryCommandResponse(payload) {
  return (
    isPlainObject(payload) &&
    (payload.status === "ok" || (payload.status === "error" && typeof payload.error === "string"))
  );
}


/**
 * Playlist de mídia do desktop (`modules.media_library.playlist` do userData).
 * Itens `{id, name, type}` — o que o controle remoto precisa para listar.
 */
function isMediaLibraryPlaylistResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.items)) {
    return false;
  }
  if (payload.items.length > 500) return false;
  return payload.items.every(
    (item) =>
      isPlainObject(item) &&
      typeof item.id === "string" &&
      item.id.length > 0 &&
      item.id.length <= 256 &&
      typeof item.name === "string" &&
      item.name.length <= 500 &&
      typeof item.type === "string" &&
      item.type.length <= 32
  );
}


/** Binário da miniatura vindo do renderer (`?action=image`). */
function isMediaLibraryImageResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok") return false;
  if (payload.data === null) return true;
  if (!(payload.data instanceof ArrayBuffer) && !ArrayBuffer.isView(payload.data)) return false;
  return typeof payload.mime === "string" && /^image\/[a-z0-9.+-]+$/i.test(payload.mime);
}


function isMusicLibraryAlbumsResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.albums)) {
    return false;
  }
  if (payload.albums.length > 2_000) return false;
  return payload.albums.every(
    (album) =>
      isPlainObject(album) &&
      typeof album.id === "string" &&
      album.id.length <= 256 &&
      typeof album.title === "string" &&
      album.title.length <= 1_000 &&
      (album.subtitle === null || (typeof album.subtitle === "string" && album.subtitle.length <= 300)) &&
      Number.isInteger(album.count) &&
      album.count >= 0 &&
      (album.source === "official" || album.source === "custom") &&
      (album.color === null || (typeof album.color === "string" && album.color.length <= 32)) &&
      isImageField(album.image)
  );
}


function isMusicLibrarySongsResponse(payload) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.songs)) {
    return false;
  }
  if (payload.songs.length > 5_000) return false;
  return payload.songs.every(
    (song) =>
      isPlainObject(song) &&
      Number.isInteger(song.id_music) &&
      typeof song.name === "string" &&
      song.name.length <= 500 &&
      typeof song.duration === "string" &&
      song.duration.length <= 16 &&
      Number.isInteger(song.has_instrumental_music) &&
      typeof song.albums_names === "string" &&
      Number.isInteger(song.has_audio) &&
      (song.custom_song_id === null || typeof song.custom_song_id === "string")
  );
}

function setupRoutes(
  app,
  { getMainWindow, getUserData, getDatabaseUrl, getApiToken, rendererRequests }
) {

  /** Retorna mainWindow apenas se existir e não estiver destruída. */
  function getValidMainWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win;
  }


  async function requestRenderer(mainWindow, res, eventType, payload, options) {
    const pending = rendererRequests.request(options.prefix, options);
    const cancelOnClose = () => {
      pending.cancel("CLIENT_CLOSED", "Cliente HTTP desconectou");
    };
    res.once("close", cancelOnClose);

    if (!safeSend(mainWindow, eventType, { ...payload, requestId: pending.requestId })) {
      pending.cancel("RENDERER_UNAVAILABLE", "Janela principal não está disponível");
    }

    try {
      return await pending.promise;
    } finally {
      res.off("close", cancelOnClose);
    }
  }


  function sendRendererError(res, error, timeoutMessage) {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    if (error?.code === "CLIENT_CLOSED") return;
    if (error?.code === "TIMEOUT") {
      res.status(504).json({ error: timeoutMessage });
      return;
    }
    if (error?.code === "INVALID_PAYLOAD") {
      res.status(502).json({ error: "Resposta inválida da janela principal" });
      return;
    }
    res.status(503).json({ error: "Janela principal indisponível" });
  }

  // ── Famílias de rota (arquivos separados; contrato via ctx) ──────────────
  transmissionRoutes.register(app, {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    getUserData,
    getDatabaseUrl,
    getApiToken,
    isSlideStateResponse,
    isAnnouncementsResponse,
    isLibrasBundleResponse,
    hasDevicePermission,
  });
  remoteRoutes.register(app, {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    getUserData,
    // Catálogo/hinários/álbuns: a rota baixa sob demanda o que ainda não está
    // no jsonCache (mesmo caminho do `louvorja://json_db`).
    getDatabaseUrl,
    getApiToken,
    isPlainObject,
    isCustomSongsSearchResponse,
    isOnlineVideosAlbumsResponse,
    isOnlineVideosVideosResponse,
    isOnlineVideoImageResponse,
    isBackgroundSoundStateResponse,
    isVolumeResponse,
    hasOnlineVideosPermission,
    hasMediaLibraryPermission,
    isMediaLibraryItemsResponse,
    isMediaLibraryCanvaResponse,
    isMediaLibraryCanvaExportResponse,
    isMediaLibraryPlaylistAddResponse,
    isMediaLibraryCommandResponse,
    isMediaLibraryImageResponse,
    hasDevicePermission,
  });


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
  resolveSongMode: transmissionRoutes.resolveSongMode,
  normalizeKeyName: remoteRoutes.normalizeKeyName,
  extractYoutubeVideoId: remoteRoutes.extractYoutubeVideoId,
  hasOnlineVideosPermission,
  hasMediaLibraryPermission,
  isOnlineVideosAlbumsResponse,
  isOnlineVideosVideosResponse,
  isOnlineVideoImageResponse,
  isCustomSongsSearchResponse,
  isMusicLibraryAlbumsResponse,
  isMusicLibrarySongsResponse,
  hasDevicePermission,
  isBackgroundSoundStateResponse,
  isVolumeResponse,
  isMediaLibraryItemsResponse,
  isMediaLibraryCanvaResponse,
  isMediaLibraryCanvaExportResponse,
  isMediaLibraryPlaylistAddResponse,
  isMediaLibraryCommandResponse,
  isMediaLibraryPlaylistResponse,
  isMediaLibraryImageResponse,
};
