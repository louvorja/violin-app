"use strict";

/**
 * Pasta da igreja: programas do culto e modelos do Modo apresentação gravados
 * numa pasta compartilhada na nuvem (OneDrive…), para o programa montado em
 * casa aparecer pronto no computador da igreja.
 *
 *   <pasta>/LouvorJA/programas/AAAA-MM-DD.json
 *   <pasta>/LouvorJA/modelos/<nome>.json
 *
 * O renderer escolhe a pasta (preferência deste computador) e manda o
 * documento inteiro; aqui só se confere nome, tamanho e forma, e se grava de
 * forma atômica. Duas proteções contra perder trabalho de outro computador:
 * - `expectMtime`: a gravação só acontece se o arquivo no disco ainda for o
 *   que o renderer leu — senão volta `changed` e ele decide;
 * - cópias em conflito do sincronizador (`2026-10-10-IGREJA-PC.json`) são
 *   listadas para o operador escolher qual vale.
 */

const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const BASE = "LouvorJA";
const DIRS = { program: "programas", model: "modelos" };
const NAME_RE = { program: /^\d{4}-\d{2}-\d{2}$/, model: /^[a-z0-9][a-z0-9-]{0,39}$/ };
const MAX_BYTES = 2 * 1024 * 1024;

function validRoot(root) {
  return typeof root === "string" && root.length > 0 && path.isAbsolute(root);
}

function validTarget(kind, name) {
  return Object.prototype.hasOwnProperty.call(DIRS, kind) && typeof name === "string" && NAME_RE[kind].test(name);
}

const dirOf = (root, kind) => path.join(root, BASE, DIRS[kind]);
const fileOf = (root, kind, name) => path.join(dirOf(root, kind), `${name}.json`);

/** As cópias que o OneDrive (`-PC`), o Dropbox/Drive (`(…)`) e o iCloud (` 2`) criam num conflito. */
function conflictRe(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?:-[\\w.-]+| \\(.+\\)| \\d+)\\.json$`, "i");
}

async function mtimeOf(file) {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function conflictNames(root, kind, name) {
  try {
    const re = conflictRe(name);
    return (await fs.readdir(dirOf(root, kind))).filter((n) => re.test(n));
  } catch {
    return [];
  }
}

/** `undefined`: não existe; `null`: existe mas não deu para ler (meio sincronizado, corrompido). */
async function readJson(file) {
  if (!(await fs.pathExists(file))) return undefined;
  try {
    const doc = await fs.readJson(file);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** Uma fila por arquivo: conferir e gravar não se intercala com outra gravação. */
const queues = new Map();
function serialize(key, task) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Existe? Quando mudou? Há cópias em conflito? Barato: é o que o renderer consulta de tempos em tempos. */
async function stat(root, kind, name) {
  if (!validRoot(root) || !validTarget(kind, name)) return { ok: false, error: "invalid" };
  if (!(await fs.pathExists(root))) return { ok: false, error: "missing_root" };
  const mtimeMs = await mtimeOf(fileOf(root, kind, name));
  return { ok: true, exists: mtimeMs !== null, mtimeMs, conflicts: await conflictNames(root, kind, name) };
}

async function read(root, kind, name) {
  if (!validRoot(root) || !validTarget(kind, name)) return { ok: false, error: "invalid" };
  if (!(await fs.pathExists(root))) return { ok: false, error: "missing_root" };
  const file = fileOf(root, kind, name);
  const doc = await readJson(file);
  if (doc === null) return { ok: false, error: "unreadable" };
  return { ok: true, doc: doc ?? null, mtimeMs: await mtimeOf(file) };
}

/**
 * Grava o documento. Com `expectMtime` (número, ou `null` para "não existia"),
 * só grava se o disco ainda estiver como o renderer o viu.
 */
function write(root, kind, name, doc, opts = {}) {
  if (!validRoot(root) || !validTarget(kind, name)) return Promise.resolve({ ok: false, error: "invalid" });
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return Promise.resolve({ ok: false, error: "invalid" });
  let text;
  try {
    text = JSON.stringify(doc, null, 2);
  } catch {
    return Promise.resolve({ ok: false, error: "invalid" });
  }
  if (Buffer.byteLength(text) > MAX_BYTES) return Promise.resolve({ ok: false, error: "too_large" });
  const target = fileOf(root, kind, name);
  return serialize(target, async () => {
    if (!(await fs.pathExists(root))) return { ok: false, error: "missing_root" };
    if (opts && "expectMtime" in opts) {
      const current = await mtimeOf(target);
      if (current !== opts.expectMtime) return { ok: false, error: "changed", mtimeMs: current };
    }
    await fs.ensureDir(path.dirname(target));
    const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, text);
    await fs.move(tmp, target, { overwrite: true });
    return { ok: true, mtimeMs: await mtimeOf(target) };
  });
}

/** Os nomes gravados (sem as cópias em conflito), do mais recente ao mais antigo por nome. */
async function list(root, kind) {
  if (!validRoot(root) || !Object.prototype.hasOwnProperty.call(DIRS, kind)) return { ok: false, error: "invalid" };
  try {
    const names = (await fs.readdir(dirOf(root, kind)))
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))
      .filter((n) => NAME_RE[kind].test(n))
      .sort()
      .reverse();
    return { ok: true, names };
  } catch {
    return { ok: true, names: [] };
  }
}

/** As cópias em conflito, com o conteúdo, para o operador comparar. */
async function conflicts(root, kind, name) {
  if (!validRoot(root) || !validTarget(kind, name)) return { ok: false, error: "invalid" };
  const out = [];
  for (const file of await conflictNames(root, kind, name)) {
    const full = path.join(dirOf(root, kind), file);
    out.push({ file, doc: (await readJson(full)) ?? null, mtimeMs: await mtimeOf(full) });
  }
  return { ok: true, copies: out };
}

/**
 * Fica com uma versão e apaga as cópias. `keep`: `"main"` (o arquivo principal)
 * ou o nome de uma das cópias, que passa a ser o principal.
 */
function resolve(root, kind, name, keep) {
  if (!validRoot(root) || !validTarget(kind, name)) return Promise.resolve({ ok: false, error: "invalid" });
  const target = fileOf(root, kind, name);
  return serialize(target, async () => {
    const copies = await conflictNames(root, kind, name);
    if (keep !== "main") {
      if (typeof keep !== "string" || !copies.includes(keep)) return { ok: false, error: "invalid" };
      await fs.copy(path.join(dirOf(root, kind), keep), target, { overwrite: true });
    }
    await Promise.all(copies.map((c) => fs.remove(path.join(dirOf(root, kind), c)).catch(() => {})));
    return { ok: true, mtimeMs: await mtimeOf(target) };
  });
}

let _computerName = null;
/**
 * O nome deste computador, para "salvo no computador X": o que o sistema
 * mostra ao usuário (macOS: Compartilhamento; Windows: COMPUTERNAME). O
 * hostname de rede às vezes é só um IP.
 */
function computerName() {
  if (_computerName) return _computerName;
  let name = "";
  if (process.platform === "darwin") {
    try {
      name = execFileSync("scutil", ["--get", "ComputerName"], { timeout: 2000, encoding: "utf8" }).trim();
    } catch {
      name = "";
    }
  } else if (process.platform === "win32") {
    name = process.env.COMPUTERNAME || "";
  }
  _computerName = name || os.hostname().replace(/\.local$/i, "");
  return _computerName;
}

module.exports = { stat, read, write, list, conflicts, resolve, computerName, conflictRe, BASE, DIRS };
