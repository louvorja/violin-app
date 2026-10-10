"use strict";

/**
 * Histórico de uma série de vídeos (Momento Saúde, Provai e Vede…), gravado
 * dentro da própria pasta da série, ao lado dos vídeos.
 *
 * A pasta costuma estar numa pasta compartilhada na nuvem (OneDrive, Google
 * Drive, iCloud…): o histórico vai junto com os vídeos para todo computador
 * que a usa. Por isso o renderer não manda o documento — manda uma operação
 * ("passou o vídeo X", "recomeçar"), que é aplicada aqui sobre o que está no
 * disco agora. Uma cópia velha em memória nunca desfaz o que outro computador
 * gravou, e as gravações de uma mesma pasta vão em fila.
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const FILE_NAME = ".louvorja-serie.json";
/**
 * Cópias que o sincronizador cria quando dois computadores gravam antes de
 * sincronizar: o OneDrive acrescenta o nome do computador (`-IGREJA-PC`), o
 * Dropbox e o Google Drive um parêntese (`(cópia em conflito…)`, `(1)`), o
 * iCloud um número (` 2`).
 */
const CONFLICT_RE = /^\.louvorja-serie(?:-[\w.-]+| \(.+\)| \d+)\.json$/i;
const MAX_PLAYS = 5000;
const ON_END = new Set(["restart", "suggest_new"]);
/** Os mesmos de `src/constants/FileTypes.ts` (vídeo e imagem) — um teste confere. */
const MEDIA_EXT = new Set([
  "mp4", "webm", "mkv", "mov", "avi", "m4v",
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "heic", "heif",
]);

function validDir(dir) {
  return typeof dir === "string" && dir.length > 0 && path.isAbsolute(dir);
}

const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const nowIso = () => new Date().toISOString();

/** Só o que o formato conhece, com tipos conferidos: o arquivo pode ter sido editado à mão. */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const plays = (Array.isArray(raw.plays) ? raw.plays : [])
    .filter((p) => p && typeof p.id === "string" && typeof p.file === "string" && typeof p.at === "string")
    .slice(-MAX_PLAYS)
    .map((p) => ({
      id: str(p.id, 64),
      file: str(p.file, 500),
      at: str(p.at, 40),
      cycle: Number.isSafeInteger(p.cycle) && p.cycle > 0 ? p.cycle : 1,
      ...(p.undone === true ? { undone: true } : {}),
    }));
  return {
    version: 1,
    active: raw.active !== false,
    name: str(raw.name, 120),
    onEnd: ON_END.has(raw.onEnd) ? raw.onEnd : "restart",
    cycle: Number.isSafeInteger(raw.cycle) && raw.cycle > 0 ? raw.cycle : 1,
    // Configurações têm data própria: registrar um vídeo não as "renova".
    settingsAt: str(raw.settingsAt ?? raw.updatedAt, 40),
    plays,
  };
}

/** Junta duas versões (cópias em conflito): nenhuma exibição se perde, e desmarcar vence. */
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const byId = new Map();
  for (const p of [...a.plays, ...b.plays]) {
    const known = byId.get(p.id);
    byId.set(p.id, known ? { ...known, ...(p.undone || known.undone ? { undone: true } : {}) } : p);
  }
  const plays = [...byId.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-MAX_PLAYS);
  const settings = b.settingsAt >= a.settingsAt ? b : a;
  return { ...settings, cycle: Math.max(a.cycle, b.cycle), plays };
}

/** `undefined`: não existe; `null`: existe mas não deu para ler (meio sincronizado, corrompido). */
async function readFile(dir, name = FILE_NAME) {
  const file = path.join(dir, name);
  if (!(await fs.pathExists(file))) return undefined;
  try {
    return normalize(await fs.readJson(file)) ?? null;
  } catch {
    return null;
  }
}

async function writeFile(dir, doc) {
  const target = path.join(dir, FILE_NAME);
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeJson(tmp, doc, { spaces: 2 });
  await fs.move(tmp, target, { overwrite: true });
}

/** Uma fila por pasta: ler → aplicar → gravar não se intercala com outra gravação. */
const queues = new Map();
function serialize(dir, task) {
  const key = path.resolve(dir);
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function conflictNames(dir) {
  try {
    return (await fs.readdir(dir)).filter((n) => n !== FILE_NAME && CONFLICT_RE.test(n));
  } catch {
    return [];
  }
}

/** Vídeos e imagens da pasta, que é o que a série percorre. */
async function mediaFiles(dir) {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => !n.startsWith(".") && MEDIA_EXT.has(path.extname(n).slice(1).toLowerCase()));
  } catch {
    return [];
  }
}

function playedInCycle(doc) {
  return new Set(doc.plays.filter((p) => !p.undone && p.cycle === doc.cycle).map((p) => p.file));
}

/**
 * Aplica uma operação ao histórico do disco.
 * - `create {name, onEnd}` — a pasta vira série (o histórico antigo, se houver, continua).
 * - `settings {name?, onEnd?, active?}`
 * - `play {file}` — passou; com todos passados e `onEnd: "restart"`, já abre o ciclo seguinte.
 * - `undo {file}` — passou por engano.
 * - `restart {fromCycle}` — novo ciclo; só se ninguém recomeçou antes.
 */
