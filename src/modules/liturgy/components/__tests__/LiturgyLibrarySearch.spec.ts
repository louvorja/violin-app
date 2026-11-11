import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({
    t: (key: string) =>
      (
        ({
          "library_search.all_categories": "Todas",
          "library_search.uncategorized": "Sem categoria",
          "library_search.empty": "Nenhum item",
          "library_search.empty_search": "Nada encontrado",
          "library_search.keyboard_hint": "Setas e Enter",
          "actions.cancel": "Cancelar",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

import LiturgyLibrarySearch from "../LiturgyLibrarySearch.vue";

const items = [
  {
    id: "media-1",
    name: "Foto do culto",
    categoryId: "cat-1",
    thumbnail: "blob:foto",
    type: "image",
    typeLabel: "IMAGE",
  },
  {
    id: "media-2",
    name: "Aviso",
    categoryId: "",
    icon: "file",
    type: "pdf",
    typeLabel: "PDF",
  },
];

const categories = [
  { id: "cat-1", name: "Culto", iconType: "icon" as const, icon: "folder", color: "#123456" },
];

const stubs = {
  LjDialog: {
    props: ["modelValue"],
    template: '<div><slot /><slot name="footer" /></div>',
  },
  LjInput: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    methods: { focus() {} },
    template:
      '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  LjButton: { template: "<button><slot /></button>" },
  LjIcon: true,
};

function mountSearch() {
  return mount(LiturgyLibrarySearch, {
    props: { modelValue: true, items, categories, title: "Biblioteca" },
    global: { stubs },
  });
}

describe("LiturgyLibrarySearch", () => {
  it("abre em miniaturas, agrupa por categoria e alterna para lista", async () => {
    const wrapper = mountSearch();
    await nextTick();

    expect(wrapper.find(".lgv-items--grid").exists()).toBe(true);
    expect(wrapper.text()).toContain("Culto");
    expect(wrapper.text()).toContain("Sem categoria");
    expect(wrapper.findAll(".llb-thumb")).toHaveLength(2);

    await wrapper.findAll(".llb-view")[1].trigger("click");
    expect(wrapper.find(".lgv-items--grid").exists()).toBe(false);
    expect(wrapper.find(".lgv-items--list").exists()).toBe(true);
    expect(wrapper.findAll(".llb-row")).toHaveLength(2);
  });

  it("filtra por categoria e emite o item escolhido", async () => {
    const wrapper = mountSearch();
    await nextTick();

    const categoryChip = wrapper.findAll(".llb-chip").find((chip) => chip.text().includes("Culto"));
    expect(categoryChip).toBeDefined();
    await categoryChip!.trigger("click");
    expect(wrapper.findAll(".llb-thumb")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Aviso");

    await wrapper.find(".llb-thumb").trigger("click");
    expect(wrapper.emitted("pick")?.[0]?.[0]).toMatchObject({ id: "media-1" });
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });
});
