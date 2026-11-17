import { describe, expect, it } from "vitest";
import CategoryChipsBar from "@/components/CategoryChipsBar.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const CATEGORIES = [
  { id: "cat-1", name: "Culto", icon: "bible", iconType: "icon" as const, color: "#4CAF50" },
  { id: "cat-2", name: "Ensaios", icon: "music", iconType: "icon" as const, color: "#2196F3" },
];

const SORT_OPTIONS = [
  { value: "custom" as const, label: "Personalizada" },
  { value: "alpha_asc" as const, label: "A–Z" },
  { value: "alpha_desc" as const, label: "Z–A" },
];

function montar(overrides: Record<string, unknown> = {}) {
  return mountUi(CategoryChipsBar, {
    props: {
      title: "Categorias",
      categories: CATEGORIES,
      selectedIds: new Set(["cat-1"]),
      uncategorizedLabel: "Sem categoria",
      uncategorizedIcon: "folder",
      uncategorizedColor: "#999",
      uncategorizedCount: 1,
      countFor: () => 1,
      addItemLabel: "Adicionar item",
      editLabel: "Editar categoria",
      sortMode: "custom",
      sortOptions: SORT_OPTIONS,
      sortLabel: "Ordenar itens",
      showAllLabel: "Mostrar todas as categorias",
      hideAllLabel: "Ocultar todas as categorias",
      ...overrides,
    },
    global: {
      stubs: {
        CategoryChip: {
          props: ["categoryId", "name", "active", "addAllLabel"],
          emits: ["add-all"],
          template:
            '<button class="stub-chip" :data-cat="categoryId" :data-add-all="addAllLabel" @click="$emit(\'add-all\')">{{ name }}</button>',
        },
        LjSelect: {
          props: ["modelValue", "items"],
          emits: ["update:modelValue"],
          template:
            '<select class="stub-sort" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
        },
      },
    },
  });
}

describe("CategoryChipsBar", () => {
  it("mostra as categorias, a virtual e o seletor de ordenação", () => {
    const wrapper = montar();
    expect(wrapper.findAll(".stub-chip").map((chip) => chip.text())).toEqual([
      "Culto",
      "Ensaios",
      "Sem categoria",
    ]);
    expect(wrapper.find(".stub-sort").exists()).toBe(true);
  });

  it("no título, mostra todas quando falta alguma e oculta todas quando todas estão ativas", async () => {
    const wrapper = montar();
    await wrapper.get(".category-bar__title").trigger("click");
    expect([...(wrapper.emitted("update:selectedIds")?.[0]?.[0] as Set<string>)]).toEqual([
      "cat-1",
      "cat-2",
      "",
    ]);

    const all = montar({ selectedIds: new Set(["cat-1", "cat-2", ""]) });
    await all.get(".category-bar__title").trigger("click");
    expect((all.emitted("update:selectedIds")?.[0]?.[0] as Set<string>).size).toBe(0);
  });

  it("emite o novo modo de ordenação", async () => {
    const wrapper = montar();
    await wrapper.get(".stub-sort").setValue("alpha_desc");
    expect(wrapper.emitted("update:sortMode")?.[0]).toEqual(["alpha_desc"]);
  });

  it("mostra reproduzir categoria só quando playable e há rótulo", () => {
    const wrapper = montar({ playLabel: "Reproduzir categoria", playable: () => true });
    expect(wrapper.find(".stub-chip").attributes("data-cat")).toBe("cat-1");
  });

  it("repassa o rótulo e o evento de adicionar tudo ao chip", async () => {
    const wrapper = montar({ addAllLabel: "Adicionar tudo à playlist" });

    const chips = wrapper.findAll(".stub-chip");
    expect(chips[0].attributes("data-add-all")).toBe("Adicionar tudo à playlist");

    await chips[0].trigger("click");
    expect(wrapper.emitted("add-all")?.[0]).toEqual(["cat-1"]);
  });

  it("sem rótulo, não habilita adicionar tudo em nenhum chip", () => {
    const wrapper = montar();

    expect(wrapper.find(".stub-chip").attributes("data-add-all")).toBe("");
  });
});
