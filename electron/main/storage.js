"use strict";

/**
 * storage.js — Visibilidade e gerenciamento do armazenamento local.
 *
 * Replica o comportamento do Delphi (fmArquivosFalta + fmArquivosExcesso):
 * - stats(): tamanho ocupado por categoria (json, files, total).
 * - clearJson(): limpa cache de JSON do banco.
 * - clearFiles(): limpa toda a pasta de mídia.
 * - clearUnused(remotePaths): remove arquivos locais que não estão na lista
 *   atual do servidor (equivalente a fmArquivosExcesso).
 * - verify(remoteFiles): compara lista do servidor com local — retorna
 *   missing[] e damaged[] (tamanho diferente). Equivalente a
 *   fmArquivosFalta + integrity.diff.
 * - setDataDir(newDir, options): aponta a pasta de dados para outro lugar.
 */

const fs = require("fs-extra");
const path = require("path");
const { shell } = require("electron");
const paths = require("./paths.js");
const { variantsOf } = require("./mediaVariants.js");
const { isSizeAcceptable } = require("./mediaRoots.js");
const mediaResolver = require("./mediaResolver.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _dirSize(dir) {
  if (!(await fs.pathExists(dir))) return { bytes: 0, files: 0 };
  let total = 0;
  let count = 0;
  async function walk(p) {
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(p);
      for (const e of entries) {
        await walk(path.join(p, e));
      }
    } else {
      total += stat.size;
      count += 1;
    }
  }
  await walk(dir);
  return { bytes: total, files: count };
}

async function _listAllFiles(dir) {
  const out = [];
  if (!(await fs.pathExists(dir))) return out;
  async function walk(p, rel) {
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(p);
      for (const e of entries) {
        await walk(path.join(p, e), rel ? `${rel}/${e}` : e);
      }
    } else {
      out.push({ relative: rel, size: stat.size, abs: p });
    }
  }
  await walk(dir, "");
  return out;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Retorna estatísticas de uso do armazenamento.
 * Classifica arquivos JSON do cache em: bible (bible_*), music (album_*, music_*),
 * e json (demais). Media files (mp3/imagens) ficam em files.
 * @returns {Promise<{filesDir: string, jsonDir: string, files: {bytes, count}, json: {bytes, count}, music: {bytes, count}, bible: {bytes, count}, total: {bytes, count}}>}
 */
async function stats() {
  const filesDir = paths.filesDir();
  const jsonDir = paths.jsonCacheDir();
  const filesStat = await _dirSize(filesDir);

  let bibleBytes = 0;
  let bibleCount = 0;
  let musicBytes = 0;
  let musicCount = 0;
  let jsonBytes = 0;
  let jsonCount = 0;

  if (await fs.pathExists(jsonDir)) {
    const allFiles = await _listAllFiles(jsonDir);
    for (const f of allFiles) {
      if (f.relative.startsWith("bible_") && f.relative.endsWith(".json")) {
        bibleBytes += f.size;
        bibleCount += 1;
      } else if (
        (f.relative.startsWith("album_") || f.relative.startsWith("music_")) &&
        f.relative.endsWith(".json")
      ) {
        musicBytes += f.size;
        musicCount += 1;
      } else {
        jsonBytes += f.size;
        jsonCount += 1;
      }
    }
  }

  return {
    dataDir: paths.dataDir(),
    dataDirIssue: paths.dataDirIssue(),
    filesDir,
    jsonDir,
    files: { bytes: filesStat.bytes, count: filesStat.files },
    json: { bytes: jsonBytes, count: jsonCount },
    music: { bytes: musicBytes, count: musicCount },
    bible: { bytes: bibleBytes, count: bibleCount },
    total: {
      bytes: filesStat.bytes + jsonBytes + musicBytes + bibleBytes,
      count: filesStat.files + jsonCount + musicCount + bibleCount,
    },
  };
}

/** Remove todo o cache de JSON. */
async function clearJson() {
  const dir = paths.jsonCacheDir();
  await fs.remove(dir);
  await fs.ensureDir(dir);
  return { ok: true };
}

/** Remove toda a mídia local (mp3, imagens, etc.). */
async function clearFiles() {
  const dir = paths.filesDir();
  await fs.remove(dir);
  await fs.ensureDir(dir);
  return { ok: true };
}

