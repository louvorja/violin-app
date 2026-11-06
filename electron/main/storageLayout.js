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
const { ensureCollectionDirectorySync, grantLocalAccountsSync } = require("./sharedCollectionDirs.js");

const PRIVATE_ENTRIES = ["storage", "library", "json_db", "bin", "server", "canva", "pptx",
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

/** JSON corrompido conta como ausente; erro de leitura continua sendo erro. */
function readJsonLenient(file) {
  try { return fs.readJsonSync(file); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) { console.warn(`[storage] JSON ilegível ignorado: ${file}`); return null; }
    throw new Error(`Não foi possível ler a configuração de armazenamento: ${file}`, { cause: error });
  }
}

const KEEP_RECOVERY = 3;
/**
 * Tira do caminho, sem apagar, o que impediria a abertura. Fica em
 * `<appData>/LouvorJA Violin/recovery/<quando>-<motivo>/`; só as últimas
 * guardas são mantidas, para não acumular perfis inteiros no disco.
 */
function setAside(bootstrap, files, reason) {
  const present = files.filter((file) => { try { fs.lstatSync(file); return true; } catch { return false; } });
  if (!present.length) return null;
  const recovery = path.join(bootstrap, "recovery");
  const folder = path.join(recovery, `${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}`);
  fs.ensureDirSync(folder, { mode: 0o700 });
  for (const file of present) {
    fs.renameSync(file, path.join(folder, path.basename(file)));
    console.warn(`[storage] ${file} guardado em ${folder} (${reason}).`);
  }
  const kept = fs.readdirSync(recovery).sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - KEEP_RECOVERY))) fs.removeSync(path.join(recovery, old));
  return folder;
}

/**
 * A beta.14+ regrava a âncora a cada abertura; uma queda no meio deixa o JSON
 * truncado, quase sempre com o endereço inteiro. Recupera o endereço quando dá
 * e, sem ele, faz como a própria versão antiga: procura no endereço padrão.
 * A âncora nunca é regravada aqui.
 */
function readAnchor(bootstrap) {
  const file = path.join(bootstrap, "data-location.json");
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { present: false, anchor: null };
    throw new Error(`Não foi possível ler o endereço antigo dos dados: ${file}`, { cause: error });
  }
  let parsed = null;
  try { parsed = JSON.parse(text); }
  catch {
    const match = text.match(/"dataDir"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    try { parsed = match ? { dataDir: JSON.parse(`"${match[1]}"`) } : null; } catch { parsed = null; }
  }
  const dataDir = parsed && absolute(parsed.dataDir) ? parsed.dataDir : null;
  if (!dataDir) {
    console.warn("[storage] Endereço antigo dos dados ilegível; procurando no endereço padrão.");
    return { present: true, anchor: null };
  }
  return { present: true, anchor: absolute(parsed.profileSource) ? { dataDir, profileSource: parsed.profileSource } : { dataDir } };
}

