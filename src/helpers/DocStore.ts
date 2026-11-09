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
const _loading = new Map<string, Promise<Doc[]>>();

function _desktop(): boolean {
  return Platform.isDesktop && !!Platform.docs;
}

async function _load<T extends Doc>(colecao: string): Promise<T[]> {
  const emCache = _cache.get(colecao);
  if (emCache) return emCache as T[];

  let loading = _loading.get(colecao);
  if (!loading) {
    loading = (async () => {
      try {
        const docs = ((await Platform.docs?.read(colecao)) || []) as Doc[];
        _cache.set(colecao, docs);
        return docs;
      } finally {
        _loading.delete(colecao);
      }
    })();
    _loading.set(colecao, loading);
  }
  return (await loading) as T[];
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
    await _load<Doc>(colecao);
    // Duas operações podem ter aguardado o mesmo snapshot. Derive da revisão
    // atual, já publicada de forma síncrona por _save, para não perder a outra.
    // O IPC continua imediato: o main agrupa as escritas e faz flush ao sair.
    const docs = _cache.get(colecao)!;
    const i = docs.findIndex((d) => d.id === value.id);
    const novos = [...docs];
    if (i >= 0) novos[i] = value;
    else novos.push(value);
    await _save(colecao, novos);
  },

  /** Salva um lote em uma transação web ou um único snapshot desktop. */
  async putMany<T extends Doc>(colecao: string, values: readonly T[]): Promise<void> {
    if (!values.length) return;
    if (!_desktop()) return $idb.putMany(colecao, values);
    await _load<Doc>(colecao);
    const docs = new Map(_cache.get(colecao)!.map((doc) => [doc.id, doc]));
    for (const value of values) docs.set(value.id, value);
    await _save(colecao, [...docs.values()]);
  },

  /** Remove um documento pelo id. */
  async del(colecao: string, id: string): Promise<void> {
    if (!_desktop()) return $idb.del(colecao, id);
    await _load<Doc>(colecao);
    const docs = _cache.get(colecao)!;
    await _save(
      colecao,
      docs.filter((d) => d.id !== id)
    );
  },

  /** Esvazia a coleção. */
  async clear(colecao: string): Promise<void> {
    if (!_desktop()) return $idb.clear(colecao);
    // Não deixe uma leitura iniciada antes da exclusão repor o cache antigo.
    await _load<Doc>(colecao);
    await _save(colecao, []);
  },

  /**
   * Traz para os arquivos o que ficou no IndexedDB de versões anteriores.
   *
   * Só age quando a coleção ainda não tem arquivo e a tabela antiga tem algo.
   * Um arquivo vazio registra uma exclusão deliberada. O IndexedDB fica intacto: enquanto esta
   * mudança não tiver rodado em campo por algumas versões, ele é a rede.
   */
  async migrarDoIndexedDB(colecoes: string[]): Promise<number> {
    if (!_desktop()) return 0;
    let existing: Set<string>;
    try {
      existing = new Set(await Platform.docs!.list());
    } catch (error) {
      // Sem distinguir ausente de vazio, importar poderia ressuscitar dados
      // excluídos. Não marque sucesso: o próximo boot pode tentar novamente.
      console.warn("[DocStore] falha ao listar coleções para migração:", error);
      return 0;
    }

    // Em paralelo: cada coleção é uma ida ao disco pelo IPC, e enfileirá-las
    // punha seis esperas entre o clique no ícone e a janela abrir. Elas não se
    // cruzam — cada uma tem seu arquivo e sua entrada no cache.
    const migradas = await Promise.all(
      colecoes.map(async (colecao) => {
        try {
          if (existing.has(colecao)) return false;
          const initial = await _load<Doc>(colecao);
          if (initial.length) return false;
          const antigos = await $idb.getAll<Doc>(colecao);
          if (!antigos.length) return false;
          // Uma criação ou limpeza pode ter chegado enquanto o legado era lido.
          if (_cache.get(colecao) !== initial) return false;
          await _save(colecao, antigos);
          console.log(`[DocStore] ${colecao}: ${antigos.length} documentos migrados do IndexedDB`);
          return true;
        } catch (e) {
          console.warn(`[DocStore] falha ao migrar "${colecao}":`, (e as Error).message);
          return false;
        }
      })
    );
    return migradas.filter(Boolean).length;
  },
};
