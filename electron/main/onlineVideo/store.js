"use strict";

const fs = require("fs-extra");
const path = require("path");
const { isVideoId } = require("./ids.js");
const { setNewCollectionFileModeSync } = require("../sharedCollectionDirs.js");
const { assertPrivateWorkDir } = require("./workDirectory.js");

const PARTIAL_DIR = ".partial";
const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Vídeos prontos ficam na pasta de vídeos configurada; parciais no perfil privado.
 * Downloads automáticos são cache: se sumirem, o app baixa de novo.
 *
 * Um vídeo que o operador mandou manter (`keep`) é a exceção: ele o baixou de
 * propósito para tê-lo pronto, então o despejo por espaço nunca o leva, e ele não
 * conta na cota do cache. A marca é um arquivo `<id>.keep` ao lado do vídeo.
 *
 * @param {string} dir  pasta do cache (criada sob demanda)
 * @param {{ workDir: string, canWrite?: Function, canMaintain?: Function }} options
 */
function createStore(dir, { workDir, shared = false, canWrite = () => true, canMaintain = () => true } = {}) {
  assertPrivateWorkDir(dir, workDir);
  const partialRoot = path.join(workDir, PARTIAL_DIR);

  function regularRoot() {
    try { return fs.lstatSync(dir).isDirectory(); } catch { return false; }
  }

  async function unlinkRegular(file) {
    if (!canWrite() || !regularRoot()) return false;
    try {
      if (!(await fs.lstat(file)).isFile()) return false;
      if (!canWrite()) return false;
      await fs.unlink(file);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  function pathFor(id) {
    if (!isVideoId(id)) throw new Error("ID de vídeo inválido");
    return path.join(dir, `${id}.mp4`);
  }

  function keepPathFor(id) {
    if (!isVideoId(id)) throw new Error("ID de vídeo inválido");
    return path.join(dir, `${id}.keep`);
  }

  function partialDirFor(id) {
    if (!isVideoId(id)) throw new Error("ID de vídeo inválido");
    return path.join(partialRoot, id);
  }

  function has(id) {
    try {
      if (!regularRoot()) return false;
      const stat = fs.lstatSync(pathFor(id));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  /** Manda manter o vídeo baixado. Sem o arquivo do vídeo não há o que manter. */
  function keep(id) {
    if (!canWrite()) return false;
    if (!has(id)) return false;
    try {
      try {
        fs.writeFileSync(keepPathFor(id), "", { flag: "wx" });
        setNewCollectionFileModeSync(keepPathFor(id), { shared });
      } catch (error) {
        if (error.code !== "EEXIST" || !fs.lstatSync(keepPathFor(id)).isFile()) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function isKept(id) {
    try {
      if (!regularRoot()) return false;
      return fs.lstatSync(keepPathFor(id)).isFile();
    } catch {
      return false;
    }
  }

  /** Marca o vídeo como usado agora; o despejo descarta o que foi visto há mais tempo. */
  function touch(id) {
    try {
      if (!canWrite()) return;
      if (!has(id)) return;
      const now = new Date();
      fs.utimesSync(pathFor(id), now, now);
    } catch {
      /* arquivo removido entre o has() e o touch() */
    }
  }

  async function list() {
    if (!regularRoot()) return [];
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const kept = new Set();
    for (const name of names) {
      const k = /^([A-Za-z0-9_-]{11})\.keep$/.exec(name);
      if (k && isKept(k[1])) kept.add(k[1]);
    }
    const out = [];
    for (const name of names) {
      const m = /^([A-Za-z0-9_-]{11})\.mp4$/.exec(name);
      if (!m) continue;
      try {
        const st = await fs.lstat(path.join(dir, name));
        if (st.isFile()) {
          out.push({ id: m[1], size: st.size, usedAt: st.mtimeMs, kept: kept.has(m[1]) });
        }
      } catch {
        /* sumiu durante a listagem */
      }
    }
    return out;
  }

  async function totalSize() {
    return (await list()).reduce((sum, v) => sum + v.size, 0);
  }

  async function remove(id, { downloadOwned = false } = {}) {
    if (!(downloadOwned ? canWrite() : canMaintain())) throw new Error("Esta pasta de vídeos não permite remoção por este perfil.");
    await unlinkRegular(pathFor(id));
    await unlinkRegular(keepPathFor(id));
    await fs.remove(partialDirFor(id));
  }

  async function clear() {
    if (!canMaintain()) throw new Error("Esta pasta de vídeos não permite limpeza por este perfil.");
    const items = await list();
    for (const v of items) {
      await unlinkRegular(pathFor(v.id));
      await unlinkRegular(keepPathFor(v.id));
    }
    await fs.remove(partialRoot);
    return items.length;
  }

  /**
   * Mantém o cache dentro de `maxBytes` descartando os menos usados. O que está
   * em `inUse` (o vídeo que acabou de ser baixado, o que está no ar) nunca sai, e
   * os mantidos ficam de fora da conta: a cota é do cache automático, não do que o
   * operador guardou.
   */
  async function evict({ maxBytes, inUse = [] }) {
    if (!canMaintain()) return [];
    if (!(maxBytes > 0)) return [];
    const protectedIds = new Set(inUse);
    const items = (await list()).filter((v) => !v.kept);
    let total = items.reduce((sum, v) => sum + v.size, 0);
    const removed = [];
    const candidates = items
      .filter((v) => !protectedIds.has(v.id))
      .sort((a, b) => a.usedAt - b.usedAt);
    for (const v of candidates) {
      if (total <= maxBytes) break;
      if (await unlinkRegular(pathFor(v.id))) {
        total -= v.size;
        removed.push(v.id);
      }
    }
    return removed;
  }

  /** Restos de download interrompido: yt-dlp retoma o `.part` no mesmo dia, depois vira lixo. */
  async function sweepPartials(now = Date.now()) {
    let names;
    try {
      if (!(await fs.lstat(partialRoot)).isDirectory()) return 0;
      names = await fs.readdir(partialRoot);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      const full = path.join(partialRoot, name);
      try {
        const st = await fs.lstat(full);
        if (st.isDirectory() && isVideoId(name) && now - st.mtimeMs > PARTIAL_MAX_AGE_MS) {
          await fs.remove(full);
          removed++;
        }
      } catch {
        /* ignore */
      }
    }
    return removed;
  }

  return {
    dir,
    pathFor,
    partialDirFor,
    has,
    keep,
    isKept,
    touch,
    list,
    totalSize,
    remove,
    clear,
    evict,
    sweepPartials,
  };
}

module.exports = { createStore, PARTIAL_MAX_AGE_MS };