function validateLayout(raw, roots) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1 || !absolute(raw.mediaDir) || !absolute(raw.videosDir)
    || typeof raw.setupCompleted !== "boolean"
    || (raw.pendingError !== undefined && typeof raw.pendingError !== "string")
    || ["mediaShared", "videosShared"].some((key) => raw[key] !== undefined && typeof raw[key] !== "boolean")
    || (raw.legacyRoot !== undefined && !absolute(raw.legacyRoot))) {
    throw new Error("A configuração de armazenamento é inválida. Os dados existentes foram preservados.");
  }
  if (raw.pending !== undefined && raw.pending !== null) {
    const p = raw.pending;
    if (!p || typeof p !== "object" || Array.isArray(p) || !absolute(p.mediaDir) || !absolute(p.videosDir)
      || !["reuse", "copy", "move"].includes(p.mediaAction) || !["reuse", "copy", "move"].includes(p.videosAction)
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

function unavailable(dir, cause) {
  return Object.assign(new Error(`Sem acesso à pasta dos dados: ${dir}`, { cause }), { code: "LJ_DATA_UNAVAILABLE", dir });
}

// existsSync também responde false sem permissão (TCC do macOS, ACL): tomar
// "sem acesso" por "não existe" trataria quem tem dados como instalação nova.
function present(file, root) {
  try { fs.statSync(file); return true; }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw unavailable(root, error);
  }
}
function isDirectory(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

function readable(dir) {
  try { fs.readdirSync(dir); return true; }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw unavailable(dir, error);
  }
}

// Quem já usa o app fica com o acervo e os vídeos onde estão, como se os tivesse
// escolhido ali; só o perfil vem para a pasta privada.
function resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults }) {
  const { present: anchorPresent, anchor } = readAnchor(bootstrap);
  const oldDefault = path.join(documents, "LouvorJA Violin");
  // A beta.14+ grava a âncora a cada abertura e as anteriores usavam o AppData
  // como perfil. Sem nenhum dos dois é instalação nova, e Documentos nem é
  // consultado: no macOS isso já abriria o pedido de acesso.
  // Uma âncora ilegível ainda prova que houve uma instalação antes.
  const previousInBootstrap = anchorPresent
    || [...PRIVATE_ENTRIES, ...PROFILE_ENTRIES].some((name) => fs.existsSync(path.join(bootstrap, name)));
  const hasOldDefault = !anchor && previousInBootstrap
    && [".electron", ...PRIVATE_ENTRIES, "files", "Videos", "musics", "images", "covers"].some((name) => present(path.join(oldDefault, name), oldDefault));
  const legacyRoot = anchor?.dataDir || (hasOldDefault ? oldDefault : bootstrap);
  if (anchor && !readable(legacyRoot)) throw unavailable(legacyRoot);
  const oldStorage = readJsonLenient(path.join(legacyRoot, "storage", "storage.json"))
    || readJsonLenient(path.join(bootstrap, "storage", "storage.json"));
  const oldMedia = absolute(oldStorage?.filesDir) && present(oldStorage.filesDir, oldStorage.filesDir) ? oldStorage.filesDir : null;
  const existing = !!anchor || previousInBootstrap;
  const filesInRoot = path.join(legacyRoot, "files");
  const holdsMedia = (dir, root = dir) => ["musics", "images", "covers"].some((n) => present(path.join(dir, n), root));
  const holdsMediaIfReadable = (dir) => { try { return holdsMedia(dir); } catch { return false; } };
  // Sem âncora, a versão anterior é a beta.13 ou mais antiga: até a beta.3 o
  // acervo podia estar em qualquer destes lugares, e só a main o recolhia no
  // boot. Fica o primeiro que tem acervo de fato, na ordem em que ela procurava.
  const legacyMedia = !anchor && previousInBootstrap
    ? [oldMedia, hasOldDefault ? oldDefault : null].find((dir) => dir && holdsMedia(dir))
      || [path.join(documents, "LouvorJA"), path.join(bootstrap, "files")].find(holdsMediaIfReadable)
    : null;
  const mediaDir = holdsMedia(filesInRoot, legacyRoot) ? filesInRoot
    : legacyMedia || (present(filesInRoot, legacyRoot) ? filesInRoot : oldMedia || filesInRoot);
  const videosDir = path.join(legacyRoot, "Videos");
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
  const locations = existing ? { mediaDir, videosDir, legacyRoot } : defaultLocations({ documents, videos, sharedMedia, machineDefaults });
  return { layout: { version: 1, ...locations, setupCompleted: existing }, chromium, legacyRoot };
}

