/**
 * ScheduledStore.ts — Armazenamento em IndexedDB das categorias e itens
 * agendados usados pela Liturgia e pelo módulo Itens Agendados.
 *
 * Migrou do UserData (chaves modules.liturgy.scheduled_*) para as tabelas
 * `scheduled_categories` / `scheduled_items`. Mantém CACHE EM MEMÓRIA para
 * preservar a API síncrona consumida por helpers/Liturgy.ts — hidratar uma
 * vez no boot (`hydrate()`); todas as escritas atualizam memória + IDB.
 *
 * Migração legada: na primeira hidratação concluída, copia listas do UserData
 * quando o destino está vazio e marca a conclusão, mantendo o legado intacto.
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
// Preserve o plano após falha: o cache desktop pode já conter o lote cuja
// gravação falhou, e não pode ser confundido com um destino antes existente.
let _legacyMigration: {
  categories: Array<ScheduledCategory & { id: string }> | null;
  items: Array<ScheduledItem & { id: string }> | null;
} | null = null;

/**
 * Promises de escrita pendentes. Cada save/delete adiciona aqui e remove
 * ao resolver. `flush()` aguarda todas antes da atualização PWA; no
 * `pagehide` é apenas best-effort, pois o navegador não aguarda Promises.
 */
const _pending = new Set<Promise<void>>();
const _latest = new Map<string, Promise<void>>();
const _failed = new Map<string, { operation: () => Promise<void>; error: unknown }>();

function _track(key: string, operation: () => Promise<void>): Promise<void> {
  const promise = (async () => operation())();
  _pending.add(promise);
  _latest.set(key, promise);
  _failed.delete(key);
  // Conserve somente a revisão mais recente de cada documento para retry.
  // finally() criava outra rejeição sem observador, além do erro original.
  void promise.then(
    () => {
      _pending.delete(promise);
      if (_latest.get(key) !== promise) return;
      _latest.delete(key);
      _failed.delete(key);
    },
    (error) => {
      _pending.delete(promise);
      if (_latest.get(key) !== promise) return;
      _latest.delete(key);
      _failed.set(key, { operation, error });
    }
  );
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

    const migrated = $userdata.get<boolean>(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED, false) === true;
    if (!migrated && !_legacyMigration) {
      _legacyMigration = {
        categories: cats.length
          ? null
          : (
              $userdata.get<ScheduledCategory[]>(KEYS.MODULES.LITURGY.SCHEDULED_CATEGORIES, []) ||
              []
            ).map((category) => ({ ...category, id: String(category.id) })),
        items: items.length
          ? null
          : ($userdata.get<ScheduledItem[]>(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS, []) || []).map(
              (item) => ({ ...item, id: String(item.id) })
            ),
      };
    }
    if (_legacyMigration?.categories) {
      await $docs.putMany(TABLE_CATEGORIES, _legacyMigration.categories);
      _legacyMigration.categories = null;
    }
    if (_legacyMigration?.items) {
      await $docs.putMany(TABLE_ITEMS, _legacyMigration.items);
      _legacyMigration.items = null;
    }
    // Só conclua após todos os documentos terem chegado ao armazenamento.
    // O backup legado continua disponível, mas não volta após excluir o último.
    if (!migrated) $userdata.set(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED, true);
    $userdata.flushPendingWebSave();
    [_categories, _items] = await Promise.all([
      $docs.getAll<ScheduledCategory>(TABLE_CATEGORIES),
      $docs.getAll<ScheduledItem>(TABLE_ITEMS),
    ]);
    _legacyMigration = null;
    _hydrated = true;
  })().finally(() => {
    _hydrating = null;
  });

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

  /** Aguarda as escritas e retenta falhas antes da atualização PWA. */
  async flush(): Promise<void> {
    // Reavalie as escritas que chegaram enquanto o primeiro lote terminava.
    while (_pending.size) await Promise.all([..._pending]);
    // Uma falha que aconteceu antes do flush também impede perder a edição
    // em memória. Tente uma vez por chamada; a guarda PWA limita a frequência.
    const failed = [..._failed.entries()];
    await Promise.all(failed.map(([key, failure]) => _track(key, failure.operation)));
    while (_pending.size) await Promise.all([..._pending]);
    if (_failed.size) throw _failed.values().next().value!.error;
  },

  async saveCategory(cat: ScheduledCategory): Promise<void> {
    const normalized = { ...cat, id: String(cat.id) };
    const i = _categories.findIndex((c) => String(c.id) === String(cat.id));
    if (i >= 0) _categories[i] = normalized;
    else _categories.push(normalized);
    await _track(`${TABLE_CATEGORIES}:${normalized.id}`, () =>
      $docs.put(TABLE_CATEGORIES, normalized)
    );
  },

  async deleteCategory(id: string | number): Promise<void> {
    _categories = _categories.filter((c) => String(c.id) !== String(id));
    const affected = _items.filter((i) => String(i.categoria) === String(id));
    _items = _items.filter((i) => String(i.categoria) !== String(id));
    // Envie todas as exclusões desde o início. Se uma falhar, cada documento
    // mantém seu retry, inclusive os itens que antes nem chegavam à escrita.
    await Promise.all([
      _track(`${TABLE_CATEGORIES}:${id}`, () => $docs.del(TABLE_CATEGORIES, String(id))),
      ...affected.map((item) =>
        _track(`${TABLE_ITEMS}:${item.id}`, () => $docs.del(TABLE_ITEMS, String(item.id)))
      ),
    ]);
  },

  async saveItem(item: ScheduledItem): Promise<void> {
    const normalized = { ...item, id: String(item.id) };
    const i = _items.findIndex((x) => String(x.id) === String(item.id));
    if (i >= 0) _items[i] = normalized;
    else _items.push(normalized);
    await _track(`${TABLE_ITEMS}:${normalized.id}`, () => $docs.put(TABLE_ITEMS, normalized));
  },

  async deleteItem(id: string | number): Promise<void> {
    _items = _items.filter((x) => String(x.id) !== String(id));
    await _track(`${TABLE_ITEMS}:${id}`, () => $docs.del(TABLE_ITEMS, String(id)));
  },
};
