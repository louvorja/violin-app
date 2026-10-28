"use strict";

// Executado depois do lock de instância e antes de abrir Chromium ou userStore.
// A origem nunca é apagada: a publicação só acontece após conferir a cópia.
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROFILE_ENTRIES } = require("./dataMigration.js");
const { rebaseJsonFiles } = require("./privatePathMigration.js");
const { absolute, validateRoots, canonical } = require("./storageRoots.js");
const { assertProfileIdle } = require("./profileActivity.js");
const { acquireProfileMigrationLock } = require("./profileMigrationLock.js");
const { ensureCollectionDirectorySync } = require("./sharedCollectionDirs.js");

const PRIVATE_ENTRIES = ["storage", "library", "json_db", "bin", "server", "canva",
  "configweb.json", "runtime-incidents.json", "telemetry-main-errors.json"];
const PROFILE_LOCKS = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile", "LOCK", "DevToolsActivePort"]);
// Só caches regeneráveis na raiz do perfil. Service Worker/CacheStorage,
// IndexedDB, blob_storage e entradas desconhecidas podem conter dados offline.
const REBUILDABLE_CHROMIUM = new Set(["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Crashpad", "logs", "logs.txt", "BrowserMetrics"]);
const HASH_BUFFER = Buffer.allocUnsafe(256 * 1024);

function skipChromiumEntry(file, { chromium, chromiumRoot } = {}) {
  return chromium && (PROFILE_LOCKS.has(path.basename(file))
    || (chromiumRoot && path.dirname(file) === chromiumRoot && REBUILDABLE_CHROMIUM.has(path.basename(file))));
}

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
    || (raw.pendingError !== undefined && typeof raw.pendingError !== "string")
    || (raw.defaultLocationsVersion !== undefined && raw.defaultLocationsVersion !== 1)
    || (raw.sharedLocationsVersion !== undefined && raw.sharedLocationsVersion !== 1)
    || ["mediaShared", "videosShared"].some((key) => raw[key] !== undefined && typeof raw[key] !== "boolean")
    || (raw.legacyRoot !== undefined && !absolute(raw.legacyRoot))) {
    throw new Error("A configuração de armazenamento é inválida. Os dados existentes foram preservados.");
  }
  if (raw.pending !== undefined && raw.pending !== null) {
    const p = raw.pending;
    if (!p || typeof p !== "object" || Array.isArray(p) || !absolute(p.mediaDir) || !absolute(p.videosDir)
      || !["reuse", "copy"].includes(p.mediaAction) || !["reuse", "copy"].includes(p.videosAction)
      || (p.defaultMigration !== undefined && typeof p.defaultMigration !== "boolean")
      || ["mediaShared", "videosShared"].some((key) => p[key] !== undefined && typeof p[key] !== "boolean")
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
  // hash() é síncrono. Reutilizar o buffer evita alocar megabytes a cada
  // arquivo pequeno de um perfil com milhares de entradas.
  const buf = HASH_BUFFER;
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null))) digest.update(buf.subarray(0, n));
    return digest.digest("hex");
  } finally { fs.closeSync(fd); }
}

// Detecta alterações, inclusões e remoções durante a cópia. Marcadores de
// processo são conferidos separadamente e não fazem parte do perfil copiado.
function fingerprint(root, options = {}) {
  const digest = crypto.createHash("sha256");
  function walk(file, relative) {
    if (skipChromiumEntry(file, options)) return;
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code === "ENOENT" && !relative) { digest.update("absent"); return; } throw error; }
    if (stat.isDirectory()) {
      digest.update(JSON.stringify([relative, "directory"]));
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) {
      const contentHash = hash(file);
      digest.update(JSON.stringify([relative, stat.size, contentHash]));
      options.hashes?.set(file, contentHash);
      options.onFile?.(stat.size);
    }
    else throw new Error(`A migração encontrou um arquivo não regular: ${file}`);
  }
  walk(root, "");
  return digest.digest("hex");
}