function initialize(options) {
  const release = acquireProfileMigrationLock(options.bootstrap);
  try {
    const current = initializeLocked(options);
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

/** Um registro só com a mudança de pastas inválida perde a mudança, não o resto. */
function usableLayout(raw, roots) {
  if (!raw) return null;
  try { return validateLayout(raw, roots); }
  catch (error) {
    console.warn("[storage] Registro de armazenamento inválido:", error.message);
    if (raw.pending == null || typeof raw !== "object") return null;
    const { pending: _discarded, ...rest } = raw;
    try {
      return validateLayout({ ...rest, pendingError: "A mudança de pastas pedida estava inválida e foi descartada. Escolha as pastas de novo." }, roots);
    } catch { return null; }
  }
}

function createDefaultRoots(layout) {
  // Criar padrões só nesta primeira resolução. Um disco removido depois nunca
  // é substituído silenciosamente por outro diretório.
  for (const [kind, dir] of [["media", layout.mediaDir], ["videos", layout.videosDir]]) {
    if (!fs.existsSync(dir)) {
      const shared = layout[kind + "Shared"] === true;
      try { ensureCollectionDirectorySync(canonical(dir), { shared }); }
      catch { continue; /* a UI permite escolher um destino acessível */ }
      try { if (shared) grantLocalAccountsSync(canonical(dir)); }
      catch (error) { console.warn("[storage]", error.message); }
    }
  }
}

function openStaging(bootstrap) {
  const staging = path.join(bootstrap, "profile.migrating");
  if (fs.existsSync(staging)) {
    const marker = path.join(staging, ".migration-owned");
    if (!fs.lstatSync(staging).isDirectory() || !fs.existsSync(marker)
      || !fs.lstatSync(marker).isFile() || fs.readFileSync(marker, "utf8") !== "LouvorJA storage layout 1") {
      // Não foi esta rotina que criou: guarda, em vez de apagar ou travar.
      setAside(bootstrap, [staging], "copia-desconhecida");
    }
  }
  fs.removeSync(staging);
  fs.ensureDirSync(staging, { mode: 0o700 });
  fs.writeFileSync(path.join(staging, ".migration-owned"), "LouvorJA storage layout 1", { mode: 0o600 });
  return staging;
}

function initializeLocked({ bootstrap, documents, videos, sharedMedia, programDir, machineDefaults = null, ownedBootstrapPid = process.pid, onProgress, freshStart = false }) {
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
  const originFile = path.join(profile, ".layout-origin.json");
  const raw = readJsonLenient(file);
  const current = usableLayout(raw, roots);
  const hasProfile = fs.existsSync(profile);
  if (current && hasProfile) {
    if (current !== raw) atomicJson(file, current);
    return current;
  }
  // Ilegível ou inválido: fica guardado, nunca apagado. O válido sem perfil é
  // reaproveitado abaixo e só é regravado quando o perfil novo for publicado.
  if (!current && fs.existsSync(file)) setAside(bootstrap, [file], "registro-invalido");
  const published = hasProfile ? usableLayout(readJsonLenient(originFile), roots) : null;
  if (published) { atomicJson(file, published); return published; }
  if (hasProfile) {
    // O perfil é o dado mais novo da conta e só o registro se perdeu: refaz o
    // registro a partir dele, sem copiar a origem antiga por cima.
    const { layout } = resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults });
    validateLayout(layout, roots);
    atomicJson(originFile, layout);
    atomicJson(file, layout);
    console.warn(`[storage] Registro refeito para o perfil existente: ${profile}`);
    return layout;
  }
  // Perfil sumiu com o registro intacto: os dados antigos são copiados de novo,
  // mas acervo e vídeos ficam onde o operador os tinha deixado.
  const kept = current ? { mediaDir: current.mediaDir, videosDir: current.videosDir, mediaShared: current.mediaShared, videosShared: current.videosShared } : null;

  if (freshStart) return publishFresh({ bootstrap, documents, videos, sharedMedia, machineDefaults, roots, file, profile, kept });

  const initial = resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults });
  const { chromium, legacyRoot } = initial;
  const layout = kept ? { ...initial.layout, ...kept } : initial.layout;
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
  createDefaultRoots(layout);
  const staging = openStaging(bootstrap);
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
    { from: path.join(legacyRoot, "pptx"), to: path.join(profile, "pptx") },
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
  // Downloads de vídeo interrompidos são retomáveis do zero: não impedem a abertura.
  try {
    require("./onlineVideo/workMigration.js").migrateVideoWork(
      [layout.videosDir, path.join(bootstrap, "online_videos")], path.join(profile, "temp", "videos"));
  } catch (error) { console.warn("[storage] Downloads de vídeo interrompidos ficaram na origem:", error.message); }
  progress("complete", null);
  return layout;
}

/**
 * "Começar do zero": perfil vazio, sem copiar nada da instalação anterior.
 * Acervo e vídeos continuam onde estavam quando dá para encontrá-los — eles
 * não costumam ser a causa e baixar tudo de novo custaria horas.
 */
function publishFresh({ bootstrap, documents, videos, sharedMedia, machineDefaults, roots, file, profile, kept }) {
  let layout = null;
  try {
    const initial = resolveInitial({ bootstrap, documents, videos, sharedMedia, machineDefaults }).layout;
    if (initial.setupCompleted) layout = initial;
  } catch (error) { console.warn("[storage] Começando do zero sem os endereços antigos:", error.message); }
  layout ||= { version: 1, ...defaultLocations({ documents, videos, sharedMedia, machineDefaults }), setupCompleted: false };
  // As pastas em uso continuam valendo enquanto existirem; a que sumiu (disco
  // desconectado) não é recriada em outro lugar: volta-se ao endereço antigo ou ao padrão.
  if (kept && [kept.mediaDir, kept.videosDir].every(isDirectory)) layout = { ...layout, ...kept, setupCompleted: true };
  validateLayout(layout, roots);
  createDefaultRoots(layout);
  const staging = openStaging(bootstrap);
  fs.ensureDirSync(path.join(staging, ".electron"), { mode: 0o700 });
  atomicJson(path.join(staging, ".layout-origin.json"), layout);
  fs.renameSync(staging, profile);
  atomicJson(file, layout);
  return layout;
}

module.exports = { initialize, resolveInitial, defaultLocations, absolute, atomicJson, readJson, readJsonLenient, setAside, validateLayout, copyVerified, hash, PRIVATE_ENTRIES, REBUILDABLE_CHROMIUM };
