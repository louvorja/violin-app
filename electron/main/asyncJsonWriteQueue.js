"use strict";

/**
 * Fila serializada para persistir snapshots JSON sem bloquear o main process.
 *
 * A fila conserva somente a revisao mais recente ainda nao iniciada de cada
 * chave. Promises de revisoes coalescidas resolvem quando essa revisao mais
 * nova chega ao disco, de modo que um caller que aguarda write() nunca recebe
 * confirmacao antes de existir um snapshot pelo menos tao novo quanto o seu.
 */

const fs = require("fs-extra");
const path = require("path");

const REPLACE_ERRORS = new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]);

function _asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

async function _removeQuietly(io, target) {
  try {
    await io.remove(target);
  } catch (_) {
    // Arquivo temporario e best-effort. A falha original continua sendo a
    // informacao importante para o caller.
  }
}

/**
 * Troca um JSON por temp + rename. No Windows, rename nao substitui um destino
 * aberto/existente de forma consistente. O fallback guarda o arquivo anterior
 * em .bak, instala o temp e restaura o anterior se a segunda troca falhar.
 *
 * @param {{io?: typeof fs, file: string, contents: string}} options
 */
async function atomicWriteJson({ io = fs, file, contents }) {
  const tmp = `${file}.tmp`;
  const backup = `${file}.bak`;
  let originalInBackup = false;
  let committed = false;

  await io.ensureDir(path.dirname(file));

  // Recupera o unico estado intermediario que o fallback Windows pode deixar
  // depois de uma queda: o destino ausente e o snapshot anterior em .bak.
  if (!(await io.pathExists(file)) && (await io.pathExists(backup))) {
    await io.rename(backup, file);
  } else if ((await io.pathExists(file)) && (await io.pathExists(backup))) {
    // Se os dois existem, o destino canonico ja foi instalado; .bak e apenas
    // sobra de um cleanup interrompido.
    await _removeQuietly(io, backup);
  }

  try {
    await io.writeFile(tmp, contents, "utf8");
    try {
      await io.rename(tmp, file);
      committed = true;
      return;
    } catch (renameError) {
      const cause = _asError(renameError);
      const targetExists = await io.pathExists(file);
      if (!targetExists || (cause.code && !REPLACE_ERRORS.has(cause.code))) {
        throw cause;
      }

      // Um .bak ao lado de um destino valido e sobra de uma troca anterior ja
      // concluida. Neste ponto o destino canonico continua sendo a copia boa.
      if (await io.pathExists(backup)) await io.remove(backup);
      await io.rename(file, backup);
      originalInBackup = true;

      try {
        await io.rename(tmp, file);
        committed = true;
      } catch (installError) {
        // Nunca apague o backup se a restauracao tambem falhar: ele e a ultima
        // copia integra e pode ser recuperado no proximo write/boot.
        if (!(await io.pathExists(file)) && (await io.pathExists(backup))) {
          try {
            await io.rename(backup, file);
            originalInBackup = false;
          } catch (restoreError) {
            const combined = new Error(
              `${_asError(installError).message}; restauracao falhou: ${_asError(restoreError).message}`
            );
            combined.cause = installError;
            throw combined;
          }
        }
        throw installError;
      }

      if (committed && originalInBackup) {
        try {
          await io.remove(backup);
          originalInBackup = false;
        } catch (cleanupError) {
          // A gravacao ja esta confirmada. Deixar a copia anterior e mais
          // seguro que transformar cleanup tardio em uma falsa falha de save.
          console.warn(`[atomicJson] backup nao removido (${backup}):`, cleanupError?.message || cleanupError);
        }
      }
    }
  } finally {
    if (!committed) await _removeQuietly(io, tmp);
  }
}

/**
 * @param {{
 *   name: string,
 *   resolveFile: (id: string) => string,
 *   debounceMs?: number,
 *   io?: typeof fs,
 * }} options
 */
