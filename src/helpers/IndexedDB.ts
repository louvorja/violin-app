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
import { DB_NAME, DB_TABLE } from "@/constants/DbTables";

const TABLE_SETTINGS = DB_TABLE.SETTINGS;
const TABLES = Object.values(DB_TABLE);

export interface CatalogChange {
  key: string;
  writes: ReadonlyArray<{
    table: string;
    rows: ReadonlyArray<{ id: string }>;
    /** Remove somente as linhas deste dataset, nunca a tabela inteira. */
    replacePrefix?: string;
  }>;
}

/** A cada quantos pedidos o catálogo espera o banco alcançar a fila. */
const CATALOG_WAIT_EVERY = 500;

let dbPromise: Promise<IDBPDatabase> | null = null;

function createMissingTables(db: IDBPDatabase): void {
  for (const name of TABLES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
  }
}

/**
 * Abre o banco na versão que estiver no disco e só sobe uma versão quando falta
 * tabela. Com a versão fixa no código, um banco gravado por uma linha de
 * desenvolvimento à frente (v6 contra v4) recusava abrir com VersionError: o
 * catálogo deixava de ser guardado e atualizado até alguém apagar o banco à mão.
 */
async function openUpToDate(): Promise<IDBPDatabase> {
  let version: number | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    let db: IDBPDatabase;
    try {
      db = await openDB(DB_NAME, version, {
        upgrade: createMissingTables,
        // O iOS encerra a conexão quando a aba vai para segundo plano. Sem soltar
        // a promessa guardada, toda leitura seguinte falhava com "The database
        // connection is closing" até o operador recarregar a página.
        terminated() {
          dbPromise = null;
        },
      });
    } catch (error) {
      // Outra janela subiu a versão entre as duas aberturas: vale a do disco.
      if (version !== undefined && (error as DOMException | null)?.name === "VersionError") {
        version = undefined;
        continue;
      }
      throw error;
    }
    if (TABLES.every((name) => db.objectStoreNames.contains(name))) return db;
    version = db.version + 1;
    db.close();
  }
  throw new Error("IndexedDB: não foi possível criar as tabelas do app");
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openUpToDate();
    const opening = dbPromise;
    void opening
      .then((db) => {
        const drop = () => {
          if (dbPromise === opening) dbPromise = null;
        };
        db.addEventListener("close", drop);
        db.addEventListener("versionchange", () => {
          db.close();
          drop();
        });
      })
      .catch(() => {
        if (dbPromise === opening) dbPromise = null;
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

  /**
   * Só as chaves que começam com `prefix`. Ler os registros para descobrir quais
   * existem desserializa todo o conteúdo na thread da tela: com as versões da
   * Bíblia baixadas são milhares de capítulos de texto e segundos de travamento.
   */
  async getAllKeysByPrefix(table: string, prefix: string): Promise<string[]> {
    const db = await getDb();
    const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined;
    return (await db.getAllKeys(table, range)).map(String);
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
   * Os pedidos saem sem esperar um por um (esperar cada `put` custava uma ida e
   * volta por linha); só se espera o último pedido de cada lote, e nada além de
   * pedidos IDB, para a transação não fechar sozinha no meio.
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
    let failure: { error: unknown } | null = null;
    let lastSettled: Promise<void> = Promise.resolve();
    const enqueue = (request: Promise<unknown>): Promise<unknown> => {
      lastSettled = request.then(
        () => undefined,
        (error: unknown) => {
          failure ??= { error };
        }
      );
      return request;
    };
    // Os pedidos de uma transação terminam em ordem: esperar o último basta.
    const settle = async () => {
      await lastSettled;
      if (failure) throw failure.error;
    };
    const report = (current: number, key: string) => {
      try {
        options.onApplied?.(current, changes.length, key);
      } catch {
        // Progresso é diagnóstico/UI, não pode abortar a persistência.
      }
    };
    try {
      let sinceWait = 0;
      for (let i = 0; i < changes.length; i++) {
        options.signal?.throwIfAborted();
        const change = changes[i];
        let lastRequest: Promise<unknown> | null = null;
        for (const write of change.writes) {
          const store = tx.objectStore(write.table);
          if (write.replacePrefix) {
            // Um pedido por dataset. Não é `clear()`: as tabelas guardam também linhas
            // que o bundle não traz (marcador da Bíblia na `cache`, datasets à parte).
            lastRequest = enqueue(
              store.delete(IDBKeyRange.bound(write.replacePrefix, `${write.replacePrefix}\uffff`))
            );
          }
          for (const row of write.rows) {
            lastRequest = enqueue(store.put(row));
            if (++sinceWait >= CATALOG_WAIT_EVERY) {
              sinceWait = 0;
              await settle();
              options.signal?.throwIfAborted();
            }
          }
        }
        if (i + 1 < changes.length) {
          const current = i + 1;
          if (lastRequest)
            void lastRequest.then(
              () => report(current, change.key),
              () => {}
            );
          else report(current, change.key);
        }
      }
      await settle();
      options.signal?.throwIfAborted();
      enqueue(tx.objectStore(DB_TABLE.CACHE).put(marker));
      await settle();
      await tx.done;
      const last = changes.at(-1);
      // Só depois do commit: o último progresso diz que o catálogo novo já vale.
      if (last) report(changes.length, last.key);
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

  /** Migra registros sem carregar a biblioteca inteira (incluindo os blobs) na memória. */
  async rewriteRecords(table: string, rewrite: (value: unknown) => unknown): Promise<number> {
    const tx = (await getDb()).transaction(table, "readwrite");
    let changed = 0;
    try {
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const original = cursor.value;
        const next = rewrite(original);
        if (next !== original) {
          await cursor.update(next);
          changed++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return changed;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* A transação pode já ter sido abortada pelo IDB. */
      }
      try {
        await tx.done;
      } catch {
        /* Preserva a causa original. */
      }
      throw error;
    }
  },

  /**
   * Substitui o conteúdo das tabelas informadas dentro de uma única transação
   * `readwrite`. Se a aba fechar ou ocorrer erro antes de `tx.done`, o engine
   * do IndexedDB desfaz toda a operação automaticamente.
   */
  async replaceAllTables(
    data: ReadonlyMap<string, ReadonlyArray<{ id: string }>>,
    clearTables: readonly string[],
    commitMarker?: { table: string; row: { id: string } }
  ): Promise<void> {
    const stores = [
      ...new Set([...clearTables, ...data.keys(), ...(commitMarker ? [commitMarker.table] : [])]),
    ];
    const tx = (await getDb()).transaction(stores, "readwrite");
    try {
      for (const table of clearTables) {
        await tx.objectStore(table).clear();
      }
      for (const [table, rows] of data) {
        const store = tx.objectStore(table);
        for (const row of rows) {
          await store.put(row);
        }
      }
      if (commitMarker) {
        await tx.objectStore(commitMarker.table).put(commitMarker.row);
      }
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* A transação pode já ter sido abortada pelo IDB. */
      }
      try {
        await tx.done;
      } catch {
        /* Preserva o erro original. */
      }
      throw error;
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
