"use strict";
const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const lockfile = require("proper-lockfile");
const leases = new Map();
const MARKER = ".louvorja-collection.json";
const LOCK = ".louvorja-writer.lock";
const OWNER = ".louvorja-writer.json";
const MAX_OWNER_BYTES = 1024;
const INSTANCE = crypto.randomUUID();
// O registro fica numa pasta que outras contas leem: o nome da máquina não vai em claro.
const HOST = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
const TIMING = { staleMs: 120000, heartbeatMs: 10000, retryMs: 15000 };
/** Travas deste processo, por caminho: o que soltar se ele sair sem avisar. */
const held = new Map();
let retryTimer = null, leasesGeneration = 0;
// Encerramento normal não passa por `release()`. O Electron emite `exit` ao sair.
function releaseHeld() {
  for (const releaseLease of [...held.values()]) { try { releaseLease(); } catch { /* Raiz indisponível. */ } }
}

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

/**
 * Um escritor por raiz. Outras contas continuam podendo ler os arquivos prontos.
 *
 * A trava é a pasta `.louvorja-writer.lock`: quem a cria é o escritor, renova o
 * horário dela a cada 10 s e a apaga ao sair. Uma trava com horário mais velho que
 * 120 s está abandonada. Esse contrato é o das versões que usavam o proper-lockfile
 * e não pode mudar — contas em versões diferentes dividem o mesmo acervo.
 *
 * A renovação é assíncrona. Feita com chamadas síncronas, cada batida parava o
 * processo principal pelo tempo que o disco levasse para responder: num HD externo
 * ou numa pasta sincronizada eram segundos, com a projeção no ar.
 */
