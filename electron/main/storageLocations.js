"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const paths = require("./paths.js");
const access = require("./storageAccess.js");
const roots = require("./storageRoots.js");
const { canonical, overlaps } = roots;
let changeError = null;
let configuring = false;
const { validateContents, probe, preflightCopy, copyCollection, applyPendingLayout } = require("./storageCollectionMigration.js");
function normalized(p) { const s = path.resolve(p); return process.platform === "win32" ? s.toLowerCase() : s; }
function validateRoots(mediaDir, videosDir) {
  return roots.validateRoots(mediaDir, videosDir, { profileDir: paths.dataDir(), programDir: paths.programDir() });
}
function locations() {
  const c = paths.storageLayout();
  return { profileDir: paths.dataDir(), mediaDir: c.mediaDir, videosDir: c.videosDir,
    setupCompleted: c.setupCompleted, restartRequired: !!c.pending,
    pending: c.pending ? { mediaDir: c.pending.mediaDir, videosDir: c.pending.videosDir } : null,
    access: access.status(), changeError: c.pendingError || changeError };
}
async function configure(input) {
  if (configuring) throw new Error("Uma mudança de pastas já está sendo preparada.");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !["reuse", "copy"].includes(input.mediaAction) || !["reuse", "copy"].includes(input.videosAction)) {
    throw new Error("Opções de armazenamento inválidas.");
  }
  configuring = true;
  try {
    const c = paths.storageLayout();
    // Cancelar agendamento deve funcionar mesmo quando um disco foi desconectado.
    if (input.mediaDir === c.mediaDir && input.videosDir === c.videosDir) {
      delete c.pending; delete c.pendingError; paths.saveLayout(c); changeError = null;
      return { ok: true, restartRequired: false };
    }
    const [mediaDir, videosDir] = validateRoots(input.mediaDir, input.videosDir);
    for (const [kind, target] of [["media", mediaDir], ["videos", videosDir]]) {
      if (normalized(target) === normalized(canonical(c[kind + "Dir"]))) continue;
      validateContents(target, kind);
      // Reutilização permite leitura sem escrita; uma pasta nova exige criação.
      if (input[kind + "Action"] === "copy" || !fs.existsSync(target)) probe(target);
      else fs.accessSync(target, fs.constants.R_OK);
      if (overlaps(canonical(c[kind + "Dir"]), target)) throw new Error("A nova pasta não pode conter a atual nem estar dentro dela.");
    }
    paths.saveLayout({ ...c, pendingError: undefined, pending: { id: crypto.randomUUID(), mediaDir, videosDir,
      mediaAction: input.mediaAction, videosAction: input.videosAction } });
    changeError = null;
    return { ok: true, restartRequired: true };
  } finally { configuring = false; }
}
function applyPending() {
  const c = paths.storageLayout();
  const next = applyPendingLayout(c, { profileDir: paths.dataDir(), programDir: paths.programDir(), workDir: path.join(paths.dataDir(), "temp", "migrations") });
  if (next !== c) paths.saveLayout(next);
  changeError = next.pendingError || null;
}
function completeSetup() {
  paths.saveLayout({ ...paths.storageLayout(), setupCompleted: true });
}
module.exports = { locations, configure, completeSetup, applyPending, canonical, overlaps, validateRoots, validateContents, preflightCopy, copyCollection };
