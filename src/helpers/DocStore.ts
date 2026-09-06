/**
 * @category helper-puro — Documentos do usuário: liturgias salvas, playlists,
 * coletâneas personalizadas, itens agendados.
 *
 * Mesma forma do `IndexedDB.ts` (get/getAll/put/del/clear) de propósito: os
 * consumidores trocaram uma linha de import e nada mais.
 *
 * No desktop os documentos são arquivos JSON na pasta de dados, escritos pelo
 * main. No navegador continuam no IndexedDB — a paridade entre web e desktop
 * se faz por exportar e importar, não por um armazenamento comum.
 *
 * Cada coleção fica inteira em memória depois da primeira leitura, e toda
 * escrita reenvia a coleção completa: são dezenas de itens de alguns KB, e o
 * preço disso é menor que manter índice e merge dos dois lados do IPC.
 */

import $idb from "@/helpers/IndexedDB";
import Platform from "@/helpers/Platform";

interface Doc {
  id: string;
}

const _cache = new Map<string, Doc[]>();

function _desktop(): boolean {
  return Platform.isDesktop && !!Platform.docs;
}

async function _load<T extends Doc>(colecao: string): Promise<T[]> {
  const emCache = _cache.get(colecao);
  if (emCache) return emCache as T[];

  const docs = ((await Platform.docs?.read(colecao)) || []) as T[];
  _cache.set(colecao, docs);
  return docs;
}

async function _save(colecao: string, docs: Doc[]): Promise<void> {
  _cache.set(colecao, docs);
  await Platform.docs?.write(colecao, docs);
}

export default {
  /** Todos os documentos de uma coleção. */
  async getAll<T = unknown>(colecao: string): Promise<T[]> {
    if (!_desktop()) return $idb.getAll<T>(colecao);
    return [...(await _load<Doc>(colecao))] as T[];
  },

  /** Um documento pelo id. */
  async get<T = unknown>(colecao: string, id: string): Promise<T | undefined> {
    if (!_desktop()) return $idb.get<T>(colecao, id);
    return (await _load<Doc>(colecao)).find((d) => d.id === id) as T | undefined;
  },

  /** Insere ou substitui um documento. */
  async put<T extends Doc>(colecao: string, value: T): Promise<void> {
    if (!_desktop()) return $idb.put(colecao, value);
    const docs = await _load<Doc>(colecao);
    const i = docs.findIndex((d) => d.id === value.id);
    const novos = [...docs];
    if (i >= 0) novos[i] = value;
    else novos.push(value);
    await _save(colecao, novos);
  },

  /** Remove um documento pelo id. */
  async del(colecao: string, id: string): Promise<void> {
    if (!_desktop()) return $idb.del(colecao, id);
    const docs = await _load<Doc>(colecao);
    await _save(
      colecao,
      docs.filter((d) => d.id !== id)
    );
  },

  /** Esvazia a coleção. */
  async clear(colecao: string): Promise<void> {
    if (!_desktop()) return $idb.clear(colecao);
    await _save(colecao, []);
  },

  /**
   * Traz para os arquivos o que ficou no IndexedDB de versões anteriores.
   *
   * Só age quando a coleção em arquivo está vazia e a tabela antiga tem algo,
   * então repetir é inofensivo. O IndexedDB fica intacto: enquanto esta
   * mudança não tiver rodado em campo por algumas versões, ele é a rede.
   */
  async migrarDoIndexedDB(colecoes: string[]): Promise<number> {
    if (!_desktop()) return 0;

    let migradas = 0;
    for (const colecao of colecoes) {
      try {
        if ((await _load<Doc>(colecao)).length) continue;
        const antigos = await $idb.getAll<Doc>(colecao);
        if (!antigos.length) continue;
        await _save(colecao, antigos);
        migradas++;
        console.log(`[DocStore] ${colecao}: ${antigos.length} documentos migrados do IndexedDB`);
      } catch (e) {
        console.warn(`[DocStore] falha ao migrar "${colecao}":`, (e as Error).message);
      }
    }
    return migradas;
  },
};
