import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LibraryGroupedView from "../LibraryGroupedView.vue";

const groups = [
  { id: "cat-1", name: "Culto", items: [{ id: "a", name: "A" }] },
  { id: "cat-2", name: "Avisos", items: [{ id: "b", name: "B" }] },
];

describe("LibraryGroupedView", () => {
  it("renderiza os grupos e os itens na grade", () => {
    const wrapper = mount(LibraryGroupedView, {
      props: { groups, view: "grid" },
      slots: {
        "grid-item": ({ item }: { item: unknown }) => (item as { name: string }).name,
        "list-item": () => "lista",
      },
    });

    expect(wrapper.findAll(".lgv-group")).toHaveLength(2);
    expect(wrapper.text()).toContain("Culto");
    expect(wrapper.text()).toContain("Avisos");
    expect(wrapper.findAll(".lgv-items--grid")).toHaveLength(2);
    expect(wrapper.findAll(".lgv-items--list")).toHaveLength(0);
  });

  it("troca para a lista sem perder os grupos", () => {
    const wrapper = mount(LibraryGroupedView, {
      props: { groups, view: "list" },
      slots: {
        "grid-item": () => "grade",
        "list-item": ({ item }: { item: unknown }) => (item as { name: string }).name,
      },
    });

    expect(wrapper.findAll(".lgv-items--grid")).toHaveLength(0);
    expect(wrapper.findAll(".lgv-items--list")).toHaveLength(2);
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
  });
});
