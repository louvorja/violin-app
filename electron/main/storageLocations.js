"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const paths = require("./paths.js");
const access = require("./storageAccess.js");
const collectionAccounts = require("./collectionAccounts.js");
const roots = require("./storageRoots.js");
const { canonical, overlaps } = roots;
let changeError = null;
let configuring = false;
const { validateContents, probe, preflightCopy, copyCollection, applyPendingLayout, finishPendingMoves } = require("./storageCollectionMigration.js");
const { defaultLocations } = require("./storageLayout.js");
function normalized(p) { const s = path.resolve(p); return process.platform === "win32" ? s.toLowerCase() : s; }
function validateRoots(mediaDir, videosDir) {
  return roots.validateRoots(mediaDir, videosDir, { profileDir: paths.dataDir(), programDir: paths.programDir() });
}
const ACTIONS = ["reuse", "copy", "move"];
/** As pastas que uma instalação nova usaria nesta máquina; null se o sistema não as informa. */
function defaults() {
  try {
    const d = defaultLocations(paths.migrationOptions());
    return { mediaDir: d.mediaDir, videosDir: d.videosDir };
  } catch { return null; }
}
/** Na primeira sessão o acervo nasce depois do boot: assina na hora em que a tela pergunta. */
function mediaAccounts(dir) {
  const result = collectionAccounts.usage(dir);
  if (result.known) return result;
  try {
    collectionAccounts.sign(dir, { shared: true });
  } catch {
    return result;
  }
  return collectionAccounts.usage(dir);
}
function locations() {
  const c = paths.storageLayout();
  const status = access.status();
  return { profileDir: paths.dataDir(), mediaDir: c.mediaDir, videosDir: c.videosDir,
    // Quem perderia as músicas ao apagar: só faz diferença em pasta compartilhada.
    mediaAccounts: status.media?.shared ? mediaAccounts(c.mediaDir) : null,
    setupCompleted: c.setupCompleted, restartRequired: !!c.pending,
    pending: c.pending ? { mediaDir: c.pending.mediaDir, videosDir: c.pending.videosDir,
      moving: c.pending.mediaAction === "move" || c.pending.videosAction === "move" } : null,
    access: status, changeError: c.pendingError || changeError,
    defaults: defaults(),
    // Mover apaga a pasta atual depois da cópia: só quando esta conta é a dona dela.
    canMove: { media: access.canMaintain("media"), videos: access.canMaintain("videos") } };
}
async function configure(input) {
  if (configuring) throw new Error("Uma mudança de pastas já está sendo preparada.");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !ACTIONS.includes(input.mediaAction) || !ACTIONS.includes(input.videosAction)) {
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
      if (input[kind + "Action"] === "move" && !access.canMaintain(kind)) {
        throw new Error("A pasta atual é compartilhada com outras contas ou está só para leitura: use Copiar.");
      }
      // Reutilização permite leitura sem escrita; uma pasta nova exige criação.
      if (input[kind + "Action"] !== "reuse" || !fs.existsSync(target)) probe(target);
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
  if (next !== c) {
    paths.saveLayout(next);
    finishPendingMoves(c, next);
  }
  changeError = next.pendingError || null;
}
function completeSetup() {
  paths.saveLayout({ ...paths.storageLayout(), setupCompleted: true });
}
module.exports = { locations, configure, completeSetup, applyPending, canonical, overlaps, validateRoots, validateContents, preflightCopy, copyCollection };
