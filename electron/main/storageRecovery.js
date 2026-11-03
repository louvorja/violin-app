"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { atomicJson, readJsonLenient, setAside, absolute, PRIVATE_ENTRIES, REBUILDABLE_CHROMIUM } = require("./storageLayout.js");
const { managedRelative } = require("./mediaFiles.js");

// `<appData>/LouvorJA Violin/recovery.json`: quantas aberturas seguidas não
// conseguiram preparar os dados, por quê, e o que o operador pediu para fazer.
const FILE = "recovery.json";
const REQUESTS = new Set(["reset", "reimport", "repair", "wipe"]);
const COLLECTION_MARKER = ".louvorja-collection.json";
/** Os mesmos nomes que o cache de vídeos considera seus (ID do YouTube): nada além disso sai da pasta. */
const VIDEO_FILE = /^[A-Za-z0-9_-]{11}\.(mp4|keep)$/;
const MEDIA_FOLDERS = ["musics", "images", "covers"];
/** A partir daqui o aviso oferece começar do zero. */
const RESET_AFTER = 2;

function read(bootstrap) {
  const value = readJsonLenient(path.join(bootstrap, FILE));
  return value?.version === 1 ? value : { version: 1 };
}

function write(bootstrap, value) {
  atomicJson(path.join(bootstrap, FILE), value);
}

function recordFailure(bootstrap, error) {
  const state = read(bootstrap);
  state.failures = (state.failures || 0) + 1;
  state.lastError = { code: error?.code || null, message: String(error?.message || error) };
  state.lastAt = new Date().toISOString();
  write(bootstrap, state);
  return state.failures;
}

function recordSuccess(bootstrap) {
  const state = read(bootstrap);
  if (!state.failures && !state.freshStart && !state.lastError) return;
  write(bootstrap, { version: 1 });
}

function failures(bootstrap) {
  return read(bootstrap).failures || 0;
}

/**
 * Registra o pedido; ele é aplicado no começo da próxima abertura. `wipe` aceita
 * também apagar o acervo (`media`) e os vídeos baixados (`videos`).
 */
function request(bootstrap, action, options = {}) {
  if (!REQUESTS.has(action)) throw new Error(`Pedido de recuperação desconhecido: ${action}`);
  const next = { ...read(bootstrap), request: action };
  delete next.wipe;
  if (action === "wipe") next.wipe = { media: options?.media === true, videos: options?.videos === true };
  write(bootstrap, next);
}

function removeQuietly(file) {
  try {
    fs.removeSync(file);
  } catch (error) {
    console.warn(`[storage] não foi possível apagar ${file}:`, error.message);
  }
}

/** Caches que o Chromium refaz sozinho, as ferramentas de vídeo e o que elas guardam. */
function repairProfile(bootstrap) {
  const profile = path.join(bootstrap, "profile");
  const chromium = path.join(profile, ".electron");
  for (const name of REBUILDABLE_CHROMIUM) {
    if (/cache/i.test(name)) removeQuietly(path.join(chromium, name));
  }
  removeQuietly(path.join(profile, "bin"));
  removeQuietly(path.join(profile, "temp", "videos", ".ytdlp-cache"));
  removeQuietly(path.join(profile, "temp", "videos", ".stream"));
}

function sharedCollection(root) {
  return readJsonLenient(path.join(root, COLLECTION_MARKER))?.shared === true;
}

function pruneEmpty(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt + path.sep) || current === stopAt) {
    try {
      const rest = fs.readdirSync(current).filter((name) => name !== ".DS_Store" && name !== COLLECTION_MARKER);
      if (rest.length) return;
      fs.removeSync(current);
    } catch {
      return;
    }
    if (current === stopAt) return;
    current = path.dirname(current);
  }
}

function wipeManagedMedia(root, relative) {
  const dir = path.join(root, relative);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) wipeManagedMedia(root, child);
    else if (entry.isFile() && managedRelative(child)) removeQuietly(path.join(root, child));
  }
  pruneEmpty(dir, dir);
}

/**
 * Apaga só os arquivos que o app gerencia — os mesmos critérios de "Limpar
 * arquivos" e do cache de vídeos —, nunca a pasta inteira: ela pode ter outras
 * coisas. Coleção compartilhada com outras contas não é tocada.
 */
function wipeCollection(root, kind, shared) {
  if (!absolute(root) || !fs.existsSync(root)) return;
  if (shared || sharedCollection(root)) {
    console.warn(`[storage] ${root} é compartilhada com outras contas e foi preservada.`);
    return;
  }
  if (kind === "videos") {
    for (const name of fs.readdirSync(root)) {
      if (VIDEO_FILE.test(name)) removeQuietly(path.join(root, name));
    }
  } else {
    for (const name of MEDIA_FOLDERS) wipeManagedMedia(root, name);
  }
  pruneEmpty(root, root);
}

