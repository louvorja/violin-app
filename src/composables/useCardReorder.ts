import { ref, watch, type Ref } from "vue";
import { reorderItem, type SortableItem } from "@/helpers/ItemSort";

interface UseCardReorderOptions<T extends SortableItem> {
  /** Só reordena quando o seletor está em "Personalizada". */
  enabled: () => boolean;
  draggingId: Ref<string | null>;
  /** Lista completa do módulo, não a filtrada pela tela. */
  items: Ref<T[]>;
  save: (_item: T) => Promise<unknown>;
}

/**
 * Reordenação de cards por HTML5 drag-and-drop.
 *
 * O `dragstart` continua sendo o do `useCategoryDrag`, que também move o card
 * para uma categoria quando o drop cai num chip. Aqui o drop no próprio card
 * vira reordenação e não deixa o evento chegar ao container de importação.
 */
export function useCardReorder<T extends SortableItem>(options: UseCardReorderOptions<T>) {
  const orderTargetId = ref<string | null>(null);

  function canReorder(sourceId: string | null, targetId: string): sourceId is string {
    return !!sourceId && sourceId !== targetId && options.enabled();
  }

  function onCardOrderDragOver(event: DragEvent, targetId: string): void {
    if (!canReorder(options.draggingId.value, targetId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    orderTargetId.value = targetId;
  }

  function onCardOrderDragLeave(event: DragEvent, targetId: string): void {
    if (orderTargetId.value !== targetId) return;
    const current = event.currentTarget;
    const related = event.relatedTarget;
    if (current instanceof Node && related instanceof Node && current.contains(related)) return;
    orderTargetId.value = null;
  }

  async function onCardOrderDrop(event: DragEvent, targetId: string): Promise<void> {
    const sourceId = options.draggingId.value;
    if (!canReorder(sourceId, targetId)) return;
    event.preventDefault();
    event.stopPropagation();
    orderTargetId.value = null;

    const previous = new Map(options.items.value.map((item) => [item.id, item.order]));
    const { changed } = reorderItem(options.items.value, sourceId, targetId);
    try {
      for (const item of changed) await options.save(item);
    } catch (error) {
      for (const item of changed) item.order = previous.get(item.id);
      console.warn("[card-order] falha ao salvar a ordem:", error);
    }
  }

  watch(
    options.draggingId,
    (value) => {
      if (!value) orderTargetId.value = null;
    },
    { flush: "sync" }
  );

  return { orderTargetId, onCardOrderDragOver, onCardOrderDragLeave, onCardOrderDrop };
}
