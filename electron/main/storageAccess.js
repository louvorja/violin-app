"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const lockfile = require("proper-lockfile");
const leases = new Map();
const MARKER = ".louvorja-collection.json";

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
    realpath: false, lockfilePath: path.join(root, ".louvorja-metadata.lock"), stale: 120000,
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
      return current.isDirectory() && current.dev === expected.dev && current.ino === expected.ino
        && current.birthtimeMs === expected.birthtimeMs;
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
  const releaseLock = lockfile.lockSync(root, {
    realpath: true, lockfilePath: path.join(root, ".louvorja-writer.lock"),
    stale: 120000, update: 10000,
    fs: {
      ...fs,
      statSync(file, ...args) { assertOwnedLock(file); return fs.statSync(file, ...args); },
      utimesSync(file, ...args) { assertOwnedLock(file); return fs.utimesSync(file, ...args); },
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
function initialize(layout) {
  release();
  for (const kind of ["media", "videos"]) {
    const root = layout[kind + "Dir"];
    const state = { root, writable: false, shared: layout[kind + "Shared"] === true, release: null, reason: null };
    leases.set(kind, state);
    try {
      if (!fs.lstatSync(root).isDirectory()) throw new Error("A pasta não está disponível.");
      const marker = readMarker(root, kind);
      if (marker?.shared === true) state.shared = true;
      state.release = acquire(root);
      const updated = updateMarker(root, kind, state.shared);
      state.shared = updated.shared;
      state.writable = true;
    } catch (error) {
      state.release?.();
      state.release = null;
      state.writable = false;
      state.reason = error.code === "ELOCKED" ? "in-use" : "unavailable";
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
  if (!canWrite(kind)) throw new Error("Esta pasta está somente para leitura ou em uso por outra conta. Feche a outra instância ou escolha uma pasta com permissão de escrita.");
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
    try { s.release?.(); } catch { /* lock já encerrado no shutdown */ }
  }
  leases.clear();
}
module.exports = { acquire, initialize, canWrite, canMaintain, assertWritable, assertMaintain, status, release, readMarker, markShared };
