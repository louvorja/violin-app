"use strict";

/**
 * storage.js — Visibilidade e gerenciamento do armazenamento local.
 *
 * Replica o comportamento do Delphi (fmArquivosFalta + fmArquivosExcesso):
 * - stats(): tamanho ocupado por categoria (json, files, canva, total).
 * - clearJson(): limpa cache de JSON do banco.
 * - clearFiles(): limpa o acervo de mídia (o cache do Canva fica).
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
const { DATA_ENTRIES } = require("./dataMigration.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Subpasta de `files/` com o cache de export do Canva (ver
 * `main/canva/export.js`). Não é acervo do operador: tem contagem própria na
 * tela de Armazenamento e não é candidato a limpeza automática.
 */
const CANVA_DIR = "canva";

/** O caminho relativo (com `/`) pertence ao cache do Canva? */
function _ehCacheCanva(relative) {
  return relative === CANVA_DIR || relative.startsWith(`${CANVA_DIR}/`);
}

/**
 * Arquivos de `files/` que são ACERVO — o cache do Canva fica de fora.
 *
 * É o que alimenta `extra` (e portanto remoção) em `verify`: arquivo do Canva
 * não é mídia que o operador possa ter perdido, e não pode virar candidato a
 * apagar por não estar na lista do servidor.
 */