function applyOp(doc, op, files) {
  const at = nowIso();
  switch (op.type) {
    case "create":
    case "settings": {
      const base = doc ?? normalize({ cycle: 1, plays: [] });
      return {
        ...base,
        active: op.type === "create" ? true : (op.active ?? base.active),
        name: op.name !== undefined ? str(op.name, 120) : base.name,
        onEnd: ON_END.has(op.onEnd) ? op.onEnd : base.onEnd,
        settingsAt: at,
      };
    }
    case "play": {
      if (!doc) return null;
      const next = {
        ...doc,
        plays: [...doc.plays, { id: crypto.randomUUID(), file: str(op.file, 500), at, cycle: doc.cycle }],
      };
      const played = playedInCycle(next);
      const complete = files.length > 0 && files.every((f) => played.has(f));
      return complete && next.onEnd === "restart" ? { ...next, cycle: next.cycle + 1 } : next;
    }
    case "undo":
      if (!doc) return null;
      return {
        ...doc,
        plays: doc.plays.map((p) =>
          p.file === op.file && p.cycle === doc.cycle && !p.undone ? { ...p, undone: true } : p
        ),
      };
    case "restart":
      if (!doc) return null;
      return op.fromCycle === doc.cycle ? { ...doc, cycle: doc.cycle + 1 } : doc;
    default:
      return null;
  }
}

/** O que o operador precisa para escolher uma versão: quando mudou, quantos passaram, o último. */
async function describe(dir, name) {
  const doc = await readFile(dir, name);
  if (!doc) return null;
  let modifiedAt = doc.settingsAt;
  try {
    modifiedAt = (await fs.stat(path.join(dir, name))).mtime.toISOString();
  } catch {
    /* fica a data gravada no próprio histórico */
  }
  const valid = doc.plays.filter((p) => !p.undone);
  const last = valid.reduce((acc, p) => (!acc || p.at > acc.at ? p : acc), null);
  return {
    name,
    main: name === FILE_NAME,
    modifiedAt,
    plays: valid.length,
    lastPlay: last ? { file: last.file, at: last.at } : null,
  };
}

/**
 * @param {unknown} dir pasta da série (caminho absoluto)
 * @returns `series: null` quando a pasta não é série; `versions` só com cópias em conflito.
 */
async function read(dir) {
  if (!validDir(dir)) return { ok: false, error: "invalid_path" };
  const series = await readFile(dir);
  if (series === null) return { ok: false, error: "unreadable" };
  const conflicts = await conflictNames(dir);
  const versions = conflicts.length
    ? (await Promise.all([FILE_NAME, ...conflicts].map((n) => describe(dir, n)))).filter(Boolean)
    : [];
  return { ok: true, series: series ?? null, versions };
}

/** @param {unknown} dir @param {unknown} op */
function apply(dir, op) {
  if (!validDir(dir)) return Promise.resolve({ ok: false, error: "invalid_path" });
  if (!op || typeof op !== "object" || typeof op.type !== "string") {
    return Promise.resolve({ ok: false, error: "invalid_op" });
  }
  return serialize(dir, async () => {
    try {
      if (!(await fs.stat(dir)).isDirectory()) return { ok: false, error: "not_a_folder" };
      const disk = await readFile(dir);
      // Arquivo ilegível (meio sincronizado): gravar por cima apagaria o histórico.
      if (disk === null) return { ok: false, error: "unreadable" };
      const files = op.type === "play" ? await mediaFiles(dir) : [];
      const next = applyOp(disk ?? null, op, files);
      if (!next) return { ok: false, error: "not_a_series" };
      await writeFile(dir, next);
      return { ok: true, series: next };
    } catch (e) {
      return { ok: false, error: e && e.code === "ENOENT" ? "not_found" : "unwritable" };
    }
  });
}

/**
 * Resolve o conflito: `"merge"` junta todas as versões; um nome usa só aquela.
 * Só saem da pasta as cópias que foram lidas — uma cópia que o sincronizador
 * ainda não terminou de baixar fica, e volta a aparecer depois.
 */
function resolve(dir, choice) {
  if (!validDir(dir)) return Promise.resolve({ ok: false, error: "invalid_path" });
  return serialize(dir, async () => {
    const conflicts = await conflictNames(dir);
    const names = [FILE_NAME, ...conflicts];
    if (choice !== "merge" && !names.includes(choice)) return { ok: false, error: "invalid_choice" };
    const read = await Promise.all(names.map(async (name) => ({ name, doc: await readFile(dir, name) })));
    const usable = read.filter((r) => r.doc);
    const result =
      choice === "merge"
        ? usable.reduce((acc, r) => merge(acc, r.doc), null)
        : usable.find((r) => r.name === choice)?.doc;
    if (!result) return { ok: false, error: "unreadable" };
    try {
      await writeFile(dir, result);
      const removable = usable.map((r) => r.name).filter((n) => n !== FILE_NAME);
      await Promise.all(removable.map((n) => fs.remove(path.join(dir, n))));
      const pending = read.filter((r) => r.doc === null).length;
      return { ok: true, series: result, ...(pending ? { partial: pending } : {}) };
    } catch {
      return { ok: false, error: "unwritable" };
    }
  });
}

module.exports = { read, apply, resolve, merge, normalize, applyOp, FILE_NAME, CONFLICT_RE, MEDIA_EXT };
