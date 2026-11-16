import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useCardReorder } from "@/composables/useCardReorder";
import { sortByMode } from "@/helpers/ItemSort";

interface Card {
  id: string;
  name: string;
  order?: number;
}

function setup(enabled = true) {
  const items = ref<Card[]>([
    { id: "a", name: "Alfa", order: 0 },
    { id: "b", name: "Beta", order: 1 },
    { id: "c", name: "Gama", order: 2 },
  ]);
  const draggingId = ref<string | null>(null);
  const save = vi.fn(async (_item: Card) => {});
  const reorder = useCardReorder<Card>({
    enabled: () => enabled,
    draggingId,
    items,
    save,
  });
  return { items, draggingId, save, reorder };
}

const drop = (targetId: string) =>
  ({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as DragEvent;

describe("useCardReorder", () => {
  it("reordena ao soltar em outro card e grava só a ordem alterada", async () => {
    const { items, draggingId, save, reorder } = setup();
    draggingId.value = "c";
    await reorder.onCardOrderDrop(drop("a"), "a");
    await nextTick();

    expect(sortByMode(items.value, "custom", (item) => item.name).map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(
      sortByMode(items.value, "custom", (item) => item.name).map((item) => item.order)
    ).toEqual([0, 1, 2]);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("não faz nada quando a ordenação personalizada está desligada", async () => {
    const { items, draggingId, save, reorder } = setup(false);
    draggingId.value = "c";
    await reorder.onCardOrderDrop(drop("a"), "a");
    expect(sortByMode(items.value, "custom", (item) => item.name).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it("limpa o alvo visual quando o drag termina", async () => {
    const { draggingId, reorder } = setup();
    draggingId.value = "b";
    reorder.onCardOrderDragOver(drop("a"), "a");
    expect(reorder.orderTargetId.value).toBe("a");
    draggingId.value = null;
    await nextTick();
    expect(reorder.orderTargetId.value).toBeNull();
  });
});
