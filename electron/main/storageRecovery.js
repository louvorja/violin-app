"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { atomicJson, readJsonLenient, setAside } = require("./storageLayout.js");

// `<appData>/LouvorJA Violin/recovery.json`: quantas aberturas seguidas não
// conseguiram preparar os dados, por quê, e o que o operador pediu para fazer.
const FILE = "recovery.json";
const REQUESTS = new Set(["reset", "reimport"]);
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

/** Registra o pedido; ele é aplicado no começo da próxima abertura. */
function request(bootstrap, action) {
  if (!REQUESTS.has(action)) throw new Error(`Pedido de recuperação desconhecido: ${action}`);
  write(bootstrap, { ...read(bootstrap), request: action });
}

/**
 * Antes de ler qualquer registro. Os dois pedidos guardam o perfil desta versão
 * em `recovery/`: "reimport" copia de novo a pasta antiga; "reset" começa do
 * zero. Repetível: uma queda no meio refaz só o que faltou.
 */
function applyRequest(bootstrap) {
  const state = read(bootstrap);
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