/**
 * Compara lista de arquivos remotos com locais. Retorna:
 * - missing: presentes no servidor, faltam em TODAS as origens de leitura
 * - damaged: presentes na nossa pasta mas com tamanho diferente
 * - extra: presentes na nossa pasta e ausentes da lista do servidor
 *
 * `extra` é a única saída que alimenta remoção (`clearUnused`), e por isso é
 * derivada exclusivamente de `_listAllFiles(filesDir)` — nunca do resolvedor.
 * Um arquivo encontrado no acervo da versão clássica pode deixar de ser
 * `missing`, mas jamais pode virar candidato a apagar: a pasta é de outro
 * programa, que muita gente ainda usa em paralelo.
 *
 * @param {Array<{remote: string, expectedSize?: number}>} remoteFiles
 * @returns {Promise<{missing, damaged, extra}>}
 */
async function verify(remoteFiles = []) {
  const filesDir = paths.filesDir();
  const remoteMap = new Map();
  for (const r of remoteFiles) {
    if (r && r.remote) remoteMap.set(r.remote.replace(/^\/+/, ""), r);
  }

  const local = await _listAllFiles(filesDir);
  const localSet = new Set(local.map((f) => f.relative));

  const missing = [];
  const damaged = [];
  // Locais que satisfazem algum arquivo esperado, inclusive por variante de
  // extensão. Sem isso o acervo antigo em .mp3/.bmp entraria em `extra` e o
  // clearUnused apagaria tudo que o banco agora pede em .opus/.jpg.
  const matched = new Set();

  for (const [rel, item] of remoteMap.entries()) {
    const found = variantsOf(rel).find((c) => localSet.has(c));
    if (!found) {
      // Antes de mandar baixar, olhar as outras origens de leitura: quem tem o
      // acervo da versão clássica configurado já possui o arquivo, e listá-lo
      // como faltando faria a verificação inicial propor rebaixar tudo.
      const achado = await mediaResolver.resolveRead(rel);
      if (!achado) missing.push(item);
      continue;
    }
    matched.add(found);
    // Tamanho só acusa corrupção quando o formato é o mesmo: um .mp3 no lugar
    // de um .opus tem outro tamanho por natureza, e não está danificado.
    if (found === rel && item.expectedSize) {
      const localFile = local.find((f) => f.relative === found);
      if (localFile.size !== item.expectedSize) {
        damaged.push({ ...item, localSize: localFile.size });
      }
    }
  }

  const extra = local
    .filter((f) => !matched.has(f.relative))
    .map((f) => ({ remote: f.relative, localSize: f.size }));

  return { missing, damaged, extra };
}

/**
 * Remove arquivos locais que não estão na lista do servidor (fmArquivosExcesso).
 * @param {Array<{remote: string}>} remoteFiles
 */
async function clearUnused(remoteFiles = []) {
  const { extra } = await verify(remoteFiles);
  const filesDir = paths.filesDir();
  let removed = 0;
  for (const item of extra) {
    try {
      await fs.remove(path.join(filesDir, item.remote));
      removed += 1;
    } catch (_) {
      /* ignore */
    }
  }
  return { removed };
}

/** Abre a pasta de mídia no file explorer do SO. */
async function openFilesDir() {
  const dir = paths.dataDir();
  await fs.ensureDir(dir);
  shell.openPath(dir);
  return { ok: true, dir };
}

/**
 * Aponta a pasta de dados para outro lugar. Com moveExisting=true leva junto
 * o acervo (`files/`) e as preferências (`storage/`).
 *
 * @param {string} newDir
 * @param {object} options { moveExisting?: boolean }
 */
async function setDataDir(newDir, options = {}) {
  const moveExisting = options.moveExisting === true;
  const oldDir = paths.dataDir();
  const abs = path.resolve(newDir);

  await fs.ensureDir(abs);
  if (abs === oldDir) return { ok: true, dir: abs };

  if (moveExisting) {
    for (const sub of ["files", "storage"]) {
      const from = path.join(oldDir, sub);
      if (!(await fs.pathExists(from))) continue;
      // `move` renomeia quando é o mesmo volume — o acervo tem gigabytes e
      // uma cópia byte a byte deixaria o operador esperando à toa.
      await fs.move(from, path.join(abs, sub), { overwrite: true });
    }
  }

  paths.setDataDir(abs);
  return { ok: true, dir: abs };
}

/**
 * Auto-limpeza FIFO quando ultrapassa o limite (em bytes). Remove os
 * arquivos mais antigos primeiro até ficar abaixo do limite.
 *
 * @param {number} maxBytes
 */
/**
 * Remove arquivos de mídia do disco (paths relativos à pasta de mídia).
 * @param {string[]} remoteRelPaths  Ex: ["/config/musicas/Album/x.mp3"]
 * @returns {Promise<{ removed: number }>}
 */
