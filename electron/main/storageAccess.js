"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const lockfile = require("proper-lockfile");
const leases = new Map();
const MARKER = ".louvorja-collection.json";
/** Mesmo prazo do proper-lockfile; o retry espera ele vencer para tentar de novo. */
const LOCK_STALE_MS = 120000;
const RETRY_COOLDOWN_MS = 5000;
const RETRY_DELAY_MS = LOCK_STALE_MS + 1500;

function readMarker(root, kind) {
  const file = path.join(root, MARKER);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!stat.isFile()) throw new Error("O registro do acervo não é um arquivo regular.");
  const marker = fs.readJsonSync(file);
  if (!marker || marker.version !== 1 || marker.kind !== kind || typeof marker.shared !== "boolean") {
    throw new Error("O registro do acervo é inválido ou pertence a outro tipo de armazenamento.");
  }
  return marker;
}

function updateMarker(root, kind, shared) {
  // A marca de compartilhamento pode ser solicitada por um leitor enquanto o
  // escritor inicializa. Um lock separado serializa a atualização monotônica.
  const releaseMetadata = lockfile.lockSync(path.join(fs.realpathSync(root), ".louvorja-metadata"), {
    // proper-lockfile indexa leases pelo primeiro argumento, não por lockfilePath.
    // O identificador de metadados não pode substituir o lease do escritor.
    realpath: false, lockfilePath: path.join(root, ".louvorja-metadata.lock"), stale: LOCK_STALE_MS,
  });
  const file = path.join(root, MARKER);
  const temporary = path.join(root, `.louvorja-marker-${crypto.randomUUID()}.tmp`);
  try {
    const current = readMarker(root, kind);
    const value = { version: 1, kind, shared: current?.shared === true || shared === true };
    fs.writeJsonSync(temporary, value, { spaces: 2, flag: "wx", mode: 0o644 });
    // umask 077 é apropriado ao perfil, mas não a este metadado público.
    fs.chmodSync(temporary, 0o644);
    fs.renameSync(temporary, file);
    return value;
  } finally {
    fs.removeSync(temporary);
    releaseMetadata();
  }
}

function markShared(root, kind) {
  if (readMarker(root, kind)?.shared === true) return;
  try { updateMarker(root, kind, true); }
  catch (error) {
    throw new Error("Não foi possível preparar o compartilhamento desta pasta. Peça ao proprietário para habilitar a gravação ou use um acervo já marcado como compartilhado.", { cause: error });
  }
}

/** Um escritor por raiz. Outras contas continuam podendo ler os arquivos prontos. */
function acquire(root) {
  const lockPath = path.join(root, ".louvorja-writer.lock");
  const rootIdentity = fs.lstatSync(root);
  if (!rootIdentity.isDirectory()) throw new Error("A pasta não está disponível.");
  let lockIdentity = null;
  function sameDirectory(file, expected) {
    try {
      const current = fs.lstatSync(file);
      // Uma pasta recriada nasce depois. No macOS, gravar um horário anterior ao
      // nascimento (o iCloud faz isso) recua a data de criação da mesma pasta.
      return current.isDirectory() && current.dev === expected.dev && current.ino === expected.ino
        && current.birthtimeMs <= expected.birthtimeMs;
    } catch { return false; }
  }
  const isValid = () => !!lockIdentity && sameDirectory(root, rootIdentity) && sameDirectory(lockPath, lockIdentity);
  const assertOwnedLock = (file) => {
    if (file === lockPath && lockIdentity && !isValid()) {
      // O cleanup interno também usa este FS. Não apagar um lease novo que
      // apareceu no mesmo caminho após desmontagem/substituição da raiz.
      throw Object.assign(new Error("A pasta ou a proteção de escrita não está mais disponível."), { code: "ENOENT" });
    }
  };
  // iCloud Drive (Documentos sincronizados) reescreve o horário das pastas que
  // acompanha, e o proper-lockfile tomaria isso por outro dono: o app fechava
  // 10 s depois de abrir e deixava a trava para trás. A posse já é conferida
  // pela identidade da pasta; para ele, vale o horário que nós gravamos.
  let writtenMtime = null;
  const releaseLock = lockfile.lockSync(root, {
    realpath: true, lockfilePath: path.join(root, ".louvorja-writer.lock"),
    stale: LOCK_STALE_MS, update: 10000,
    fs: {
      ...fs,
      statSync(file, ...args) {
        assertOwnedLock(file);
        const stat = fs.statSync(file, ...args);
        if (file === lockPath && writtenMtime && (!lockIdentity || isValid())) {
          Object.defineProperty(stat, "mtime", { value: new Date(writtenMtime), configurable: true, enumerable: true });
        }
        return stat;
      },
      utimesSync(file, atime, mtime, ...args) {
        assertOwnedLock(file);
        fs.utimesSync(file, atime, mtime, ...args);
        if (file === lockPath) writtenMtime = new Date(mtime).getTime();
      },
      rmdirSync(file, ...args) { assertOwnedLock(file); return fs.rmdirSync(file, ...args); },
    },
    onCompromised(error) {
      // Continuar após perder a exclusividade permitiria dois gravadores.
      console.error("[storage] A proteção de escrita foi perdida:", error.message);
      require("electron").app.exit(1);
    },
  });
  lockIdentity = fs.lstatSync(lockPath);
  const release = () => releaseLock();
  release.isValid = isValid;
  return release;
}
function clearRetryTimer(s) {
  if (!s?.retryTimer) return;
  clearTimeout(s.retryTimer);
  s.retryTimer = null;
}