/** Não segue links e confere bytes; repetir após queda não substitui conflitos. */
function copyWithInheritedPermissions(from, to) {
  // CopyFile no Windows também transporta propriedades de segurança. Criar
  // explicitamente um arquivo novo herda a ACL da pasta pública de destino.
  const input = fs.openSync(from, "r");
  let output;
  try {
    output = fs.openSync(to, "wx", 0o666);
    let size;
    while ((size = fs.readSync(input, HASH_BUFFER, 0, HASH_BUFFER.length, null))) {
      let offset = 0;
      while (offset < size) {
        const written = fs.writeSync(output, HASH_BUFFER, offset, size - offset);
        if (written <= 0) throw new Error("Não foi possível concluir a cópia do arquivo.");
        offset += written;
      }
    }
  } finally {
    try { if (output !== undefined) fs.closeSync(output); }
    finally { fs.closeSync(input); }
  }
}

function copyVerified(from, to, options = {}) {
  if (skipChromiumEntry(from, options)) return;
  if (!fs.existsSync(from)) return;
  const source = fs.lstatSync(from);
  if (source.isSymbolicLink()) throw new Error(`A migração encontrou um link e preservou a origem: ${from}`);
  if (fs.existsSync(to) && fs.lstatSync(to).isSymbolicLink()) throw new Error(`O destino contém um link: ${to}`);
  if (source.isDirectory()) {
    fs.ensureDirSync(to, { mode: 0o700 });
    for (const name of fs.readdirSync(from)) copyVerified(path.join(from, name), path.join(to, name), options);
  } else if (source.isFile()) {
    const expectedHash = options.hashes ? options.hashes.get(from) : hash(from);
    if (!expectedHash) throw new Error(`Os dados antigos mudaram durante a migração: ${from}`);
    fs.ensureDirSync(path.dirname(to));
    if (!fs.existsSync(to)) {
      const inherit = options.inheritPermissions === true && process.platform === "win32";
      if (inherit) copyWithInheritedPermissions(from, to);
      else {
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
        fs.chmodSync(to, source.mode & 0o777);
      }
      fs.utimesSync(to, source.atime, source.mtime);
    }
    if (!fs.lstatSync(to).isFile() || source.size !== fs.statSync(to).size || expectedHash !== hash(to)) {
      throw new Error(`A cópia não pôde ser verificada; a origem permanece intacta: ${from}`);
    }
    // O manifesto inicial também prova cobertura: se um arquivo desaparecer
    // momentaneamente, não basta a origem voltar a ter os mesmos bytes depois.
    options.hashes?.delete(from);
    options.onFile?.(source.size);
  } else throw new Error(`Tipo de arquivo não suportado na migração: ${from}`);
}

function defaultLocations({ documents, videos = path.join(path.dirname(documents), "Videos"), sharedMedia, machineDefaults }) {
  if (!absolute(documents) || !absolute(videos) || !absolute(sharedMedia)) throw new Error("As pastas padrão do sistema são inválidas.");
  if (machineDefaults && (![1, 2].includes(machineDefaults.version) || !absolute(machineDefaults.mediaDir))) {
    throw new Error("A configuração de acervo da máquina é inválida.");
  }
  return {
    mediaDir: machineDefaults?.mediaDir || sharedMedia,
    videosDir: path.join(videos, "LouvorJA Violin"),
    mediaShared: true,
    videosShared: false,
  };
}

function resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults }) {
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
  const locations = existing ? { mediaDir, videosDir, legacyRoot } : { ...defaultLocations({ documents, videos, sharedMedia, machineDefaults }), defaultLocationsVersion: 1, sharedLocationsVersion: 1 };
  return { layout: { version: 1, ...locations, setupCompleted: existing }, chromium, legacyRoot };
}