/**
 * Reset total: nada vai para `recovery/`. Apaga o perfil, o registro de pastas,
 * as cópias de recuperação e a âncora, os restos do perfil antigo na pasta de
 * Documentos e, se pedido, o acervo e os vídeos.
 */
function wipeEverything(bootstrap, options) {
  const layout = readJsonLenient(path.join(bootstrap, "storage-layout.json")) || {};
  const legacyRoot = layout.legacyRoot || readJsonLenient(path.join(bootstrap, "data-location.json"))?.dataDir;
  if (options?.videos) wipeCollection(layout.videosDir, "videos", layout.videosShared === true);
  if (options?.media) wipeCollection(layout.mediaDir, "media", layout.mediaShared === true);
  // Versões antigas deixavam escolher a pasta de dados (até Documentos inteira):
  // só limpa o que sobrou do perfil antigo numa pasta que é claramente do app.
  if (absolute(legacyRoot) && /louvor/i.test(path.basename(legacyRoot)) && fs.existsSync(legacyRoot)) {
    for (const name of [".electron", ...PRIVATE_ENTRIES]) removeQuietly(path.join(legacyRoot, name));
    pruneEmpty(legacyRoot, legacyRoot);
  }
  for (const name of ["storage-layout.json", "profile", "profile.migrating", "fallback", "recovery", "data-location.json"]) {
    removeQuietly(path.join(bootstrap, name));
  }
}

/**
 * Antes de ler qualquer registro e antes de o Chromium abrir o perfil.
 * "reimport" e "reset" guardam o perfil desta versão em `recovery/` ("reimport"
 * copia de novo a pasta antiga; "reset" começa do zero); "wipe" começa do zero
 * sem guardar nada; "repair" só refaz caches e ferramentas. Repetível: uma
 * queda no meio refaz só o que faltou.
 */
function applyRequest(bootstrap) {
  const state = read(bootstrap);
  if (state.request === "repair") {
    repairProfile(bootstrap);
    write(bootstrap, { version: 1 });
    return { freshStart: false };
  }
  if (state.request === "wipe") {
    wipeEverything(bootstrap, state.wipe);
    write(bootstrap, { version: 1, freshStart: true });
    return { freshStart: true };
  }
  if (state.request) {
    const items = ["storage-layout.json", "profile", "profile.migrating", ...(state.request === "reset" ? ["fallback"] : [])];
    setAside(bootstrap, items.map((name) => path.join(bootstrap, name)), state.request === "reset" ? "comecar-do-zero" : "trazer-de-volta");
    const next = { version: 1 };
    // Até publicar o perfil vazio, uma nova queda continua sendo "do zero".
    if (state.request === "reset") next.freshStart = true;
    write(bootstrap, next);
    return { freshStart: next.freshStart === true };
  }
  return { freshStart: state.freshStart === true };
}

function clearFreshStart(bootstrap) {
  const state = read(bootstrap);
  if (!state.freshStart) return;
  delete state.freshStart;
  write(bootstrap, state);
}

/**
 * Uma versão anterior aberta depois da migração grava na pasta antiga, que a
 * nova não lê mais. A beta.14+ regrava a âncora a cada abertura: se ela mudou
 * depois da última vez que esta versão olhou, alguém usou a versão antiga.
 */
function olderVersionUsed({ bootstrap, profile, legacyRoot }) {
  if (!legacyRoot) return null;
  let mtimeMs;
  try { mtimeMs = fs.statSync(path.join(bootstrap, "data-location.json")).mtimeMs; }
  catch { return null; }
  const seenFile = path.join(profile, ".legacy-anchor-seen.json");
  const seen = readJsonLenient(seenFile);
  if (typeof seen?.mtimeMs !== "number") {
    atomicJson(seenFile, { version: 1, mtimeMs });
    return null;
  }
  // Folga para sistemas de arquivos que arredondam o horário.
  return mtimeMs > seen.mtimeMs + 2000 ? { since: new Date(mtimeMs).toISOString(), legacyRoot } : null;
}

function acknowledgeOlderVersion({ bootstrap, profile }) {
  try {
    const mtimeMs = fs.statSync(path.join(bootstrap, "data-location.json")).mtimeMs;
    atomicJson(path.join(profile, ".legacy-anchor-seen.json"), { version: 1, mtimeMs });
  } catch { /* sem âncora não há o que lembrar */ }
}

module.exports = {
  RESET_AFTER, recordFailure, recordSuccess, failures, request, applyRequest, clearFreshStart,
  olderVersionUsed, acknowledgeOlderVersion,
};
