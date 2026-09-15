/**
 * ScheduledStore.ts — Armazenamento em IndexedDB das categorias e itens
 * agendados usados pela Liturgia e pelo módulo Itens Agendados.
 *
 * Migrou do UserData (chaves modules.liturgy.scheduled_*) para as tabelas
 * `scheduled_categories` / `scheduled_items`. Mantém CACHE EM MEMÓRIA para
 * preservar a API síncrona consumida por helpers/Liturgy.ts — hidratar uma
 * vez no boot (`hydrate()`); todas as escritas atualizam memória + IDB.
 *
 * Migração legada: no primeiro hydrate, se as tabelas estiverem vazias e
 * existirem listas no UserData, copia e deixa o legado intacto (backup).
 *
 * @category deve-virar-composable — Usa UserData apenas na migração.
 */
import $docs from "@/helpers/DocStore";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";
import $userdata from "@/helpers/UserData";
import type { ScheduledCategory, ScheduledItem } from "@/types/Liturgy";

const TABLE_CATEGORIES = DB_TABLE.SCHEDULED_CATEGORIES;
const TABLE_ITEMS = DB_TABLE.SCHEDULED_ITEMS;

let _categories: ScheduledCategory[] = [];
let _items: ScheduledItem[] = [];
let _hydrated = false;
let _hydrating: Promise<void> | null = null;

/**
 * Promises de escrita pendentes. Cada save/delete adiciona aqui e remove
 * ao resolver. `flush()` aguarda todas — usado pelo `pagehide` handler
 * no Shell.vue para garantir que dados cheguem ao IDB antes do unload.
 */
const _pending = new Set<Promise<void>>();

function _track<T extends Promise<void>>(promise: T): T {
  _pending.add(promise);
  void promise.finally(() => _pending.delete(promise));
  return promise;
}

async function hydrate(): Promise<void> {
  if (_hydrated) return;
  if (_hydrating) return _hydrating;

  _hydrating = (async () => {
    const [cats, items] = await Promise.all([
      $docs.getAll<ScheduledCategory>(TABLE_CATEGORIES),
      $docs.getAll<ScheduledItem>(TABLE_ITEMS),
    ]);

    // Migração legada (UserData → IDB) quando alvo vazio e origem tem dados.
    if (!cats.length) {
      const legacy =
        ($userdata.get<ScheduledCategory[]>(
          KEYS.MODULES.LITURGY.SCHEDULED_CATEGORIES,
          []
        ) || []) as ScheduledCategory[];
      for (const c of legacy) {
        await $docs.put(TABLE_CATEGORIES, { ...c, id: String(c.id) });
      }
    }
    if (!items.length) {
      const legacy =
        ($userdata.get<ScheduledItem[]>(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS, []) ||
          []) as ScheduledItem[];
      for (const i of legacy) {
        await $docs.put(TABLE_ITEMS, { ...i, id: String(i.id) });
      }
    }

    _categories = cats.length
      ? cats
      : (($userdata.get<ScheduledCategory[]>(
          KEYS.MODULES.LITURGY.SCHEDULED_CATEGORIES,
          []
        ) || []) as ScheduledCategory[]);
    _items = items.length
      ? items
      : (($userdata.get<ScheduledItem[]>(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS, []) ||
          []) as ScheduledItem[]);

    _hydrated = true;
  })();

  return _hydrating;
}

export default {
  /** Hidrata o cache a partir do IDB (+ migração legada). Idempotente. */
  hydrate,

  /** Leitura síncrona do cache — chamar após hydrate() no boot. */
  categories(): ScheduledCategory[] {
    return _categories;
  },
  items(): ScheduledItem[] {
    return _items;
  },

  /** Aguarda todas as escritas pendentes ao IDB. Chamado no pagehide. */
  async flush(): Promise<void> {
    if (!_pending.size) return;
    await Promise.all([..._pending]);
  },

  async saveCategory(cat: ScheduledCategory): Promise<void> {
    const normalized = { ...cat, id: String(cat.id) };
    const i = _categories.findIndex((c) => String(c.id) === String(cat.id));
    if (i >= 0) _categories[i] = normalized;
    else _categories.push(normalized);
    await _track($docs.put(TABLE_CATEGORIES, normalized));
  },

  async deleteCategory(id: string | number): Promise<void> {
    _categories = _categories.filter((c) => String(c.id) !== String(id));
    const affected = _items.filter((i) => String(i.categoria) === String(id));
    _items = _items.filter((i) => String(i.categoria) !== String(id));
    await _track($docs.del(TABLE_CATEGORIES, String(id)));
    for (const i of affected) await _track($docs.del(TABLE_ITEMS, String(i.id)));
  },

  async saveItem(item: ScheduledItem): Promise<void> {
    const normalized = { ...item, id: String(item.id) };
    const i = _items.findIndex((x) => String(x.id) === String(item.id));
    if (i >= 0) _items[i] = normalized;
    else _items.push(normalized);
    await _track($docs.put(TABLE_ITEMS, normalized));
  },

  async deleteItem(id: string | number): Promise<void> {
    _items = _items.filter((x) => String(x.id) !== String(id));
    await _track($docs.del(TABLE_ITEMS, String(id)));
  },
};
