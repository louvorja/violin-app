"use strict";

/**
 * fileActions.js — o que o operador faz com um arquivo da biblioteca do Modo
 * apresentação: renomear, não mostrar (ocultar), mover para a Lixeira e
 * mostrar no Finder/Explorer.
 *
 * Só arquivos, nunca pastas: apagar ou renomear uma pasta da igreja por um
 * clique errado no meio do culto custaria caro demais.
 *
 * A marca de "não mostrar" fica na própria pasta (`.louvorja-ocultos.json`),
 * como o histórico das séries: a pasta costuma estar no OneDrive/iCloud, e
 * ocultar num computador vale nos outros que sincronizam com ela.
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const HIDDEN_FILE = ".louvorja-ocultos.json";
const MAX_HIDDEN = 5000;
/** Caracteres que algum dos sistemas (Windows, macOS) não aceita num nome. */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

function validPath(p) {
  return typeof p === "string" && p.length > 0 && path.isAbsolute(p);
}

async function isFile(p) {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/* ─── Ocultos ─── */

/** Os nomes ocultos da pasta. Arquivo ilegível ou ausente: nenhum. */
async function readHidden(dir) {
  try {
    const raw = await fs.readJson(path.join(dir, HIDDEN_FILE));
    const list = Array.isArray(raw?.hidden) ? raw.hidden : [];
    return new Set(list.filter((n) => typeof n === "string").slice(0, MAX_HIDDEN));
  } catch {
    return new Set();
  }
}

async function writeHidden(dir, names) {
  const target = path.join(dir, HIDDEN_FILE);
  if (!names.size) {
    await fs.remove(target);
    return;
  }
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeJson(tmp, { version: 1, hidden: [...names].sort() }, { spaces: 2 });
  await fs.move(tmp, target, { overwrite: true });
}

/** Uma fila por pasta: ler → mudar → gravar não se intercala com outra gravação. */
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

/** Muda a marca de um nome; `to: null` só tira (o arquivo saiu da pasta). */
function updateHidden(dir, name, change) {
  return serialize(dir, async () => {
    const names = await readHidden(dir);
    const had = names.has(name);
    const next = change(names, had);
    if (next === null) return;
    await writeHidden(dir, next);
  });
}

/** @param {unknown} filePath @param {unknown} hidden */
async function setHidden(filePath, hidden) {
  if (!validPath(filePath) || typeof hidden !== "boolean") return { ok: false, error: "invalid_path" };
  if (!(await isFile(filePath))) return { ok: false, error: "not_found" };
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  try {
    await updateHidden(dir, name, (names, had) => {
      if (had === hidden) return null;
      if (hidden) names.add(name);
      else names.delete(name);
      return names;
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "unwritable" };
  }
}

/* ─── Renomear ─── */

/**
 * Valida o nome novo: sem barra nem caractere proibido, sem começar com ponto
 * (viraria arquivo oculto do sistema) e com a mesma extensão — trocar a
 * extensão mudaria o tipo e o arquivo sumiria da grade.
 */
function checkName(oldName, newName) {
  if (typeof newName !== "string") return "invalid_name";
  const name = newName.trim();
  if (!name || name === "." || name === ".." || name.startsWith(".") || name.length > 255) return "invalid_name";
  if (BAD_NAME.test(name)) return "invalid_name";
  if (path.extname(name).toLowerCase() !== path.extname(oldName).toLowerCase()) return "extension_changed";
  return null;
}

/**
 * @param {unknown} filePath arquivo atual
 * @param {unknown} newName só o nome, com a extensão
 * @param {{ renameInSeries?: (dir: string, from: string, to: string) => Promise<unknown> }} [deps]
 */
async function rename(filePath, newName, deps = {}) {
  if (!validPath(filePath)) return { ok: false, error: "invalid_path" };
  if (!(await isFile(filePath))) return { ok: false, error: "not_found" };
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const error = checkName(oldName, newName);
  if (error) return { ok: false, error };
  const name = newName.trim();
  if (name === oldName) return { ok: true, path: filePath, name };
  const target = path.join(dir, name);
  // Só maiúsculas/minúsculas: no macOS e no Windows o "outro" é o mesmo arquivo.
  const sameFile = name.toLowerCase() === oldName.toLowerCase();
  if (!sameFile && (await fs.pathExists(target))) return { ok: false, error: "exists" };
  try {
    await fs.rename(filePath, target);
  } catch (e) {
    return { ok: false, error: e && e.code === "ENOENT" ? "not_found" : "unwritable" };
  }
  // O que a pasta guarda sobre o arquivo segue o nome novo.
  try {
    await updateHidden(dir, oldName, (names, had) => {
      if (!had) return null;
      names.delete(oldName);
      names.add(name);
      return names;
    });
  } catch {
    /* a marca é conveniência: o arquivo já foi renomeado */
  }
  if (deps.renameInSeries) {
    try {
      await deps.renameInSeries(dir, oldName, name);
    } catch {
      /* idem: o histórico da série volta a reconhecer quando o operador marcar de novo */
    }
  }
  return { ok: true, path: target, name };
}

/* ─── Lixeira e Finder ─── */

/**
 * @param {unknown} filePath
 * @param {{ trashItem: (p: string) => Promise<void> }} shell o `shell` do Electron (injetado nos testes)
 */
async function trash(filePath, shell) {
  if (!validPath(filePath)) return { ok: false, error: "invalid_path" };
  if (!(await isFile(filePath))) return { ok: false, error: "not_found" };
  try {
    await shell.trashItem(filePath);
  } catch {
    return { ok: false, error: "trash_failed" };
  }
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  try {
    await updateHidden(dir, name, (names, had) => {
      if (!had) return null;
      names.delete(name);
      return names;
    });
  } catch {
    /* a marca de um arquivo que não existe mais não atrapalha */
  }
  return { ok: true };
}

/** @param {unknown} filePath @param {{ showItemInFolder: (p: string) => void }} shell */
async function reveal(filePath, shell) {
  if (!validPath(filePath)) return { ok: false, error: "invalid_path" };
  if (!(await fs.pathExists(filePath))) return { ok: false, error: "not_found" };
  shell.showItemInFolder(filePath);
  return { ok: true };
}

module.exports = { HIDDEN_FILE, readHidden, setHidden, rename, trash, reveal, checkName };