/** Tenta de novo depois que o lease antigo vencer; um escritor vivo continua barrando. */
function scheduleRetry(kind, s) {
  if (s.retryTimer) return;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = null;
    retry(kind, { force: true });
  }, RETRY_DELAY_MS);
  s.retryTimer.unref?.();
}

/** Abre o lease e grava o metadado; o chamador libera em caso de erro. */
function openLease(kind, state) {
  if (!fs.lstatSync(state.root).isDirectory()) throw new Error("A pasta não está disponível.");
  const marker = readMarker(state.root, kind);
  if (marker?.shared === true) state.shared = true;
  state.release = acquire(state.root);
  const updated = updateMarker(state.root, kind, state.shared);
  state.shared = updated.shared;
  state.writable = true;
  state.reason = null;
}

/**
 * Readquire um lease que ficou para trás num restart rápido (ou numa permissão
 * que acabou de ser corrigida). `force` ignora o cooldown do retry automático.
 */
function retry(kind, { force = false } = {}) {
  const s = state(kind);
  if (!s) return false;
  if (s.writable) return true;

  const now = Date.now();
  if (!force && now - s.lastAttempt < RETRY_COOLDOWN_MS) return false;
  const previousReason = s.reason;
  s.lastAttempt = now;
  try { s.release?.(); } catch { /* lease antigo já caiu */ }
  s.release = null;
  s.writable = false;

  try {
    openLease(kind, s);
    clearRetryTimer(s);
    console.info(`[storage] escrita em ${kind} recuperada.`);
    return true;
  } catch (error) {
    try { s.release?.(); } catch { /* nada a liberar */ }
    s.release = null;
    s.writable = false;
    s.reason = error.code === "ELOCKED" ? "in-use" : "unavailable";
    if (s.reason !== previousReason) {
      console.warn(
        `[storage] ${kind} sem escrita (${s.reason}${error.code ? `, ${error.code}` : ""}):`,
        error.message
      );
    }
    // Um lease vivo continua barrando; tenta de novo quando ele puder vencer.
    if (s.reason === "in-use") scheduleRetry(kind, s);
    return false;
  }
}

function initialize(layout) {
  release();
  for (const kind of ["media", "videos"]) {
    const root = layout[kind + "Dir"];
    const state = {
      root,
      writable: false,
      shared: layout[kind + "Shared"] === true,
      release: null,
      reason: null,
      lastAttempt: 0,
      retryTimer: null,
    };
    leases.set(kind, state);
    try {
      openLease(kind, state);
    } catch (error) {
      try { state.release?.(); } catch { /* nada a liberar */ }
      state.release = null;
      state.writable = false;
      state.reason = error.code === "ELOCKED" ? "in-use" : "unavailable";
      console.warn(
        `[storage] ${kind} sem escrita (${state.reason}${error.code ? `, ${error.code}` : ""}):`,
        error.message
      );
      if (state.reason === "in-use") scheduleRetry(kind, state);
    }
  }
}
function state(kind) { return leases.get(kind); }
function canWrite(kind) {
  const s = state(kind);
  if (!s?.writable) return false;
  if (s.release?.isValid()) return true;
  s.writable = false;
  s.reason = "unavailable";
  try { s.release?.(); } catch { /* A raiz/lease pode ter desaparecido. */ }
  s.release = null;
  return false;
}
function canMaintain(kind) {
  const s = state(kind);
  if (!canWrite(kind) || s.shared) return false;
  // Outra conta pode ter optado por reutilizar esta coleção desde o boot.
  try { return readMarker(s.root, kind)?.shared === false; }
  catch { return false; }
}
function assertWritable(kind) {
  if (!canWrite(kind) && !retry(kind)) {
    throw new Error("Esta pasta está somente para leitura ou em uso por outra conta. Feche a outra instância ou escolha uma pasta com permissão de escrita.");
  }
}
function assertMaintain(kind) {
  assertWritable(kind);
  if (!canMaintain(kind)) throw new Error("A limpeza deste acervo compartilhado está desativada para preservar os arquivos usados por outras contas.");
}
function status() {
  for (const [kind, s] of leases) {
    canWrite(kind);
    try { if (readMarker(s.root, kind)?.shared === true) s.shared = true; }
    catch { /* O status de escrita continua conservador; manutenção valida novamente. */ }
  }
  return Object.fromEntries([...leases].map(([kind, s]) => [kind, { writable: s.writable, shared: s.shared, reason: s.reason }]));
}
function release() {
  for (const s of leases.values()) {
    clearRetryTimer(s);
    try { s.release?.(); } catch { /* lock já encerrado no shutdown */ }
  }
  leases.clear();
}
module.exports = {
  acquire,
  initialize,
  retry,
  canWrite,
  canMaintain,
  assertWritable,
  assertMaintain,
  status,
  release,
  readMarker,
  markShared,
};