function initialize(options) {
  const release = acquireProfileMigrationLock(options.bootstrap);
  try {
    const current = migrateDefaultLocations(initializeLocked(options), options);
    const next = require("./storageCollectionMigration.js").applyPendingLayout(current, {
      profileDir: path.join(options.bootstrap, "profile"), programDir: options.programDir,
      workDir: path.join(options.bootstrap, "profile", "temp", "migrations"),
      acquire: options.acquireCollection, onProgress: options.onProgress,
    });
    if (next !== current) {
      // Fora do catch da cópia: se o pai morreu, não publicar a configuração
      // só porque o erro de cancelamento virou uma pendência recuperável.
      options.onProgress?.({ phase: "publishing", files: 0, bytes: 0 });
      atomicJson(path.join(options.bootstrap, "storage-layout.json"), next);
    }
    return next;
  }
  finally { release(); }
}

// O marcador é por perfil, não por máquina: a troca automática ocorre uma vez.
// A origem permanece registrada separadamente para rebase dos anexos privados.
function migrateDefaultLocations(current, options) {
  if (current.defaultLocationsVersion === 1 && current.sharedLocationsVersion === 1) return current;
  const { bootstrap, programDir, onProgress } = options;
  const profile = path.join(bootstrap, "profile");
  const origin = readJson(path.join(profile, ".layout-origin.json"));
  const defaults = defaultLocations(options);
  const next = { ...current, defaultLocationsVersion: 1, sharedLocationsVersion: 1 };
  // Uma escolha explícita feita após a primeira migração prevalece sobre padrões.
  for (const kind of ["media", "videos"]) {
    const key = kind + "Dir";
    const previousDefault = kind === "media" && current.sharedLocationsVersion !== 1
      && path.resolve(current[key]) === path.resolve(options.documents, "LouvorJA Violin", "Acervo");
    if ((current.pending && current.pending.defaultMigration !== true)
      || (origin && current[key] !== origin[key] && !previousDefault)) continue;
    next[key] = defaults[key];
    next[kind + "Shared"] = defaults[kind + "Shared"];
  }
  validateLayout(next, { profileDir: profile, programDir });
  const { migrateVideoWork } = require("./onlineVideo/workMigration.js");
  onProgress?.({ phase: "copying", files: 0, bytes: 0 });
  migrateVideoWork([path.join(profile, "video-work"), current.videosDir, path.join(bootstrap, "online_videos")], path.join(profile, "temp", "videos"));
  const changed = next.mediaDir !== current.mediaDir || next.videosDir !== current.videosDir;
  // Persiste a intenção antes da cópia. Falta de espaço ou conflito abre o app
  // com as pastas anteriores e um erro visível, permitindo escolher outro destino.
  if (changed || current.pending?.defaultMigration === true) {
    next.pending = { id: crypto.randomUUID(), mediaDir: next.mediaDir, videosDir: next.videosDir,
      mediaAction: "copy", videosAction: "copy", defaultMigration: true,
      mediaShared: next.mediaShared === true, videosShared: next.videosShared === true };
    next.mediaDir = current.mediaDir; next.videosDir = current.videosDir;
    next.mediaShared = current.mediaShared === true; next.videosShared = current.videosShared === true;
    for (const [kind, target] of [["media", next.pending.mediaDir], ["videos", next.pending.videosDir]]) {
      // A primeira resolução pode criar os padrões. Retentativas não recriam
      // volumes desconectados: applyPendingLayout preserva a origem nesse caso.
      try { ensureCollectionDirectorySync(canonical(target), { shared: next.pending[kind + "Shared"] === true }); }
      catch { /* o erro aparece ao aplicar a cópia */ }
    }
  }
  onProgress?.({ phase: "publishing", files: 0, bytes: 0 });
  atomicJson(path.join(bootstrap, "storage-layout.json"), next);
  return next;
}

