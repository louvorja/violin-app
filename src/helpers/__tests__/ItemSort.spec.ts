import { describe, expect, it } from "vitest";
import { reorderItem, sortByMode, type SortableItem } from "@/helpers/ItemSort";

interface Item extends SortableItem {
  name: string;
}

const items: Item[] = [
  { id: "b", name: "Beta", order: 2 },
  { id: "a", name: "Alfa", order: 0 },
  { id: "c", name: "Gama", order: 1 },
];

describe("ItemSort — ordenação dos cards", () => {
  it("ordena por nome em A–Z e Z–A, ignorando a ordem manual", () => {
    expect(sortByMode(items, "alpha_asc", (item) => item.name).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortByMode(items, "alpha_desc", (item) => item.name).map((item) => item.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("em personalizada usa order e mantém sem ordem no fim, na ordem original", () => {
    const mixed: Item[] = [
      { id: "sem-1", name: "Sem 1" },
      { id: "com-1", name: "Com 1", order: 2 },
      { id: "sem-2", name: "Sem 2" },
      { id: "com-0", name: "Com 0", order: 1 },
    ];
    expect(sortByMode(mixed, "custom", (item) => item.name).map((item) => item.id)).toEqual([
      "com-0",
      "com-1",
      "sem-1",
      "sem-2",
    ]);
  });

  it("move o card para a posição do alvo e renumera os que mudaram", () => {
    const { ordered, changed } = reorderItem(items, "b", "a");
    expect(ordered.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(ordered.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(changed.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);

    const again = reorderItem(ordered, "a", "a");
    expect(again.changed).toEqual([]);
  });
});