function sameDirectory(current, expected) {
  // Uma pasta recriada nasce depois. No macOS, gravar um horário anterior ao
  // nascimento (o iCloud faz isso) recua a data de criação da mesma pasta.
  return current.isDirectory() && current.dev === expected.dev && current.ino === expected.ino
    && current.birthtimeMs <= expected.birthtimeMs;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function parseOwner(text) {
  try {
    const owner = JSON.parse(text);
    const lock = owner?.lock;
    if (owner?.version !== 1 || typeof owner.host !== "string" || typeof owner.instance !== "string"
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || ![lock?.dev, lock?.ino, lock?.birthtimeMs].every(Number.isFinite)) return null;
    return owner;
  } catch { return null; }
}

/**
 * O dono registrado desta trava morreu sem soltá-la?
 *
 * Instalador que encerra o app à força, queda de energia e desligamento do Windows
 * deixam a pasta para trás, e por 120 s ela parece em uso: a abertura seguinte
 * ficava somente leitura. Só vale para um dono deste computador e para a pasta que
 * ele mesmo criou — uma versão antiga que retomou a trava não grava registro, e o
 * registro velho ao lado dela não fala por ela.
 */
function ownerGone(owner, lockPath, lockStat) {
  if (!owner || owner.host !== HOST) return false;
  if (lockStat.dev !== owner.lock.dev || lockStat.ino !== owner.lock.ino || lockStat.birthtimeMs > owner.lock.birthtimeMs) return false;
  // O sistema reaproveita números de processo, inclusive o nosso.
  if (owner.pid === process.pid) return !(owner.instance === INSTANCE && held.has(lockPath));
  return !processAlive(owner.pid);
}

function abandoned(lockPath, ownerPath, lockStat) {
  if (lockStat.mtimeMs < Date.now() - TIMING.staleMs) return true;
  let text;
  try {
    const stat = fs.lstatSync(ownerPath);
    if (!stat.isFile() || stat.size > MAX_OWNER_BYTES) return false;
    text = fs.readFileSync(ownerPath, "utf8");
  } catch { return false; }
  return ownerGone(parseOwner(text), lockPath, lockStat);
}

function claim(lockPath, ownerPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.mkdirSync(lockPath); return; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    let stat;
    try { stat = fs.lstatSync(lockPath); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!stat.isDirectory()) throw new Error("A proteção de escrita não é uma pasta.");
    if (attempt > 0 || !abandoned(lockPath, ownerPath, stat)) break;
    try { fs.rmdirSync(lockPath); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  throw Object.assign(new Error("A pasta já tem um escritor."), { code: "ELOCKED" });
}

function acquire(root, { onLost } = {}) {
  const lockPath = path.join(root, LOCK);
  const ownerPath = path.join(root, OWNER);
  const rootIdentity = fs.lstatSync(root);
  if (!rootIdentity.isDirectory()) throw new Error("A pasta não está disponível.");
  claim(lockPath, ownerPath);
  const lockIdentity = fs.lstatSync(lockPath);
  const identity = (file) => { try { return fs.lstatSync(file); } catch { return null; } };
  const owns = () => {
    const currentRoot = identity(root), currentLock = identity(lockPath);
    return !!currentRoot && !!currentLock && sameDirectory(currentRoot, rootIdentity) && sameDirectory(currentLock, lockIdentity);
  };
  let active = true, timer = null;
  if (!held.size) process.on("exit", releaseHeld);
  held.set(lockPath, () => release());
  try {
    // Sem o registro a trava continua valendo; só não é retomada antes dos 120 s.
    const temporary = `${ownerPath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeJsonSync(temporary, {
        version: 1, host: HOST, pid: process.pid, instance: INSTANCE,
        lock: { dev: lockIdentity.dev, ino: lockIdentity.ino, birthtimeMs: lockIdentity.birthtimeMs },
      }, { flag: "wx", mode: 0o644 });
      fs.chmodSync(temporary, 0o644);
      fs.renameSync(temporary, ownerPath);
    } finally { fs.removeSync(temporary); }
  } catch (error) { console.warn("[storage] Não foi possível registrar o dono da proteção de escrita:", error.message); }

  const stop = () => {
    active = false;
    clearTimeout(timer);
    held.delete(lockPath);
    if (!held.size) process.off("exit", releaseHeld);
  };
  const schedule = () => {
    timer = setTimeout(beat, TIMING.heartbeatMs);
    timer.unref?.();
  };
  async function beat() {
    try {
      const [currentRoot, currentLock] = await Promise.all([fs.promises.lstat(root), fs.promises.lstat(lockPath)]);
      if (!active) return;
      if (!sameDirectory(currentRoot, rootIdentity) || !sameDirectory(currentLock, lockIdentity)) {
        // Outra pasta no mesmo caminho, ou outro escritor retomou a trava: não é mais nossa.
        stop();
        onLost?.();
        return;
      }
      const now = new Date();
      await fs.promises.utimes(lockPath, now, now);
    } catch (error) {
      if (!active) return;
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        stop();
        onLost?.();
        return;
      }
      // Disco que não respondeu: a próxima batida tenta de novo.
    }
    if (active) schedule();
  }
  schedule();

  function release() {
    if (!active) return;
    stop();
    // Não apagar a trava nova que apareceu no mesmo caminho após desmontagem ou retomada.
    if (!owns()) return;
    try { fs.unlinkSync(ownerPath); } catch { /* Sem registro, ou já removido. */ }
    try { fs.rmdirSync(lockPath); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  release.isValid = () => active && owns();
  return release;
}

function open(s, kind) {
  try {
    if (!fs.lstatSync(s.root).isDirectory()) throw new Error("A pasta não está disponível.");
    const marker = readMarker(s.root, kind);
    if (marker?.shared === true) s.shared = true;
    s.release = acquire(s.root, { onLost: () => lose(s) });
    const updated = updateMarker(s.root, kind, s.shared);
    s.shared = updated.shared;
    s.writable = true;
    s.reason = null;
    s.retry = false;
  } catch (error) {
    try { s.release?.(); } catch { /* A raiz/lease pode ter desaparecido. */ }
    s.release = null;
    s.writable = false;
    s.reason = error.code === "ELOCKED" ? "in-use" : "unavailable";
    // Pasta protegida contra gravação ou registro inválido não mudam sozinhos;
    // escritor que sai e disco que volta, sim.
    s.retry = error.code === "ELOCKED" || error.code === "ENOENT";
  }
}

function lose(s) {
  s.writable = false;
  s.reason = "unavailable";
  try { s.release?.(); } catch { /* A raiz/lease pode ter desaparecido. */ }
  s.release = null;
  s.retry = true;
  watch();
}

/** A trava saiu do caminho ou foi abandonada? Assíncrono: roda a sessão inteira. */
async function free(root) {
  const lockPath = path.join(root, LOCK);
  let lockStat;
  try {
    if (!(await fs.promises.lstat(root)).isDirectory()) return false;
    lockStat = await fs.promises.lstat(lockPath);
  } catch (error) { return error.code === "ENOENT" && error.path === lockPath; }
  if (lockStat.mtimeMs < Date.now() - TIMING.staleMs) return true;
  try {
    const ownerPath = path.join(root, OWNER);
    const stat = await fs.promises.lstat(ownerPath);
    if (!stat.isFile() || stat.size > MAX_OWNER_BYTES) return false;
    return ownerGone(parseOwner(await fs.promises.readFile(ownerPath, "utf8")), lockPath, lockStat);
  } catch { return false; }
}

/**
 * Sem isto, a escrita negada na abertura valia pela sessão inteira: o app que abriu
 * logo depois de ser encerrado à força passava o culto somente leitura, com a trava
 * abandonada desde o segundo minuto.
 */
function watch() {
  if (retryTimer || ![...leases.values()].some((s) => s.retry)) return;
  retryTimer = setTimeout(async () => {
    const generation = leasesGeneration;
    for (const [kind, s] of [...leases]) {
      if (!s.retry) continue;
      const available = await free(s.root).catch(() => false);
      if (generation !== leasesGeneration) return;
      if (available && s.retry) open(s, kind);
    }
    retryTimer = null;
    watch();
  }, TIMING.retryMs);
  retryTimer.unref?.();
}

function initialize(layout) {
  release();
  for (const kind of ["media", "videos"]) {
    const s = { root: layout[kind + "Dir"], writable: false, shared: layout[kind + "Shared"] === true, release: null, reason: null, retry: false };
    leases.set(kind, s);
    open(s, kind);
  }
  watch();
}
function state(kind) { return leases.get(kind); }
function canWrite(kind) {
  const s = state(kind);
  if (!s?.writable) return false;
  if (s.release?.isValid()) return true;
  lose(s);
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
  clearTimeout(retryTimer);
  retryTimer = null;
  leasesGeneration++;
  for (const s of leases.values()) {
    try { s.release?.(); } catch { /* lock já encerrado no shutdown */ }
  }
  leases.clear();
}
module.exports = { acquire, initialize, canWrite, canMaintain, assertWritable, assertMaintain, status, release, readMarker, markShared, TIMING };