function initializeLocked({ bootstrap, documents, videos, sharedMedia, programDir, machineDefaults = null, ownedBootstrapPid = process.pid, onProgress }) {
  const counts = new Map();
  let lastPhase, lastProgress = 0;
  function progress(phase, size = 0) {
    const count = counts.get(phase) || { files: 0, bytes: 0 };
    if (size !== null) { count.files++; count.bytes += size; }
    counts.set(phase, count);
    const now = Date.now();
    if (phase !== lastPhase || now - lastProgress >= 100) {
      onProgress?.({ phase, ...count });
      lastPhase = phase; lastProgress = now;
    }
  }
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

  const { layout, chromium, legacyRoot } = resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults });
  const chromiumSource = fs.existsSync(chromium) ? chromium : bootstrap;
  const idleOptions = { ownedBootstrapDir: bootstrap, currentPid: ownedBootstrapPid };
  assertProfileIdle(chromiumSource, idleOptions);
  const snapshots = [];
  function snapshotCopy(from, to, options = {}) {
    if (skipChromiumEntry(from, options)) return;
    const hashes = new Map();
    progress("scanning", null);
    const before = fingerprint(from, { ...options, hashes, onFile: (size) => progress("scanning", size) });
    progress("copying", null);
    // Reutiliza o hash já lido da origem. Cada arquivo do destino é conferido
    // aqui, sem reler duas vezes o mesmo conteúdo na passagem seguinte.
    copyVerified(from, to, { ...options, hashes, onFile: (size) => progress("copying", size) });
    if (hashes.size) throw new Error(`A cópia do perfil ficou incompleta; arquivos da origem não foram copiados: ${from}`);
    snapshots.push({ from, before, options });
  }
  validateLayout(layout, roots);
  // Criar padrões só nesta primeira resolução. Um disco removido depois nunca
  // é substituído silenciosamente por outro diretório.
  for (const [kind, dir] of [["media", layout.mediaDir], ["videos", layout.videosDir]]) {
    if (!fs.existsSync(dir)) {
      try { ensureCollectionDirectorySync(canonical(dir), { shared: layout[kind + "Shared"] === true }); }
      catch { /* a UI permite escolher um destino acessível */ }
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
  if (fs.existsSync(chromium)) snapshotCopy(chromium, path.join(staging, ".electron"), { chromium: true, chromiumRoot: chromium });
  else {
    for (const name of PROFILE_ENTRIES) snapshotCopy(path.join(bootstrap, name), path.join(staging, ".electron", name), { chromium: true, chromiumRoot: bootstrap });
  }
  snapshotCopy(path.join(layout.mediaDir, "library", "media"), path.join(staging, "attachments", "media"));
  // A beta.18 guardava o cache do Canva dentro do acervo (`files/canva`). Ele é
  // da conta: vai para o perfil, sem substituir o que `<dados>/canva` já trouxe.
  const canvaInFiles = path.join(legacyRoot, "files", "canva");
  if (fs.existsSync(canvaInFiles) && fs.lstatSync(canvaInFiles).isDirectory()) {
    for (const name of fs.readdirSync(canvaInFiles)) {
      if (!fs.existsSync(path.join(staging, "canva", name))) snapshotCopy(path.join(canvaInFiles, name), path.join(staging, "canva", name));
    }
  }
  fs.ensureDirSync(path.join(staging, ".electron"), { mode: 0o700 });
  rebaseJsonFiles(staging, [
    { from: path.join(layout.mediaDir, "library", "media"), to: path.join(profile, "attachments", "media") },
    { from: canvaInFiles, to: path.join(profile, "canva") },
    { from: path.join(legacyRoot, "canva"), to: path.join(profile, "canva") },
    { from: path.join(bootstrap, "canva"), to: path.join(profile, "canva") },
  ]);
  atomicJson(path.join(staging, ".layout-origin.json"), layout);
  assertProfileIdle(chromiumSource, idleOptions);
  progress("verifying", null);
  for (const { from, before, options } of snapshots) {
    if (before !== fingerprint(from, { ...options, onFile: (size) => progress("verifying", size) })) throw new Error(`Os dados antigos mudaram durante a migração: ${from}. Feche outras instâncias e tente novamente.`);
  }
  progress("publishing", null);
  fs.renameSync(staging, profile);
  atomicJson(file, layout);
  progress("complete", null);
  return layout;
}

module.exports = { initialize, resolveInitial, defaultLocations, absolute, atomicJson, readJson, validateLayout, copyVerified, hash, PRIVATE_ENTRIES };