/**
 * Soma o tamanho no disco de uma lista de paths remotos (pasta de mídia).
 * @param {string[]} remoteRelPaths
 * @returns {Promise<{ bytes: number, count: number, missing: number }>}
 */
async function sizeOfPaths(remoteRelPaths = []) {
  let bytes = 0;
  let classicBytes = 0;
  let count = 0;
  let missing = 0;
  const seen = new Set();

  for (const rel of remoteRelPaths) {
    if (typeof rel !== "string" || !rel) continue;
    const cleaned = rel.replace(/^\/+/, "");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);

    try {
      const achado = await mediaResolver.resolveRead(cleaned);
      if (!achado) {
        missing += 1;
        continue;
      }
      const stat = await fs.stat(achado.path);
      // Somado à parte: o que está no acervo da versão clássica ocupa disco,
      // mas remover o álbum não libera esse espaço — é pasta de outro programa.
      if (achado.origin === "classic") classicBytes += stat.size;
      else bytes += stat.size;
      count += 1;
    } catch {
      missing += 1;
    }
  }

  return { bytes, classicBytes, count, missing };
}

async function removeFiles(remoteRelPaths = []) {
  const filesDir = paths.filesDir();
  let removed = 0;
  for (const rel of remoteRelPaths) {
    if (typeof rel !== "string" || !rel) continue;
    const cleaned = rel.replace(/^\/+/, "");
    const localPath = path.resolve(filesDir, cleaned);
    if (!localPath.startsWith(filesDir + path.sep) || localPath === filesDir) {
      continue;
    }
    try {
      // Sem as variantes, remover um álbum deixava para trás o .mp3/.bmp do
      // acervo antigo: o espaço não era liberado e o checkLocal, que aceita
      // variante, seguia marcando o álbum como baixado.
      for (const candidate of variantsOf(localPath)) {
        if (!candidate.startsWith(filesDir + path.sep)) continue;
        if (!(await fs.pathExists(candidate))) continue;
        await fs.remove(candidate);
        removed += 1;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return { removed };
}

/**
 * Verifica existência de arquivos JSON no cache pelas chaves.
 * @param {string[]} keys  Ex: ["bible_13_3_22", "bible_14_1_1"]
 * @returns {Promise<Object<string, boolean>>}
 */
async function checkJsonExists(keys = []) {
  const jsonDir = paths.jsonCacheDir();
  const out = {};
  for (const key of keys) {
    if (typeof key !== "string") { out[key] = false; continue; }
    const filePath = path.resolve(jsonDir, `${key}.json`);
    if (!filePath.startsWith(jsonDir + path.sep)) {
      out[key] = false;
      continue;
    }
    try {
      out[key] = await fs.pathExists(filePath);
    } catch {
      out[key] = false;
    }
  }
  return out;
}

/** Remove arquivos JSON do cache que começam com um prefixo. */
async function removeJsonByPrefix(prefix = "") {
  if (!prefix) return { removed: 0 };
  const jsonDir = paths.jsonCacheDir();
  let removed = 0;
  if (await fs.pathExists(jsonDir)) {
    const allFiles = await _listAllFiles(jsonDir);
    for (const f of allFiles) {
      if (f.relative.startsWith(prefix)) {
        try {
          await fs.remove(f.abs);
          removed += 1;
        } catch (_) { /* ignore */ }
      }
    }
  }
  return { removed };
}

async function enforceQuota(maxBytes) {
  if (!maxBytes || maxBytes <= 0) return { removed: 0 };
  const filesDir = paths.filesDir();
  const list = await _listAllFiles(filesDir);
  let total = list.reduce((s, f) => s + f.size, 0);
  if (total <= maxBytes) return { removed: 0, total };

  // Ordena por mtime (mais antigo primeiro)
  const withMtime = await Promise.all(
    list.map(async (f) => {
      const stat = await fs.stat(f.abs);
      return { ...f, mtime: stat.mtimeMs };
    })
  );
  withMtime.sort((a, b) => a.mtime - b.mtime);

  let removed = 0;
  for (const f of withMtime) {
    if (total <= maxBytes) break;
    try {
      await fs.remove(f.abs);
      total -= f.size;
      removed += 1;
    } catch (_) {
      /* ignore */
    }
  }
  return { removed, total };
}

module.exports = {
  stats,
  clearJson,
  clearFiles,
  clearUnused,
  verify,
  sizeOfPaths,
  removeFiles,
  checkJsonExists,
  removeJsonByPrefix,
  openFilesDir,
  setDataDir,
  enforceQuota,
};