async function _arquivosDeAcervo(filesDir) {
  return (await _listAllFiles(filesDir)).filter((f) => !_ehCacheCanva(f.relative));
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
 * e json (demais). Media files (mp3/imagens) ficam em files; o cache de export do
 * Canva (files/canva) sai do acervo e vira categoria própria.
 * @returns {Promise<{filesDir: string, jsonDir: string, files: {bytes, count}, canva: {bytes, count}, json: {bytes, count}, music: {bytes, count}, bible: {bytes, count}, total: {bytes, count}}>}
 */
async function stats() {
  const filesDir = paths.filesDir();
  const jsonDir = paths.jsonCacheDir();

  /*
   * Um walk só para as duas categorias de `files/`. Acervo e cache do Canva
   * são coisas diferentes para quem opera — um é o acervo dele, o outro é o
   * que o app baixou para projetar sem internet — e têm botões de limpar
   * diferentes também.
   */
  let mediaBytes = 0;
  let mediaCount = 0;
  let canvaBytes = 0;
  let canvaCount = 0;
  for (const arquivo of await _listAllFiles(filesDir)) {
    if (_ehCacheCanva(arquivo.relative)) {
      canvaBytes += arquivo.size;
      /*
       * Conta a mídia, não o meta: `<id>.pdf.json` é metade de um cache só, e
       * contar os dois diria "3 arquivos" para 2 apresentações.
       */
      if (!arquivo.relative.endsWith(".json")) canvaCount += 1;
    } else {
      mediaBytes += arquivo.size;
      mediaCount += 1;
    }
  }

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
    restartRequired: paths.profileRestartRequired(),
    filesDir,
    jsonDir,
    files: { bytes: mediaBytes, count: mediaCount },
    canva: { bytes: canvaBytes, count: canvaCount },
    json: { bytes: jsonBytes, count: jsonCount },
    music: { bytes: musicBytes, count: musicCount },
    bible: { bytes: bibleBytes, count: bibleCount },
    total: {
      bytes: mediaBytes + canvaBytes + jsonBytes + musicBytes + bibleBytes,
      count: mediaCount + canvaCount + jsonCount + musicCount + bibleCount,
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

/**
 * Remove o acervo local (mp3, imagens, etc.).
 *
 * O cache de export do Canva (files/canva) fica: não é acervo do operador, tem
 * contagem e botão próprios na tela de Armazenamento, e apagá-lo por uma ação
 * que promete outra coisa faria o próximo clique reexportar gastando cota.
 */
async function clearFiles() {
  const dir = paths.filesDir();
  let entradas = [];
  try {
    entradas = await fs.readdir(dir);
  } catch (_) {
    /* Pasta que não existe é acervo vazio. */
    entradas = [];
  }
  for (const nome of entradas) {
    if (nome === CANVA_DIR) continue;
    try {
      await fs.remove(path.join(dir, nome));
    } catch (_) {
      /* Ignora arquivo travado: o resto do acervo ainda sai. */
    }
  }
  /* A pasta continua existindo depois de limpar, como antes. */
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
 * derivada exclusivamente do acervo real em `files/` — nem do resolvedor, nem
 * do cache de export do Canva. Um arquivo encontrado no acervo da versão
 * clássica pode deixar de ser `missing`, mas jamais pode virar candidato a
 * apagar: a pasta é de outro programa, que muita gente ainda usa em paralelo.
 * O mesmo vale para o Canva: PDF exportado não está na lista do servidor e,
 * sem a exclusão, todo o cache seria removido como "sobra".
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

  const local = await _arquivosDeAcervo(filesDir);
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
 * o acervo (`files/`), as preferências (`storage/`), os documentos (`library/`)
 * e os vídeos baixados (`Videos/`).
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
    // Nunca misture duas instalações nem mova uma raiz para dentro da outra.
    // Resolva links antes de comparar, pois o seletor também aceita aliases.
    const [sourceRoot, targetRoot] = await Promise.all([fs.realpath(oldDir), fs.realpath(abs)]);
    if (sourceRoot === targetRoot) return { ok: true, dir: oldDir };
    if (sourceRoot.startsWith(targetRoot + path.sep) || targetRoot.startsWith(sourceRoot + path.sep)) {
      throw new Error("A nova pasta de dados não pode conter a atual nem estar dentro dela.");
    }

    const moves = [];
    // O perfil está aberto pelo Chromium: muda no próximo boot, depois de fechar.
    if (await fs.pathExists(path.join(abs, ".electron"))) {
      throw new Error('A pasta de destino já contém ".electron". Escolha uma pasta sem dados existentes.');
    }
    for (const sub of DATA_ENTRIES.flatMap((name) => name.endsWith(".json") ? [name, `${name}.bak`, `${name}.tmp`] : [name])) {
      const from = path.join(oldDir, sub);
      if (!(await fs.pathExists(from))) continue;
      const to = path.join(abs, sub);
      if (await fs.pathExists(to)) {
        throw new Error(`A pasta de destino já contém "${sub}". Escolha uma pasta sem dados existentes.`);
      }
      moves.push({ from, to });
    }

    const completed = [];
    try {
      for (const move of moves) {
        // Rename no mesmo volume; nunca sobrescreva conteúdo que apareceu
        // depois da verificação acima (por exemplo, sincronização em nuvem).
        await fs.move(move.from, move.to, { overwrite: false });
        completed.push(move);
      }
      paths.setDataDir(abs, { moveExisting: true });
    } catch (error) {
      const failures = [];
      for (const move of completed.reverse()) {
        try {
          await fs.move(move.to, move.from, { overwrite: false });
        } catch (rollbackError) {
          failures.push(new Error(`Não foi possível restaurar ${move.to} para ${move.from}: ${rollbackError.message}`));
        }
      }
      if (failures.length) {
        throw new AggregateError([error, ...failures], "Falha ao mudar a pasta de dados; alguns arquivos permanecem no destino. " + failures.map((failure) => failure.message).join("; "));
      }
      throw error;
    }
    return { ok: true, dir: abs };
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
  /*
   * Só o acervo entra na conta e na fila de remoção: o cache de export do
   * Canva descartado por idade forçaria uma reexportação (gasta cota do Canva)
   * sem o operador ter pedido nada. Ele sai pelos selos da aba Canva ou pelo
   * botão próprio em Armazenamento.
   */
  const list = await _arquivosDeAcervo(filesDir);
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
