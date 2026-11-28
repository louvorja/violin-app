import { describe, expect, it } from "vitest";
import { shallowMount } from "@vue/test-utils";
import CategoryListItem from "../CategoryListItem.vue";

function mount(props: Record<string, unknown> = {}) {
  return shallowMount(CategoryListItem, {
    props: { name: "Natureza", count: 4, color: "#3a7", icon: "leaf", ...props },
    global: {
      stubs: {
        LjIcon: {
          props: ["icon", "size"],
          template: '<i class="pm-category-item__stub-icon" :data-icon="icon" />',
        },
      },
    },
  });
}

describe("CategoryListItem", () => {
  it("mostra ícone, nome e contador como as pastas da biblioteca", () => {
    const wrapper = mount();

    const root = wrapper.find(".pm-category-item");
    expect(root.attributes("style")).toContain("--pm-category-item-color: #3a7");
    expect(root.find(".pm-category-item__stub-icon").attributes("data-icon")).toBe("leaf");
    expect(root.find(".pm-category-item__name").text()).toBe("Natureza");
    expect(root.find(".pm-category-item__count").text()).toBe("4");
  });

  it("marca o item ativo e emite a seleção no clique", async () => {
    const wrapper = mount({ active: true });

    expect(wrapper.find(".pm-category-item").classes()).toContain("pm-category-item--active");
    expect(wrapper.find(".pm-category-item").attributes("aria-pressed")).toBe("true");

    await wrapper.find(".pm-category-item").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("renderiza a imagem da categoria quando o ícone é uma imagem", () => {
    const wrapper = mount({
      icon: "blob:categoria",
      iconType: "image",
    });

    expect(wrapper.find(".pm-category-item__img").attributes("src")).toBe("blob:categoria");
  });
});
