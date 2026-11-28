"use strict";

const { isVideoId } = require("./ids.js");
const { OnlineVideoError, runJson, withSystemCerts, SYSTEM_CERTS_ARGS } = require("./runner.js");

/**
 * Lista os vídeos de um canal ou de uma playlist do YouTube, sem baixar nada
 * (`--flat-playlist`). Como nas outras operações, o renderer entrega só o
 * identificador — o ID do canal (UC…), o @ dele ou o ID da playlist — e a URL
 * é montada aqui. O canal vem do mais recente ao mais antigo, que é a ordem da
 * aba Vídeos do YouTube; a playlist vem na ordem dela.
 */

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^@[\p{L}\p{N}._-]{3,100}$/u;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;
const MAX_PAGE = 50;
/** Sem isto o YouTube responde com os títulos traduzidos para o inglês. */
const LANGS = new Set(["pt", "es", "en"]);
/** Listar um canal grande pede várias páginas ao YouTube; 60 s ainda é conexão viva. */
const LIST_TIMEOUT_MS = 60_000;
const LIST_MAX_OUTPUT = 16 * 1024 * 1024;
const THUMB_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:ytimg\.com|ggpht\.com|googleusercontent\.com)$/i;

function isChannelRef(value) {
  return typeof value === "string" && (CHANNEL_ID_RE.test(value) || HANDLE_RE.test(value));
}

function isPlaylistId(value) {
  return typeof value === "string" && PLAYLIST_ID_RE.test(value);
}

/** null quando a fonte não é um canal nem uma playlist válidos. */
function collectionUrl(source) {
  if (!source || typeof source !== "object") return null;
  if (source.kind === "channel" && isChannelRef(source.id)) {
    const base = source.id.startsWith("@")
      ? `https://www.youtube.com/${encodeURIComponent(source.id).replace(/^%40/, "@")}`
      : `https://www.youtube.com/channel/${source.id}`;
    return `${base}/videos`;
  }
  if (source.kind === "playlist" && isPlaylistId(source.id)) {
    return `https://www.youtube.com/playlist?list=${source.id}`;
  }
  return null;
}

function page(opts) {
  const start = Number.isSafeInteger(opts?.start) && opts.start >= 1 ? opts.start : 1;
  const count = Number.isSafeInteger(opts?.count) ? Math.min(Math.max(opts.count, 1), MAX_PAGE) : 30;
  const lang = LANGS.has(opts?.lang) ? opts.lang : "pt";
  return { start, count, lang };
}

function buildListArgs({ url, start, count, lang = "pt", cacheDir, cookiesFile, jsRuntime, systemCerts }) {
  const args = [
    "--ignore-config",
    "--flat-playlist",
    "--no-colors",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "--playlist-items",
    `${start}:${start + count - 1}`,
    "--extractor-args",
    `youtube:lang=${LANGS.has(lang) ? lang : "pt"}`,
    "-J",
  ];
  if (cacheDir) args.push("--cache-dir", cacheDir);
  if (cookiesFile) args.push("--cookies", cookiesFile);
  if (jsRuntime) args.push("--js-runtimes", jsRuntime);
  if (systemCerts) args.push(...SYSTEM_CERTS_ARGS);
  args.push(url);
  return args;
}

function safeThumb(raw) {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && THUMB_HOST_RE.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/** O avatar do canal: a miniatura quadrada maior; a playlist usa a capa do primeiro vídeo. */
function avatarOf(info) {
  const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const square = thumbs
    .filter((t) => t && safeThumb(t.url) && (t.id === "avatar_uncropped" || (t.width && t.width === t.height)))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const url = safeThumb(square[0]?.url);
  // O avatar aparece em 16–22 px: pedir 88 px ao servidor de imagens do Google basta.
  return url ? url.replace(/=s\d+(?=-|$)/, "=s88") : null;
}

function text(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Do JSON do yt-dlp para o que a aba precisa. `count` é o tamanho da página
 * pedida: veio cheia, provavelmente há mais.
 */
function parseCollection(info, kind, count) {
  if (!info || typeof info !== "object") throw new OnlineVideoError("format", "Resposta do yt-dlp inválida");
  const raw = Array.isArray(info.entries) ? info.entries : [];
  const entries = raw
    .filter((e) => e && isVideoId(e.id))
    .map((e) => ({
      id: e.id,
      title: text(e.title) || e.id,
      duration: Number.isFinite(e.duration) && e.duration > 0 ? Math.round(e.duration) : null,
    }));
  const channel = text(info.channel) || text(info.uploader);
  const title = kind === "channel" ? channel || text(info.title).replace(/ - (?:Videos|Vídeos)$/i, "") : text(info.title);
  return {
    title,
    channel,
    thumbnail: kind === "channel" ? avatarOf(info) : null,
    entries,
    hasMore: raw.length >= count,
  };
}

/**
 * @param {object} opts
 * @param {{ ytdlp: string }} opts.tools
 * @param {{ kind: "channel"|"playlist", id: string }} opts.source
 * @param {{ start?: number, count?: number, lang?: string }} [opts.range]
 */
async function listCollection(opts) {
  const url = collectionUrl(opts.source);
  if (!url) throw new OnlineVideoError("invalid", "Canal ou playlist inválidos");
  const { start, count, lang } = page(opts.range);
  const info = await withSystemCerts(
    (o) =>
      runJson({
        ...o,
        args: buildListArgs({ ...o, url, start, count, lang }),
        timeoutMs: o.timeoutMs ?? LIST_TIMEOUT_MS,
        maxOutput: LIST_MAX_OUTPUT,
      }),
    opts
  );
  return parseCollection(info, opts.source.kind, count);
}

module.exports = {
  isChannelRef,
  isPlaylistId,
  collectionUrl,
  buildListArgs,
  parseCollection,
  listCollection,
  MAX_PAGE,
};
