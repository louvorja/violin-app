import { describe, expect, it } from "vitest";
import CategoryItemIcon from "@/components/CategoryItemIcon.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { LjIcon } from "@/components/ui";

describe("CategoryItemIcon", () => {
  it("renderiza o ícone da categoria com a cor e o rótulo", () => {
    const wrapper = mountUi(CategoryItemIcon, {
      props: {
        icon: "folder",
        iconType: "icon",
        color: "#4caf50",
        label: "Culto",
      },
    });

    expect(wrapper.findComponent(LjIcon).exists()).toBe(true);
    expect(wrapper.attributes("title")).toBe("Culto");
    expect(wrapper.attributes("style")).toContain("--category-item-color: #4caf50");
  });

  it("aceita o modo inline para o rodapé do card", () => {
    const wrapper = mountUi(CategoryItemIcon, {
      props: {
        icon: "folder",
        color: "#4caf50",
        inline: true,
      },
    });

    expect(wrapper.classes()).toContain("lj-category-item-icon--inline");
  });

  it("aceita a variante superior translúcida", () => {
    const wrapper = mountUi(CategoryItemIcon, {
      props: {
        icon: "folder",
        color: "#4caf50",
        placement: "top-left",
        translucent: true,
      },
    });

    expect(wrapper.classes()).toContain("lj-category-item-icon--top-left");
    expect(wrapper.classes()).toContain("lj-category-item-icon--translucent");
  });

  it("renderiza imagem quando o ícone da categoria é uma imagem", () => {
    const wrapper = mountUi(CategoryItemIcon, {
      props: {
        icon: "data:image/png;base64,AA==",
        iconType: "image",
        color: "#2196f3",
      },
    });

    expect(wrapper.find("img.lj-category-item-icon__img").exists()).toBe(true);
  });
});
