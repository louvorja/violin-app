/**
 * Ordenação dos cards das bibliotecas com categorias.
 *
 * `custom` preserva a ordem gravada em `order` e, quando o item ainda não tem
 * ordem, mantém a posição em que veio do IndexedDB. É o modo em que o
 * drag-and-drop de reordenação fica liberado.
 */

export type ItemSortMode = "alpha_asc" | "alpha_desc" | "custom";

export const ITEM_SORT_MODES: readonly ItemSortMode[] = ["custom", "alpha_asc", "alpha_desc"];

export interface SortableItem {
  id: string;
  order?: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function isItemSortMode(value: unknown): value is ItemSortMode {
  return value === "alpha_asc" || value === "alpha_desc" || value === "custom";
}

export function sortByMode<T extends SortableItem>(
  items: readonly T[],
  mode: ItemSortMode,
  nameOf: (_item: T) => string
): T[] {
  const copy = [...items];
  if (mode !== "custom") {
    const direction = mode === "alpha_desc" ? -1 : 1;
    return copy.sort((left, right) => direction * collator.compare(nameOf(left), nameOf(right)));
  }
  return copy
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.item.order)
        ? (left.item.order as number)
        : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(right.item.order)
        ? (right.item.order as number)
        : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map((entry) => entry.item);
}

/**
 * Move `sourceId` para a posição de `targetId`, renumera a lista completa e
 * devolve só os itens cuja ordem mudou (para gravar sem tocar no resto).
 */
export function reorderItem<T extends SortableItem>(
  items: readonly T[],
  sourceId: string,
  targetId: string
): { ordered: T[]; changed: T[] } {
  const ordered = sortByMode(items, "custom", () => "");
  const from = ordered.findIndex((item) => item.id === sourceId);
  const to = ordered.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return { ordered, changed: [] };

  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);

  const changed: T[] = [];
  ordered.forEach((item, index) => {
    if (item.order !== index) {
      item.order = index;
      changed.push(item);
    }
  });
  return { ordered, changed };
}
