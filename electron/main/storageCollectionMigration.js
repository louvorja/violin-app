"use strict";
// Operações de arquivo compartilhadas pelo boot e pela tela de armazenamento.
// Não depende do singleton Electron/paths; o chamador fornece a raiz de trabalho.
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const access = require("./storageAccess.js");
const { atomicJson, copyVerified, hash } = require("./storageLayout.js");
const { managedRelative } = require("./mediaFiles.js");
const { canonical, overlaps, validateRoots } = require("./storageRoots.js");
const { ensureCollectionDirectorySync, setNewCollectionFileModeSync } = require("./sharedCollectionDirs.js");
const PRIVATE_NAMES = [".electron", "storage", "library", "profile", "attachments", "canva", "storage-layout.json", "data-location.json"];
function normalized(p) { const s = path.resolve(p); return process.platform === "win32" ? s.toLowerCase() : s; }
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

function prepareStaging(target, source, kind, id, workDir) {
  let base = target;
  if (workDir) {
    const privateWork = canonical(workDir);
    fs.ensureDirSync(privateWork, { mode: 0o700 });
    if (!fs.lstatSync(privateWork).isDirectory()) throw new Error("A pasta privada de trabalho está indisponível.");
    // rename só publica atomicamente dentro do mesmo volume. No Windows ele
    // também preserva a ACL da origem privada; criar o transitório no destino
    // permite herdar as permissões do acervo compartilhado antes de publicar.
    if (process.platform !== "win32" && fs.statSync(privateWork).dev === fs.statSync(target).dev) base = privateWork;
  }
  const staging = path.join(base, `.louvorja-migration-${base === target ? "" : `${kind}-`}${id}`);
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

function copyCollection(source, target, kind, id, { onProgress, workDir, allowLegacyNested = false, acquire = access.acquire, shared = false } = {}) {
  if (!["media", "videos"].includes(kind) || typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id)) throw new Error("Identificação da cópia inválida.");
  source = canonical(source); target = canonical(target);
  if (canonical(source) === canonical(target)) return;
  const knownLegacyChild = allowLegacyNested === true && kind === "media"
    && normalized(target) === normalized(path.join(source, "Acervo"));
  if (overlaps(source, target) && !knownLegacyChild) throw new Error("A pasta de destino não pode conter a origem nem estar dentro dela.");
  const releases = [];
  let copiedFiles = 0, copiedBytes = 0;
  const progress = () => onProgress?.({ phase: "copying", files: copiedFiles, bytes: copiedBytes });
  try {
    // Apenas no boot: este processo ainda não abriu seus gravadores.
    releases.push(acquire(source));
    releases.push(acquire(target));
    progress();
    const entries = preflightCopy(source, target, kind);
    const staging = prepareStaging(target, source, kind, id, workDir);
    for (const entry of entries) {
      const dest = path.join(target, entry.relative);
      if (normalized(canonical(dest)) !== normalized(dest)) throw new Error(`O destino contém um link: ${dest}`);
      if (fs.existsSync(dest)) {
        if (!fs.lstatSync(dest).isFile() || hash(dest) !== hash(entry.source)) throw new Error(`O destino mudou durante a cópia: ${entry.relative}`);
        copiedFiles++; copiedBytes += entry.size; progress();
        continue;
      }
      const staged = path.join(staging, entry.relative);
      assertStagingPath(staging, entry.relative);
      // Uma cópia interrompida nunca é considerada concluída.
      if (fs.existsSync(staged)) {
        if (!fs.lstatSync(staged).isFile()) throw new Error(`O arquivo temporário é inválido: ${staged}`);
        if (hash(staged) !== hash(entry.source)) fs.unlinkSync(staged);
      }
      copyVerified(entry.source, staged, { inheritPermissions: true });
      assertStagingPath(staging, entry.relative);
      // Somente o arquivo privado que será publicado agora recebe permissão
      // de leitura pública. Arquivos já presentes no destino ficam intactos.
      if (shared && process.platform !== "win32" && fs.lstatSync(staged).nlink !== 1) {
        throw new Error(`O arquivo temporário possui outros vínculos e foi preservado: ${staged}`);
      }
      setNewCollectionFileModeSync(staged, { shared });
      ensureCollectionDirectorySync(path.dirname(dest), { shared });
      if (normalized(canonical(dest)) !== normalized(dest)) throw new Error(`O destino contém um link: ${dest}`);
      if (fs.existsSync(dest)) throw new Error(`O destino mudou durante a cópia: ${entry.relative}`);
      fs.renameSync(staged, dest);
      copiedFiles++; copiedBytes += entry.size; progress();
    }
    validateStagingTree(staging);
    fs.removeSync(staging);
  } finally { for (const release of releases.reverse()) release(); }
}
function applyPendingLayout(current, { profileDir, programDir, workDir, acquire, onProgress } = {}) {
  const pending = current.pending;
  if (!pending) return current;
  try {
    const next = { ...current };
    const [mediaDir, videosDir] = validateRoots(pending.mediaDir, pending.videosDir, { profileDir, programDir });
    for (const [kind, target] of [["media", mediaDir], ["videos", videosDir]]) {
      if (normalized(target) === normalized(canonical(current[kind + "Dir"]))) {
        if (pending.defaultMigration === true) {
          const shared = current[kind + "Shared"] === true || pending[kind + "Shared"] === true
            || access.readMarker(target, kind)?.shared === true;
          next[kind + "Shared"] = shared;
          if (shared) markShared(target, kind);
        }
        continue;
      }
      validateContents(target, kind);
      if (!fs.existsSync(target)) throw new Error(`A pasta escolhida está indisponível: ${target}`);
      const requestedShared = pending.defaultMigration === true ? pending[kind + "Shared"] === true
        : pending[kind + "Action"] === "reuse" || !normalized(target).startsWith(normalized(os.homedir()) + path.sep);
      const shared = requestedShared || access.readMarker(target, kind)?.shared === true;
      if (pending[kind + "Action"] === "copy") copyCollection(current[kind + "Dir"], target, kind, pending.id, {
        workDir, acquire, onProgress, allowLegacyNested: pending.defaultMigration === true, shared,
      });
      next[kind + "Shared"] = shared;
      if (shared) markShared(target, kind);
    }
    return { ...next, mediaDir, videosDir, pending: undefined, pendingError: undefined };
  } catch (error) {
    // A UI continua usando os caminhos antigos e pode cancelar ou corrigir a
    // escolha. Arquivos já copiados são verificados e reaproveitados no retry.
    console.warn("[storage] Mudança pendente preservada:", error.message);
    return { ...current, pendingError: error.message };
  }
}

module.exports = { validateContents, probe, files, preflightCopy, copyCollection, prepareStaging, applyPendingLayout };
