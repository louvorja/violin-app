"use strict";

/**
 * docStore.js — Documentos do usuário em arquivos JSON dentro da pasta de dados.
 *
 * Guarda uma coleção por arquivo em `<dados>/library/<colecao>.json`: as
 * liturgias salvas, as playlists, as coletâneas personalizadas, os itens
 * agendados. É o que distingue documento de cache — o cache o app rebaixa
 * sozinho da internet, isto aqui o operador montou à mão e não se refaz.
 *
 * Antes tudo isso morava no IndexedDB do renderer, dentro do userData: não
 * acompanhava a pasta de dados, não entrava num backup dela e o main sequer
 * enxergava. Trocar de máquina perdia a biblioteca inteira em silêncio.
 *
 * Escreve em lote e de forma atômica, pelos mesmos motivos do userStore: a
 * pasta costuma estar dentro do OneDrive ou do iCloud.
 */

const fs = require("fs-extra");
const path = require("path");
const paths = require("./paths.js");

/** Nome de coleção seguro para virar nome de arquivo. */
const NAME_RE = /^[a-zA-Z0-9_.-]+$/;

function validateName(colecao) {
  if (typeof colecao !== "string" || !colecao || !NAME_RE.test(colecao) || colecao.includes("..")) {
    throw new Error(`docStore: coleção inválida: ${JSON.stringify(colecao)}`);
  }
}

function libraryDir() {
  return path.join(paths.dataDir(), "library");
}

function filePath(colecao) {
  return path.join(libraryDir(), `${colecao}.json`);
}

/** Documentos de uma coleção. Lista vazia quando ela ainda não existe. */
function read(colecao) {
  validateName(colecao);
  const file = filePath(colecao);
  try {
    if (!fs.existsSync(file)) return [];
    const docs = fs.readJsonSync(file);
    return Array.isArray(docs) ? docs : [];
  } catch (e) {
    console.warn(`[docStore] read("${colecao}") falhou:`, e.message);
    return [];
  }
}

/** Coleções já gravadas. */
function list() {
  try {
    return fs
      .readdirSync(libraryDir())
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5));
  } catch (_) {
    return [];
  }
}

const _pendentes = new Map();
let _flushTimer = null;

function _grava(colecao, docs) {
  const file = filePath(colecao);
  const tmp = `${file}.tmp`;
  fs.ensureDirSync(libraryDir());
  try {
    fs.writeJsonSync(tmp, docs, { spaces: 2 });
    try {
      fs.renameSync(tmp, file);
    } catch (_) {
      fs.moveSync(tmp, file, { overwrite: true });
    }
  } catch (e) {
    try {
      fs.removeSync(tmp);
    } catch (_) {
      /* ignorar */
    }
    throw e;
  }
}

/** Grava o que estiver pendente. Chamado pela janela de lote e no encerramento. */
function flush() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  for (const [colecao, docs] of _pendentes) {
    try {
      _grava(colecao, docs);
    } catch (e) {
      console.warn(`[docStore] write("${colecao}") falhou:`, e.message);
    }
  }
  _pendentes.clear();
}

/**
 * Substitui a coleção inteira. São dezenas de itens de alguns KB — reescrever
 * tudo custa menos que manter índice e merge, e mantém o arquivo legível para
 * quem abrir a pasta.
 */
function write(colecao, docs) {
  validateName(colecao);
  _pendentes.set(colecao, Array.isArray(docs) ? docs : []);
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flush();
    }, 300);
  }
  return { ok: true };
}

module.exports = { read, write, list, flush, dir: libraryDir };
