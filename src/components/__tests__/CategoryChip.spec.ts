import { describe, expect, it } from "vitest";
import CategoryChip from "@/components/CategoryChip.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

function montar(overrides: Record<string, unknown> = {}) {
  return mountUi(CategoryChip, {
    props: {
      categoryId: "cat1",
      name: "Culto",
      icon: "folder",
      iconType: "icon",
      color: "#4caf50",
      count: 3,
      ...overrides,
    },
  });
}

describe("CategoryChip", () => {
  it("mostra nome, contador, estado ativo e alvo de drop", () => {
    const wrapper = montar({ active: true, dropTarget: true });

    expect(wrapper.text()).toContain("Culto");
    expect(wrapper.find(".lj-category-chip__count").text()).toBe("3");
    expect(wrapper.classes()).toContain("lj-category-chip--active");
    expect(wrapper.classes()).toContain("lj-category-chip--drop-target");
    expect(wrapper.attributes("data-category-drop-id")).toBe("cat1");
  });

  it("emite select ao clicar", async () => {
    const wrapper = montar();

    await wrapper.trigger("click");

    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("separa o clique do botão adicionar do clique do chip", async () => {
    const wrapper = montar({ showAdd: true, addLabel: "Adicionar" });

    await wrapper.find(".lj-category-chip__add").trigger("click");

    expect(wrapper.emitted("add")).toHaveLength(1);
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
