import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";

const state = vi.hoisted(() => ({
  supported: true,
  records: { value: [] as unknown[] },
  categories: {
    value: [] as Array<{
      id: string;
      name: string;
      color?: string;
      icon?: string;
      iconType?: "icon" | "image";
    }>,
  },
  filter: { value: "*" },
  loading: { value: false },
  loaded: { value: true },
  entries: { value: [] as unknown[] },
  unavailable: { value: 0 },
  hasUncategorized: { value: true },
  countOf: vi.fn((id: string) => (id === "*" ? 4 : id === "c1" ? 2 : 1)),
  categoryImageOf: vi.fn(() => ""),
  load: vi.fn(async () => {}),
  disposeCategoryIcons: vi.fn(),
}));

vi.mock("@/modules/presentation_mode/composables/useNativeMediaLibrary", () => ({
  useNativeMediaLibrary: () => state,
  ALL: "*",
}));
vi.mock("@/helpers/Modules", () => ({ default: { open: vi.fn() } }));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
    locale: { value: "pt-BR" },
  }),
}));

import { ICONS } from "@/config/Icons";
import LibraryNativeMedia from "../LibraryNativeMedia.vue";

function mount() {
  return shallowMount(LibraryNativeMedia, {
    props: { livePath: null, returnPath: null },
    global: {
      stubs: {
        FileGrid: {
          props: ["entries"],
          emits: ["details"],
          template:
            '<div class="pm-native-grid-stub">{{ entries.length }}<button class="details-stub" @click="$emit(\'details\', entries[0])" /></div>',
        },
        LjInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjEmpty: { props: ["title"], template: "<div>{{ title }}</div>" },
        LjTabs: {
          props: ["modelValue", "tabs"],
          emits: ["update:modelValue"],
          template:
            '<div class="pm-native-tabs-stub"><button v-for="tab in tabs" :key="tab.value" :data-tab="tab.value" @click="$emit(\'update:modelValue\', tab.value)" /></div>',
        },
        LjIcon: true,
        CategoryListItem: {
          props: ["categoryId", "name", "count", "active", "icon", "iconType", "color"],
          emits: ["select"],
          template:
            '<button class="pm-category-item" :data-category-id="categoryId" :data-active="String(active)" :data-count="count" :data-color="color" :data-icon="icon" :data-icon-type="iconType" @click="$emit(\'select\')"><span class="pm-category-item__name">{{ name }}</span></button>',
        },
      },
    },
  });
}

describe("LibraryNativeMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.filter.value = "*";
    state.entries.value = [];
    state.categoryImageOf.mockReturnValue("");
    state.categories.value = [
      { id: "c1", name: "Natureza", color: "#3a7", icon: "leaf", iconType: "icon" },
      { id: "c2", name: "Culto" },
    ];
    state.loaded.value = true;
    state.loading.value = false;
  });

  it("usa as linhas de categoria do presentation mode, com nome e contador", async () => {
    const wrapper = mount();
    await flushPromises();

    const rows = wrapper.findAll(".pm-category-item");
    expect(rows).toHaveLength(4);

    const all = wrapper.find('[data-testid="pm-native-all"]');
    expect(all.attributes("data-category-id")).toBe("*");
    expect(all.attributes("data-count")).toBe("4");
    expect(all.attributes("data-active")).toBe("true");
    expect(all.attributes("data-icon")).toBeTruthy();

    const category = wrapper.find('[data-testid="pm-native-category-c1"]');
    expect(category.attributes("data-category-id")).toBe("c1");
    expect(category.attributes("data-count")).toBe("2");
    expect(category.attributes("data-color")).toBe("#3a7");
    expect(category.attributes("data-icon")).toBe("leaf");
    expect(category.attributes("data-icon-type")).toBe("icon");

    const fallback = wrapper.find('[data-testid="pm-native-category-c2"]');
    expect(fallback.attributes("data-icon")).toBe(ICONS.UI.FOLDER);

    const uncategorized = wrapper.find('[data-testid="pm-native-uncategorized"]');
    expect(uncategorized.attributes("data-category-id")).toBe("");
    expect(uncategorized.attributes("data-count")).toBe("1");
  });

  it("usa a imagem enviada da categoria no lugar do ícone de pasta", async () => {
    state.categoryImageOf.mockReturnValue("blob:categoria");
    const wrapper = mount();
    await flushPromises();

    const category = wrapper.find('[data-testid="pm-native-category-c1"]');
    expect(category.attributes("data-icon")).toBe("blob:categoria");
    expect(category.attributes("data-icon-type")).toBe("image");
  });

  it("mantém a busca acima das categorias e filtra a grade", async () => {
    state.entries.value = [
      {
        name: "Batismo.jpg",
        path: "/fotos/batismo.jpg",
        isDir: false,
        ext: "jpg",
        size: 0,
        mtimeMs: 0,
      },
      {
        name: "Ensaio.mp4",
        path: "/videos/ensaio.mp4",
        isDir: false,
        ext: "mp4",
        size: 0,
        mtimeMs: 0,
      },
    ];

    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find(".pm-native__side .pm-native__search input").exists()).toBe(true);
    expect(wrapper.find(".pm-native__side .pm-folders").exists()).toBe(true);
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("2");

    await wrapper.find(".pm-native__search input").setValue("batismo");
    await flushPromises();
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("1");

    await wrapper.find(".pm-native__search input").setValue("não existe");
    await flushPromises();
    expect(wrapper.find(".pm-files__empty").text()).toContain("native.no_results");
  });

  it("filtra a grade pelas abas de tipo de arquivo", async () => {
    state.entries.value = [
      { name: "foto.jpg", path: "/fotos/foto.jpg", isDir: false, ext: "jpg", size: 0, mtimeMs: 0 },
      { name: "video.mp4", path: "/videos/video.mp4", isDir: false, ext: "mp4", size: 0, mtimeMs: 0 },
      { name: "documento.pdf", path: "/docs/documento.pdf", isDir: false, ext: "pdf", size: 0, mtimeMs: 0 },
    ];
    const wrapper = mount();
    await flushPromises();
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("3");

    await wrapper.find('[data-tab="video"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("1");

    await wrapper.find('[data-tab="document"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("1");

    await wrapper.find('[data-tab="image"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-native-grid-stub").text()).toBe("1");

    await wrapper.find('[data-tab="audio"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-files__empty").text()).toContain("native.no_results");
  });

  it("abre os detalhes do item e envia para a tela ou para o programa", async () => {
    state.entries.value = [
      {
        name: "foto.jpg",
        path: "/fotos/foto.jpg",
        isDir: false,
        ext: "jpg",
        size: 0,
        mtimeMs: 0,
      },
    ];
    const wrapper = mount();
    await flushPromises();

    await wrapper.find(".details-stub").trigger("click");
    expect(wrapper.find('[data-testid="pm-native-details"]').exists()).toBe(true);
    expect(wrapper.find(".pm-details__title").text()).toBe("foto.jpg");
    expect(wrapper.find(".pm-details__path").text()).toBe("/fotos/foto.jpg");

    await wrapper.find('[data-testid="pm-native-details-send"]').trigger("click");
    expect(wrapper.emitted("play")?.[0]?.[0]).toMatchObject({
      type: "file",
      entry: { path: "/fotos/foto.jpg" },
    });

    await wrapper.find('[data-testid="pm-native-details-close"]').trigger("click");
    expect(wrapper.find('[data-testid="pm-native-details"]').exists()).toBe(false);
  });

  it("troca o filtro ao clicar em uma categoria", async () => {
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-native-category-c1"]').trigger("click");
    expect(state.filter.value).toBe("c1");
  });
});
