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
const { createAsyncJsonWriteQueue } = require("./asyncJsonWriteQueue.js");

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

const _writes = createAsyncJsonWriteQueue({
  name: "docStore",
  resolveFile: filePath,
  // Preserva a janela de lote que este store ja oferecia. flush() ignora a
  // espera, por isso o encerramento nunca paga estes 300 ms.
  debounceMs: 300,
});

function _snapshot(docs, colecao) {
  const json = JSON.stringify(Array.isArray(docs) ? docs : [], null, 2);
  if (json === undefined) {
    throw new TypeError(`docStore: colecao "${colecao}" nao e serializavel em JSON`);
  }
  return `${json}\n`;
}

function _recoverBackup(file) {
  const backup = `${file}.bak`;
  try {
    if (!fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file);
  } catch (e) {
    console.warn(`[docStore] recuperacao de backup falhou (${file}):`, e.message);
  }
}

/** Documentos de uma coleção. Lista vazia quando ela ainda não existe. */
function read(colecao) {
  validateName(colecao);
  const queued = _writes.peek(colecao);
  if (queued) {
    if (queued.type === "remove") return [];
    const docs = JSON.parse(queued.contents);
    return Array.isArray(docs) ? docs : [];
  }
  const file = filePath(colecao);
  try {
    _recoverBackup(file);
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
  const found = new Set();
  try {
    for (const name of fs
      .readdirSync(libraryDir())
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))) {
      found.add(name);
    }
  } catch (_) {
    // Pasta ainda nao criada.
  }
  for (const entry of _writes.latestEntries()) {
    if (entry.type === "remove") found.delete(entry.id);
    else found.add(entry.id);
  }
  return [...found];
}

/**
 * Substitui a coleção inteira. São dezenas de itens de alguns KB — reescrever
 * tudo custa menos que manter índice e merge, e mantém o arquivo legível para
 * quem abrir a pasta.
 */
function write(colecao, docs) {
  validateName(colecao);
  return _writes.enqueueWrite(colecao, _snapshot(docs, colecao));
}

/** Aguarda todas as colecoes, incluindo retry de falha transitoria. */
function flush() {
  return _writes.flush();
}

module.exports = { read, write, list, flush, dir: libraryDir };
