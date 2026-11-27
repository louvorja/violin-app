import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const state = vi.hoisted(() => ({
  supported: true,
  categories: {
    value: [
      { id: "c1", name: "Natureza", color: "#3a7", icon: "leaf", iconType: "icon" },
      { id: "c2", name: "Culto" },
    ],
  },
  filter: { value: "*" },
  countOf: vi.fn((id: string) => (id === "*" ? 4 : id === "c1" ? 2 : 1)),
  categoryImageOf: vi.fn(() => ""),
  load: vi.fn(async () => {}),
  disposeCategoryIcons: vi.fn(),
}));

vi.mock("@/modules/presentation_mode/composables/useNativeMediaLibrary", () => ({
  useNativeMediaLibrary: () => state,
  ALL: "*",
}));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));

import NativeMediaSources from "../NativeMediaSources.vue";

function mountSection(active = true) {
  return mount(NativeMediaSources, {
    props: { active },
    global: {
      stubs: {
        LjIcon: true,
        CategoryListItem: {
          props: ["categoryId", "name", "count", "active", "icon", "iconType", "color"],
          emits: ["select"],
          template:
            '<button class="pm-category-item" v-bind="$attrs" :data-category-id="categoryId" :data-count="count" :data-active="String(active)" @click="$emit(\'select\')">{{ name }}</button>',
        },
      },
    },
  });
}

describe("NativeMediaSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.filter.value = "*";
    state.categories.value = [
      { id: "c1", name: "Natureza", color: "#3a7", icon: "leaf", iconType: "icon" },
      { id: "c2", name: "Culto" },
    ];
  });

  it("mostra Todas, as categorias e Sem categoria", async () => {
    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-native-src-all"]').attributes("data-category-id")).toBe("*");
    expect(wrapper.find('[data-testid="pm-native-src-category-c1"]').text()).toBe("Natureza");
    expect(wrapper.find('[data-testid="pm-native-src-category-c2"]').text()).toBe("Culto");
    expect(wrapper.find('[data-testid="pm-native-src-uncategorized"]').attributes("data-category-id")).toBe("");
    expect(wrapper.find('[data-testid="pm-native-src-all"]').attributes("data-active")).toBe("true");
  });

  it("seleciona uma categoria e emite o filtro", async () => {
    const wrapper = mountSection();
    await flushPromises();

    await wrapper.find('[data-testid="pm-native-src-category-c1"]').trigger("click");

    expect(state.filter.value).toBe("c1");
    expect(wrapper.emitted("select")?.[0]).toEqual(["c1"]);
  });

  it("recolhe e expande as categorias pelo cabeçalho da seção", async () => {
    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.find(".pm-collapse").classes()).toContain("pm-collapse--open");
    await wrapper.find(".pm-native-src__group").trigger("click");
    expect(wrapper.find(".pm-collapse").classes()).not.toContain("pm-collapse--open");
    await wrapper.find(".pm-native-src__group").trigger("click");
    expect(wrapper.find(".pm-collapse").classes()).toContain("pm-collapse--open");
  });
});