function createAsyncJsonWriteQueue({ name, resolveFile, debounceMs = 0, io = fs }) {
  let nextRevision = 0;
  let timer = null;
  let draining = null;
  let flushing = null;

  /** @type {Map<string, {id:string, revision:number, type:"write"|"remove", contents?:string}>} */
  const pending = new Map();
  /** Mesmo durante a escrita ativa, reads enxergam o snapshot mais novo. */
  const latest = new Map();
  /** @type {Map<string, Array<{revision:number, resolve:Function, reject:Function}>>} */
  const waiters = new Map();
  /** Falha da revisao mais nova ainda nao substituida por sucesso. */
  const failedLatest = new Map();

  function _handledPromise(executor) {
    const promise = new Promise(executor);
    // Marca a Promise como observada mesmo para callers main-process que sao
    // deliberadamente fire-and-forget. Quem a aguarda ainda recebe a rejeicao.
    promise.catch(() => {});
    return promise;
  }

  function _schedule() {
    if (timer || draining) return;
    timer = setTimeout(() => {
      timer = null;
      _drain();
    }, Math.max(0, debounceMs));
    timer.unref?.();
  }

  function _settle(id, revision, error) {
    const list = waiters.get(id) || [];
    const remaining = [];
    for (const waiter of list) {
      if (waiter.revision > revision) {
        remaining.push(waiter);
      } else if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve({ ok: true, revision });
      }
    }
    if (remaining.length) waiters.set(id, remaining);
    else waiters.delete(id);
  }

  function _contextualError(operation, error) {
    const cause = _asError(error);
    const wrapped = new Error(
      `${name}: ${operation.type}("${operation.id}") falhou: ${cause.message}`
    );
    wrapped.cause = cause;
    wrapped.code = cause.code;
    return wrapped;
  }

  async function _run(operation) {
    const file = resolveFile(operation.id);
    if (operation.type === "remove") {
      // Remova primeiro qualquer copia recuperavel. Se o backup estiver
      // bloqueado, falhe preservando o canonico: read() nao pode ressuscitar
      // um valor depois de uma exclusao confirmada.
      await io.remove(`${file}.bak`);
      await io.remove(`${file}.tmp`);
      await io.remove(file);
      return;
    }
    await atomicWriteJson({ io, file, contents: operation.contents });
  }

  function _drain() {
    if (draining) return draining;

    draining = (async () => {
      while (pending.size) {
        // delete+set em enqueue move uma chave atualizada para o fim. Assim os
        // snapshots sobreviventes mantem a ordem de suas revisoes finais.
        const [id, operation] = pending.entries().next().value;
        pending.delete(id);

        try {
          await _run(operation);
          const current = latest.get(id);
          if (current?.revision === operation.revision) latest.delete(id);
          const previousFailure = failedLatest.get(id);
          if (previousFailure && previousFailure.revision <= operation.revision) {
            failedLatest.delete(id);
          }
          _settle(id, operation.revision, null);
        } catch (error) {
          const wrapped = _contextualError(operation, error);
          if (latest.get(id)?.revision === operation.revision) {
            failedLatest.set(id, { ...operation, error: wrapped });
          }
          _settle(id, operation.revision, wrapped);
        }
      }
    })().finally(() => {
      draining = null;
      // Uma operacao pode chegar entre o ultimo teste do while e o finally.
      if (pending.size && !timer) _schedule();
    });

    return draining;
  }

  function _enqueue(id, operation) {
    const revision = ++nextRevision;
    const entry = { id, revision, ...operation };

    // Atualizar a ordem da Map e importante para A1, B1, A2: A1 some, e os
    // snapshots efetivos devem chegar como B1, A2.
    pending.delete(id);
    pending.set(id, entry);
    latest.set(id, entry);
    failedLatest.delete(id);

    const promise = _handledPromise((resolve, reject) => {
      const list = waiters.get(id) || [];
      list.push({ revision, resolve, reject });
      waiters.set(id, list);
    });
    _schedule();
    return promise;
  }

  function enqueueWrite(id, contents) {
    return _enqueue(id, { type: "write", contents });
  }

  function enqueueRemove(id) {
    return _enqueue(id, { type: "remove" });
  }

  /** Snapshot pendente/ativo para reads coerentes antes do fs terminar. */
  function peek(id) {
    const entry = latest.get(id);
    return entry ? { ...entry } : null;
  }

  function latestEntries() {
    return [...latest.values()].map((entry) => ({ ...entry }));
  }

  async function _settleCurrentWork() {
    while (timer || draining || pending.size) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (draining) await draining;
      else if (pending.size) await _drain();
    }
  }

  /**
   * Persiste tudo e tenta mais uma vez a ultima revisao que falhou. O retry e
   * especialmente util no before-quit para locks transitorios do OneDrive ou
   * antivirus; falha persistente continua sendo reportada ao caller.
   */
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      await _settleCurrentWork();

      const retry = [...failedLatest.values()]
        .filter((operation) => latest.get(operation.id)?.revision === operation.revision)
        .sort((a, b) => a.revision - b.revision);
      failedLatest.clear();
      for (const operation of retry) {
        pending.delete(operation.id);
        pending.set(operation.id, operation);
      }
      if (pending.size) await _settleCurrentWork();

      if (failedLatest.size) {
        const errors = [...failedLatest.values()].map((entry) => entry.error);
        throw new AggregateError(errors, `${name}: ${errors.length} gravacao(oes) pendente(s)`);
      }
      return { ok: true, revision: nextRevision };
    })().finally(() => {
      flushing = null;
    });
    // flush tambem pode ser fire-and-forget em teardown de testes/callers
    // antigos; mantenha o diagnostico disponivel sem unhandled rejection.
    flushing.catch(() => {});
    return flushing;
  }

  return { enqueueWrite, enqueueRemove, peek, latestEntries, flush };
}

module.exports = { atomicWriteJson, createAsyncJsonWriteQueue };
