/**
 * @category helper-puro — Camada única de acesso ao IndexedDB.
 *
 * Gerencia uma única conexão com o banco `louvorja` e disponibiliza
 * métodos CRUD genéricos. As tabelas são definidas em `DbTables.ts`.
 *
 * Inicialização (chamar no startup do app):
 *   import $idb from "@/helpers/IndexedDB";
 *   $idb.init().catch(console.warn);
 */

import { openDB, type IDBPDatabase } from "idb";
import { DB_NAME, DB_TABLE, DB_VERSION } from "@/constants/DbTables";

const TABLE_SETTINGS = DB_TABLE.SETTINGS;

export interface CatalogChange {
  key: string;
  writes: ReadonlyArray<{
    table: string;
    rows: ReadonlyArray<{ id: string }>;
    /** Remove somente as linhas deste dataset, nunca a tabela inteira. */
    replacePrefix?: string;
  }>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of Object.values(DB_TABLE)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }
      },
    });
  }
  return dbPromise;
}

export default {
  /** Inicializa o banco (cria tabelas se necessário). Chamar no startup do app. */
  async init(): Promise<void> {
    await getDb();
  },

  /** Retorna um registro pelo id. */
  async get<T = unknown>(table: string, id: string): Promise<T | undefined> {
    return (await getDb()).get(table, id);
  },

  /** Retorna todos os registros de uma tabela. */
  async getAll<T = unknown>(table: string): Promise<T[]> {
    return (await getDb()).getAll(table);
  },

  /**
   * Retorna somente os registros cujas chaves começam com `prefix`.
   * As tabelas normalizadas usam o arquivo lógico como prefixo da chave
   * (`pt_musics:123`), então não é necessário trazer outras línguas/detalhes
   * para o renderer só para filtrá-los depois.
   */
  async getAllByPrefix<T = unknown>(table: string, prefix: string): Promise<T[]> {
    if (!prefix) return this.getAll<T>(table);
    const db = await getDb();
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    return db.getAll(table, range);
  },

  /** Salva (insere ou atualiza) um registro. O objeto precisa ter um campo `id`. */
  async put<T extends { id: string }>(table: string, value: T): Promise<void> {
    await (await getDb()).put(table, value);
  },

  /**
   * Insere/atualiza e remove registros dentro de uma única transação.
   * O catálogo de músicas pode ter milhares de linhas; uma transação por
   * `put()` bloqueia o event loop e custa muito mais em máquinas fracas.
   */
  async putMany<T extends { id: string }>(
    table: string,
    values: readonly T[],
    deleteIds: readonly string[] = []
  ): Promise<void> {
    if (!values.length && !deleteIds.length) return;
    const tx = (await getDb()).transaction(table, "readwrite");
    for (const value of values) await tx.store.put(value);
    for (const id of deleteIds) await tx.store.delete(id);
    await tx.done;
  },

  /**
   * Publica um bundle completo e seu marcador na mesma transação. Uma falha de
   * escrita ou AbortSignal faz o IndexedDB restaurar todas as linhas anteriores.
   * Não há timers/yields aqui: cada request IDB mantém a transação ativa.
   */
  async applyCatalogBatch(
    changes: readonly CatalogChange[],
    marker: { id: string },
    options: {
      signal?: AbortSignal;
      onApplied?: (_current: number, _total: number, _key: string) => void;
    } = {}
  ): Promise<void> {
    options.signal?.throwIfAborted();
    const tables = [
      ...new Set([
        DB_TABLE.CACHE,
        ...changes.flatMap((change) => change.writes.map((write) => write.table)),
      ]),
    ];
    const tx = (await getDb()).transaction(tables, "readwrite");
    const abort = () => {
      try {
        tx.abort();
      } catch {
        // A transação pode já ter terminado entre o signal e este callback.
      }
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let i = 0; i < changes.length; i++) {
        options.signal?.throwIfAborted();
        const change = changes[i];
        for (const write of change.writes) {
          const store = tx.objectStore(write.table);
          if (write.replacePrefix) {
            const oldIds = await store.getAllKeys(
              IDBKeyRange.bound(write.replacePrefix, `${write.replacePrefix}\uffff`)
            );
            for (const id of oldIds) await store.delete(id);
          }
          for (const row of write.rows) {
            options.signal?.throwIfAborted();
            await store.put(row);
          }
        }
        if (i + 1 < changes.length) {
          try {
            options.onApplied?.(i + 1, changes.length, change.key);
          } catch {
            // Progresso é diagnóstico/UI, não pode abortar a persistência.
          }
        }
      }
      options.signal?.throwIfAborted();
      await tx.objectStore(DB_TABLE.CACHE).put(marker);
      await tx.done;
      const last = changes.at(-1);
      if (last) {
        try {
          options.onApplied?.(changes.length, changes.length, last.key);
        } catch {
          // O commit já terminou; um callback de progresso falho não o desfaz.
        }
      }
    } catch (error) {
      abort();
      try {
        await tx.done;
      } catch {
        // A rejeição original (ou o motivo do abort) é mais útil ao chamador.
      }
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  },

  /** Remove um registro pelo id. */
  async del(table: string, id: string): Promise<void> {
    await (await getDb()).delete(table, id);
  },

  /** Remove todos os registros de uma tabela. */
  async clear(table: string): Promise<void> {
    await (await getDb()).clear(table);
  },

  /** Percorre a tabela registro a registro — usar quando `getAll` traria bytes demais. */
  async each<T = unknown>(table: string, fn: (value: T) => void): Promise<void> {
    const db = await getDb();
    let cursor = await db.transaction(table).store.openCursor();
    while (cursor) {
      fn(cursor.value as T);
      cursor = await cursor.continue();
    }
  },

  /**
   * === Métodos para Tabela Settings
   */

  /** Retorna um registro de configuração pelo id. */
  async getSetting<T = Record<string, unknown>>(id: string): Promise<T | undefined> {
    return this.get<T>(TABLE_SETTINGS, id);
  },

  /** Salva (insere ou atualiza) um registro de configuração. */
  async saveSetting<T extends { id: string }>(record: T): Promise<void> {
    await this.put(TABLE_SETTINGS, record);
  },

  /** Remove um registro de configuração inteiro. */
  async removeSetting(id: string): Promise<void> {
    await this.del(TABLE_SETTINGS, id);
  },
};
