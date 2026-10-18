"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const paths = require("./paths.js");
const access = require("./storageAccess.js");
const { atomicJson, copyVerified, hash } = require("./storageLayout.js");
const { managedRelative } = require("./mediaFiles.js");
const roots = require("./storageRoots.js");
const { canonical, overlaps } = roots;
let changeError = null;
let configuring = false;
const PRIVATE_NAMES = [".electron", "storage", "library", "profile", "attachments", "canva", "storage-layout.json", "data-location.json"];
function normalized(p) { const s = path.resolve(p); return process.platform === "win32" ? s.toLowerCase() : s; }
function validateRoots(mediaDir, videosDir) {
  return roots.validateRoots(mediaDir, videosDir, { profileDir: paths.dataDir(), programDir: paths.programDir() });
}
function validateContents(root, kind) {
  if (!fs.existsSync(root)) return;
  if (!fs.lstatSync(root).isDirectory()) throw new Error("O destino não é uma pasta.");
  if (PRIVATE_NAMES.some((name) => fs.existsSync(path.join(root, name)))) {
    throw new Error("Esta pasta contém dados pessoais. Escolha uma pasta somente de acervo ou de vídeos.");
  }
  access.readMarker(root, kind);
  if (kind === "media" && ["musicas", "imagens", "capas", "database.db"].some((n) => fs.existsSync(path.join(root, n)))) {
    throw new Error("Use a opção de acervo do Classic para consultar esta pasta sem alterá-la.");
  }
}
function probe(root) {
  fs.ensureDirSync(root);
  const temp = path.join(root, `.lj-write-${crypto.randomUUID()}`);
  try { fs.writeFileSync(temp, "", { flag: "wx" }); }
  finally { fs.removeSync(temp); }
}
function files(root, kind) {
  const result = [];
  function walk(abs, rel) {
    if (!fs.existsSync(abs)) return;
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) throw new Error(`A cópia encontrou um link: ${abs}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name), rel ? `${rel}/${name}` : name);
    } else if (stat.isFile() && (kind === "media" ? managedRelative(rel) : /^[A-Za-z0-9_-]+\.(mp4|keep)$/.test(rel))) {
      result.push({ relative: rel, source: abs, size: stat.size });
    }
  }
  if (kind === "media") {
    for (const name of ["musics", "images", "covers"]) walk(path.join(root, name), name);
  } else if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      if (/^[A-Za-z0-9_-]+\.(mp4|keep)$/.test(name)) walk(path.join(root, name), name);
    }
  }
  return result;
}
function preflightCopy(source, target, kind) {
  if (!fs.existsSync(source)) throw new Error(`A pasta de origem está indisponível: ${source}`);
  const list = files(source, kind);
  let needed = 0;
  for (const entry of list) {
    const dest = path.join(target, entry.relative);
    // Cada ancestral precisa ser real: um link intermediário não pode escapar do destino.
    if (normalized(canonical(dest)) !== normalized(dest)) throw new Error(`O destino contém um link: ${dest}`);
    if (fs.existsSync(dest)) {
      if (!fs.lstatSync(dest).isFile() || hash(entry.source) !== hash(dest)) {
        throw new Error(`O destino já tem um arquivo diferente: ${entry.relative}. Nenhum arquivo foi substituído.`);
      }
    } else needed += entry.size;
  }
  const disk = fs.statfsSync(target);
  if (Number(disk.bavail) * Number(disk.bsize) < needed) throw new Error("Não há espaço livre suficiente para copiar os arquivos e preservar a origem.");
  return list;
}
function markShared(root, kind) {
  access.markShared(root, kind);
}

function assertStagingPath(staging, relative = "") {
  const names = relative ? relative.split("/") : [];
  if (names.some((name) => !name || name === "." || name === ".." || name.includes("\\"))) throw new Error("Caminho temporário de cópia inválido.");
  let current = staging;
  for (let index = -1; index < names.length; index++) {
    if (index >= 0) current = path.join(current, names[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`A pasta temporária contém um link: ${current}`);
    if (index < names.length - 1 && !stat.isDirectory()) throw new Error(`A pasta temporária contém um caminho inválido: ${current}`);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`A pasta temporária contém um arquivo inválido: ${current}`);
  }
}

function validateStagingTree(staging) {
  assertStagingPath(staging);
  function walk(dir, relative) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      assertStagingPath(staging, child);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
    }
  }
  walk(staging, "");
}

function prepareStaging(target, source, kind, id) {
  const staging = path.join(target, `.louvorja-migration-${id}`);
  const marker = path.join(staging, ".owner.json");
  const expected = { version: 1, id, source, target, kind };
  if (fs.existsSync(staging)) {
    assertStagingPath(staging, ".owner.json");
    let owner;
    try { owner = fs.readJsonSync(marker); }
    catch { throw new Error("A pasta temporária existente não pertence a esta cópia e foi preservada."); }
    if (Object.keys(expected).some((key) => owner?.[key] !== expected[key])) throw new Error("A pasta temporária existente pertence a outra cópia e foi preservada.");
    validateStagingTree(staging);
  } else {
    // lstat também identifica links quebrados que existsSync não enxerga.
    assertStagingPath(staging);
    fs.mkdirSync(staging, { mode: 0o700 });
    atomicJson(marker, expected);
  }
  return staging;
}

function copyCollection(source, target, kind, id) {
  if (!["media", "videos"].includes(kind) || typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id)) throw new Error("Identificação da cópia inválida.");
  source = canonical(source); target = canonical(target);
  if (canonical(source) === canonical(target)) return;
  if (overlaps(canonical(source), canonical(target))) throw new Error("A pasta de destino não pode conter a origem nem estar dentro dela.");
  const releases = [];
  try {
    // Apenas no boot: este processo ainda não abriu seus gravadores.
    releases.push(access.acquire(source));
    releases.push(access.acquire(target));
    const entries = preflightCopy(source, target, kind);
    const staging = prepareStaging(target, source, kind, id);
    for (const entry of entries) {
      const dest = path.join(target, entry.relative);
      if (normalized(canonical(dest)) !== normalized(dest)) throw new Error(`O destino contém um link: ${dest}`);
      if (fs.existsSync(dest)) {
        if (!fs.lstatSync(dest).isFile() || hash(dest) !== hash(entry.source)) throw new Error(`O destino mudou durante a cópia: ${entry.relative}`);
        continue;
      }
      const staged = path.join(staging, entry.relative);
      assertStagingPath(staging, entry.relative);
      // Uma cópia interrompida nunca é considerada concluída.
      if (fs.existsSync(staged)) {
        if (!fs.lstatSync(staged).isFile()) throw new Error(`O arquivo temporário é inválido: ${staged}`);
        if (hash(staged) !== hash(entry.source)) fs.unlinkSync(staged);
      }
      copyVerified(entry.source, staged);
      assertStagingPath(staging, entry.relative);
      fs.ensureDirSync(path.dirname(dest));
      if (normalized(canonical(dest)) !== normalized(dest)) throw new Error(`O destino contém um link: ${dest}`);
      if (fs.existsSync(dest)) throw new Error(`O destino mudou durante a cópia: ${entry.relative}`);
      fs.renameSync(staged, dest);
    }
    validateStagingTree(staging);
    fs.removeSync(staging);
  } finally { for (const release of releases.reverse()) release(); }
}
function locations() {
  const c = paths.storageLayout();
  return { profileDir: paths.dataDir(), mediaDir: c.mediaDir, videosDir: c.videosDir,
    setupCompleted: c.setupCompleted, restartRequired: !!c.pending,
    pending: c.pending ? { mediaDir: c.pending.mediaDir, videosDir: c.pending.videosDir } : null,
    access: access.status(), changeError };
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
      delete c.pending; paths.saveLayout(c); changeError = null;
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
    paths.saveLayout({ ...c, pending: { id: crypto.randomUUID(), mediaDir, videosDir,
      mediaAction: input.mediaAction, videosAction: input.videosAction } });
    changeError = null;
    return { ok: true, restartRequired: true };
  } finally { configuring = false; }
}
function applyPending() {
  const c = paths.storageLayout();
  const p = c.pending;
  if (!p) return;
  try {
    const [mediaDir, videosDir] = validateRoots(p.mediaDir, p.videosDir);
    for (const [kind, target] of [["media", mediaDir], ["videos", videosDir]]) {
      if (normalized(target) === normalized(canonical(c[kind + "Dir"]))) continue;
      validateContents(target, kind);
      if (!fs.existsSync(target)) throw new Error(`A pasta escolhida está indisponível: ${target}`);
      if (p[kind + "Action"] === "copy") copyCollection(c[kind + "Dir"], target, kind, p.id);
      const shared = p[kind + "Action"] === "reuse" || !normalized(target).startsWith(normalized(os.homedir()) + path.sep);
      c[kind + "Shared"] = shared;
      if (shared) markShared(target, kind);
    }
    paths.saveLayout({ ...c, mediaDir, videosDir, pending: undefined });
    changeError = null;
  } catch (error) {
    changeError = error.message;
    console.warn("[storage] Mudança pendente preservada:", error.message);
  }
}
function completeSetup() {
  paths.saveLayout({ ...paths.storageLayout(), setupCompleted: true });
}
module.exports = { locations, configure, completeSetup, applyPending, canonical, overlaps, validateRoots, validateContents, preflightCopy, copyCollection };
