"use strict";

/**
 * userStore.js — Persistência de dados do usuário em arquivos JSON.
 *
 * Armazena cada chave como um arquivo JSON separado em:
 *   userData/storage/<key>.json
 *
 * Regras de segurança:
 *   - Chaves são validadas por regex (sem path traversal)
 *   - Escrita atômica via arquivo .tmp + rename
 *
 * Faz parte da Fase D1 — substituição do localStorage por arquivos JSON.
 */

const fs = require("fs-extra");
const path = require("path");
const paths = require("./paths.js");
const { createAsyncJsonWriteQueue } = require("./asyncJsonWriteQueue.js");

// ---------------------------------------------------------------------------
// Validação de chave
// ---------------------------------------------------------------------------

/** Regex que aceita apenas caracteres seguros para nomes de arquivo */
const KEY_RE = /^[a-zA-Z0-9_:.-]+$/;

/**
 * Valida uma chave e lança erro se inválida.
 * @param {string} key
 */
function validateKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`userStore: chave inválida (vazia ou não-string): ${JSON.stringify(key)}`);
  }
  if (!KEY_RE.test(key)) {
    throw new Error(
      `userStore: chave contém caracteres inválidos: "${key}". Use apenas [a-zA-Z0-9_:.-]`
    );
  }
}

// ---------------------------------------------------------------------------
// Diretório de storage
// ---------------------------------------------------------------------------

/**
 * Retorna o caminho absoluto do diretório de storage.
 * @returns {string}
 */
function storageDir() {
  return path.join(paths.dataDir(), "storage");
}

/**
 * Garante que o diretório de storage existe (chamado na primeira operação).
 * Chamado por init() e pelos métodos individualmente como guard.
 */
function ensureDir() {
  // Sem cache: a pasta de dados muda em runtime quando o operador escolhe
  // outra em "Armazenamento", e um destino lembrado deixaria a escrita
  // seguinte apontando para um caminho que não existe mais.
  fs.ensureDirSync(storageDir());
}
// NÃO chamar ensureDir no top-level — `app` ainda não está pronto durante imports.
// As funções públicas chamam ensureDir() lazy quando necessário.

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Retorna o caminho do arquivo JSON para uma chave.
 * @param {string} key
 * @returns {string}
 */
function filePath(key) {
  return path.join(storageDir(), `${key}.json`);
}

const _writes = createAsyncJsonWriteQueue({
  name: "userStore",
  resolveFile: filePath,
});

function _snapshot(value, key) {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) {
    throw new TypeError(`userStore: valor de "${key}" nao e serializavel em JSON`);
  }
  return `${json}\n`;
}

/** Recupera o snapshot anterior se uma queda interrompeu o fallback Windows. */
function _recoverBackup(file) {
  const backup = `${file}.bak`;
  try {
    if (!fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file);
  } catch (e) {
    console.warn(`[userStore] recuperacao de backup falhou (${file}):`, e.message);
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Lê o valor armazenado para uma chave.
 * Retorna o objeto/valor JSON ou `null` se o arquivo não existir ou JSON inválido.
 *
 * @param {string} key
 * @returns {any | null}
 */
function read(key) {
  validateKey(key);
  const queued = _writes.peek(key);
  if (queued) {
    if (queued.type === "remove") return null;
    return JSON.parse(queued.contents);
  }
  const file = filePath(key);

  try {
    _recoverBackup(file);
    if (!fs.existsSync(file)) return null;
    return fs.readJsonSync(file);
  } catch (e) {
    console.warn(`[userStore] read("${key}") falhou:`, e.message);
    return null;
  }
}

/**
 * Agenda um valor para escrita atomica sem bloquear o event loop. Escritas da
 * mesma chave ainda nao iniciadas sao coalescidas; todas as Promises resolvem
 * somente quando uma revisao igual ou mais nova chegou ao disco.
 *
 * @param {string} key
 * @param {any} value  Qualquer valor serializável em JSON
 */
function write(key, value) {
  validateKey(key);
  const promise = _writes.enqueueWrite(key, _snapshot(value, key));
  if (process.env.LOUVORJA_DEBUG_STORAGE) {
    promise.then(
      () => console.log(`[userStore] Gravou "${key}" em ${filePath(key)}`),
      () => {}
    );
  }
  return promise;
}

/**
 * Remove o arquivo de uma chave, se existir.
 *
 * @param {string} key
 */
function remove(key) {
  validateKey(key);
  return _writes.enqueueRemove(key);
}

/**
 * Lista todas as chaves disponíveis no storage.
 * Retorna apenas os nomes sem extensão .json.
 *
 * @returns {string[]}
 */
function keys() {
  const found = new Set();
  try {
    ensureDir();
    for (const key of fs
      .readdirSync(storageDir())
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"))
      .map((f) => f.slice(0, -5))) {
      found.add(key);
    }
  } catch (e) {
    console.warn("[userStore] keys() falhou:", e.message);
  }
  for (const entry of _writes.latestEntries()) {
    if (entry.type === "remove") found.delete(entry.id);
    else found.add(entry.id);
  }
  return [...found];
}

/**
 * Retorna o caminho absoluto do diretório de storage (útil para debug).
 *
 * @returns {string}
 */
function dir() {
  return storageDir();
}

/** Aguarda todas as revisoes, incluindo um retry de falhas transitorias. */
function flush() {
  return _writes.flush();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { read, write, remove, keys, dir, flush };
