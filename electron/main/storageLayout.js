"use strict";

// Executado depois do lock de instância e antes de abrir Chromium ou userStore.
// A origem nunca é apagada: a publicação só acontece após conferir a cópia.
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROFILE_ENTRIES } = require("./dataMigration.js");
const { rebaseJsonFiles } = require("./privatePathMigration.js");
const { absolute, validateRoots } = require("./storageRoots.js");
const { assertProfileIdle } = require("./profileActivity.js");

const PRIVATE_ENTRIES = ["storage", "library", "json_db", "bin", "server", "canva",
  "configweb.json", "runtime-incidents.json", "telemetry-main-errors.json"];
const PROFILE_LOCKS = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile", "LOCK", "DevToolsActivePort"]);

function readJson(file) {
  try { return fs.readJsonSync(file); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Não foi possível ler a configuração de armazenamento: ${file}`, { cause: error });
  }
}

function atomicJson(file, value) {
  fs.ensureDirSync(path.dirname(file));
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeJsonSync(tmp, value, { spaces: 2, mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { fs.removeSync(tmp); }
}

function validateLayout(raw, roots) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1 || !absolute(raw.mediaDir) || !absolute(raw.videosDir)
    || typeof raw.setupCompleted !== "boolean"
    || ["mediaShared", "videosShared"].some((key) => raw[key] !== undefined && typeof raw[key] !== "boolean")
    || (raw.legacyRoot !== undefined && !absolute(raw.legacyRoot))) {
    throw new Error("A configuração de armazenamento é inválida. Os dados existentes foram preservados.");
  }
  if (raw.pending !== undefined && raw.pending !== null) {
    const p = raw.pending;
    if (!p || typeof p !== "object" || Array.isArray(p) || !absolute(p.mediaDir) || !absolute(p.videosDir)
      || !["reuse", "copy"].includes(p.mediaAction) || !["reuse", "copy"].includes(p.videosAction)
      || typeof p.id !== "string" || !/^[\da-f-]{36}$/i.test(p.id)) {
      throw new Error("A mudança de pastas pendente é inválida. Os caminhos atuais foram preservados.");
    }
  }
  if (roots) {
    validateRoots(raw.mediaDir, raw.videosDir, { ...roots, legacyRoot: raw.legacyRoot });
    if (raw.pending) validateRoots(raw.pending.mediaDir, raw.pending.videosDir, roots);
  }
  return raw;
}

function hash(file) {
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null))) digest.update(buf.subarray(0, n));
    return digest.digest("hex");
  } finally { fs.closeSync(fd); }
}

// Detecta alterações, inclusões e remoções durante a cópia. Marcadores de
// processo são conferidos separadamente e não fazem parte do perfil copiado.
function fingerprint(root, { chromium = false } = {}) {
  const digest = crypto.createHash("sha256");
  function walk(file, relative) {
    if (chromium && PROFILE_LOCKS.has(path.basename(file))) return;
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code === "ENOENT" && !relative) { digest.update("absent"); return; } throw error; }
    if (stat.isDirectory()) {
      digest.update(JSON.stringify([relative, "directory"]));
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) digest.update(JSON.stringify([relative, stat.size, hash(file)]));
    else throw new Error(`A migração encontrou um arquivo não regular: ${file}`);
  }
  walk(root, "");
  return digest.digest("hex");
}

/** Não segue links e confere bytes; repetir após queda não substitui conflitos. */
function copyVerified(from, to, { chromium = false } = {}) {
  if (!fs.existsSync(from)) return;
  const source = fs.lstatSync(from);
  if (chromium && PROFILE_LOCKS.has(path.basename(from))) return;
  if (source.isSymbolicLink()) throw new Error(`A migração encontrou um link e preservou a origem: ${from}`);
  if (fs.existsSync(to) && fs.lstatSync(to).isSymbolicLink()) throw new Error(`O destino contém um link: ${to}`);
  if (source.isDirectory()) {
    fs.ensureDirSync(to, { mode: 0o700 });
    for (const name of fs.readdirSync(from)) copyVerified(path.join(from, name), path.join(to, name), { chromium });
  } else if (source.isFile()) {
    fs.ensureDirSync(path.dirname(to));
    if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(to, source.mode & 0o777);
      fs.utimesSync(to, source.atime, source.mtime);
    }
    if (!fs.lstatSync(to).isFile() || source.size !== fs.statSync(to).size || hash(from) !== hash(to)) {
      throw new Error(`A cópia não pôde ser verificada; a origem permanece intacta: ${from}`);
    }
  } else throw new Error(`Tipo de arquivo não suportado na migração: ${from}`);
}

function resolveInitial({ bootstrap, documents }) {
  const anchor = readJson(path.join(bootstrap, "data-location.json"));
  if (anchor && (!absolute(anchor.dataDir) || (anchor.profileSource !== undefined && !absolute(anchor.profileSource)))) {
    throw new Error("O endereço antigo dos dados é inválido. A migração não foi iniciada.");
  }
  const oldDefault = path.join(documents, "LouvorJA Violin");
  const hasOldDefault = [".electron", ...PRIVATE_ENTRIES, "files", "Videos", "musics", "images", "covers"].some((name) => fs.existsSync(path.join(oldDefault, name)));
  const legacyRoot = anchor?.dataDir || (hasOldDefault ? oldDefault : bootstrap);
  if (anchor && !fs.existsSync(legacyRoot)) throw new Error(`A pasta antiga está indisponível: ${legacyRoot}. Reconecte o disco para preservar seus dados.`);
  const oldStorage = readJson(path.join(legacyRoot, "storage", "storage.json"))
    || readJson(path.join(bootstrap, "storage", "storage.json"));
  if (oldStorage?.filesDir && !absolute(oldStorage.filesDir)) throw new Error("O endereço antigo do acervo é inválido.");
  const oldMedia = oldStorage?.filesDir || null;
  const existing = !!anchor || hasOldDefault || [...PRIVATE_ENTRIES, ...PROFILE_ENTRIES].some((name) => fs.existsSync(path.join(bootstrap, name)));
  const mediaDir = fs.existsSync(path.join(legacyRoot, "files")) ? path.join(legacyRoot, "files")
    : oldMedia || (["musics", "images", "covers"].some((n) => fs.existsSync(path.join(oldDefault, n))) ? oldDefault : path.join(oldDefault, "Acervo"));
  const videosDir = fs.existsSync(path.join(legacyRoot, "Videos")) ? path.join(legacyRoot, "Videos") : path.join(oldDefault, "Videos");
  if (mediaDir === oldMedia && !fs.existsSync(mediaDir)) throw new Error(`A pasta antiga do acervo está indisponível: ${mediaDir}. Reconecte o disco antes de migrar.`);
  let chromium = path.join(legacyRoot, ".electron");
  if (anchor?.profileSource) {
    if (path.basename(anchor.profileSource) !== ".electron") throw new Error("Origem do perfil antigo inválida.");
    const sourceExists = fs.existsSync(anchor.profileSource);
    if (sourceExists && fs.existsSync(chromium) && path.resolve(anchor.profileSource) !== path.resolve(chromium)) {
      throw new Error("Existem dois perfis na mudança antiga. A origem foi preservada para evitar misturá-los.");
    }
    chromium = sourceExists ? anchor.profileSource : (fs.existsSync(`${chromium}.migrating`) ? `${chromium}.migrating` : chromium);
    if (!fs.existsSync(chromium)) throw new Error("O perfil da mudança anterior não está disponível.");
  }
  return { layout: { version: 1, mediaDir, videosDir, setupCompleted: existing, ...(existing ? { legacyRoot } : {}) }, chromium, legacyRoot };
}

function initialize({ bootstrap, documents, programDir, machineDefaults = null }) {
  const file = path.join(bootstrap, "storage-layout.json");
  const profile = path.join(bootstrap, "profile");
  const roots = { profileDir: profile, programDir };
  if (fs.existsSync(profile) && (!fs.lstatSync(profile).isDirectory() || fs.lstatSync(profile).isSymbolicLink())) {
    throw new Error("A pasta privada do usuário não pode ser um link nem um arquivo.");
  }
  const current = readJson(file);
  if (current) {
    validateLayout(current, roots);
    if (!fs.existsSync(profile)) throw new Error(`A pasta do usuário está indisponível: ${profile}`);
    return current;
  }
  const published = readJson(path.join(profile, ".layout-origin.json"));
  if (published) { validateLayout(published, roots); atomicJson(file, published); return published; }
  if (fs.existsSync(profile)) throw new Error(`A pasta do usuário já existe sem registro de migração: ${profile}`);

  const { layout, chromium, legacyRoot } = resolveInitial({ bootstrap, documents });
  const chromiumSource = fs.existsSync(chromium) ? chromium : bootstrap;
  const idleOptions = { ownedBootstrapDir: bootstrap };
  assertProfileIdle(chromiumSource, idleOptions);
  const snapshots = [];
  function snapshotCopy(from, to, options = {}) {
    const before = fingerprint(from, options);
    copyVerified(from, to, options);
    if (before !== fingerprint(to, options)) throw new Error(`A cópia do perfil mudou durante a migração: ${from}. Feche outras instâncias e tente novamente.`);
    snapshots.push({ from, before, options });
  }
  if (!layout.setupCompleted && machineDefaults) {
    if (machineDefaults.version !== 1 || !absolute(machineDefaults.mediaDir) || !absolute(machineDefaults.videosDir)) {
      throw new Error("A configuração de acervo da máquina é inválida.");
    }
    layout.mediaDir = machineDefaults.mediaDir;
    layout.videosDir = machineDefaults.videosDir;
    layout.mediaShared = true;
    layout.videosShared = true;
  }
  validateLayout(layout, roots);
  // Criar padrões só nesta primeira resolução. Um disco removido depois nunca
  // é substituído silenciosamente por outro diretório.
  for (const dir of [layout.mediaDir, layout.videosDir]) {
    if (!fs.existsSync(dir)) {
      try { fs.ensureDirSync(dir); } catch { /* a UI permite escolher um destino acessível */ }
    }
  }
  const staging = path.join(bootstrap, "profile.migrating");
  if (fs.existsSync(staging)) {
    const marker = path.join(staging, ".migration-owned");
    if (!fs.lstatSync(staging).isDirectory() || !fs.existsSync(marker)
      || !fs.lstatSync(marker).isFile() || fs.readFileSync(marker, "utf8") !== "LouvorJA storage layout 1") {
      throw new Error(`A pasta temporária já existe e foi preservada: ${staging}`);
    }
  }
  fs.removeSync(staging);
  fs.ensureDirSync(staging, { mode: 0o700 });
  fs.writeFileSync(path.join(staging, ".migration-owned"), "LouvorJA storage layout 1", { mode: 0o600 });
  for (const name of PRIVATE_ENTRIES) {
    for (const suffix of name.endsWith(".json") ? ["", ".bak", ".tmp"] : [""]) {
      const source = path.join(legacyRoot, name + suffix);
      const fallback = path.join(bootstrap, name + suffix);
      snapshotCopy(fs.existsSync(source) ? source : fallback, path.join(staging, name + suffix));
    }
    // Antes da raiz única, as preferências podiam continuar no AppData.
    // A raiz ativa é autoritativa; só completa arquivos ausentes no storage.
    if (name === "storage" && legacyRoot !== bootstrap && fs.existsSync(path.join(bootstrap, name))) {
      const fallback = path.join(bootstrap, name);
      if (!fs.lstatSync(fallback).isDirectory()) throw new Error("As preferências antigas não estão numa pasta regular.");
      for (const file of fs.readdirSync(fallback)) {
        if (fs.existsSync(path.join(staging, name, file))) continue;
        snapshotCopy(path.join(fallback, file), path.join(staging, name, file));
      }
    }
  }
  if (fs.existsSync(chromium)) snapshotCopy(chromium, path.join(staging, ".electron"), { chromium: true });
  else {
    for (const name of PROFILE_ENTRIES) snapshotCopy(path.join(bootstrap, name), path.join(staging, ".electron", name), { chromium: true });
  }
  snapshotCopy(path.join(layout.mediaDir, "library", "media"), path.join(staging, "attachments", "media"));
  fs.ensureDirSync(path.join(staging, ".electron"), { mode: 0o700 });
  rebaseJsonFiles(staging, [
    { from: path.join(layout.mediaDir, "library", "media"), to: path.join(profile, "attachments", "media") },
    { from: path.join(legacyRoot, "canva"), to: path.join(profile, "canva") },
    { from: path.join(bootstrap, "canva"), to: path.join(profile, "canva") },
  ]);
  atomicJson(path.join(staging, ".layout-origin.json"), layout);
  assertProfileIdle(chromiumSource, idleOptions);
  for (const { from, before, options } of snapshots) {
    if (before !== fingerprint(from, options)) throw new Error(`Os dados antigos mudaram durante a migração: ${from}. Feche outras instâncias e tente novamente.`);
  }
  fs.renameSync(staging, profile);
  atomicJson(file, layout);
  return layout;
}

module.exports = { initialize, resolveInitial, absolute, atomicJson, readJson, validateLayout, copyVerified, hash, PRIVATE_ENTRIES };
