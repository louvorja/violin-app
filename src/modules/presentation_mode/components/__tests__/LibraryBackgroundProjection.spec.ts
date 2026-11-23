import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { KEYS } from "@/constants/UserDataKeys";

const mocks = vi.hoisted(() => ({
  activate: vi.fn(async () => true),
  clear: vi.fn(),
  stop: vi.fn(async () => {}),
  open: vi.fn(),
  error: vi.fn(),
  broadcast: { handler: null as null | ((_payload: unknown) => void) },
  userdata: { playing: false },
  bgp: {
    records: { value: [] as Record<string, unknown>[] },
    categories: { value: [] as Record<string, unknown>[] },
    filter: { value: "*" },
    loading: { value: false },
    loaded: { value: true },
    filtered: { value: [] as Record<string, unknown>[] },
    hasUncategorized: { value: false },
    countOf: vi.fn(() => 1),
    categoryOf: vi.fn(),
    categoryImageOf: vi.fn(() => ""),
    thumbOf: vi.fn(),
    load: vi.fn(async () => {}),
    disposeThumbs: vi.fn(),
    displayName: (file: { name?: string; id: string }) => (file.name || "").trim() || file.id,
  },
}));

vi.mock("@/helpers/BackgroundProjectionPlayback", () => ({
  activateBackgroundProjection: mocks.activate,
  clearBackgroundProjection: mocks.clear,
  stopBackgroundProjection: mocks.stop,
}));
vi.mock("@/helpers/Modules", () => ({ default: { open: mocks.open } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { error: mocks.error, info: vi.fn() } }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: () => mocks.userdata.playing },
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (_type: string, _handler: (_payload: unknown) => void) => {
    mocks.broadcast.handler = _handler;
  },
}));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));
vi.mock("@/modules/presentation_mode/composables/useBackgroundProjectionLibrary", () => ({
  useBackgroundProjectionLibrary: () => mocks.bgp,
  BACKGROUND_PROJECTION_ALL: "*",
  BACKGROUND_PROJECTION_UNCATEGORIZED: "",
}));

import LibraryBackgroundProjection from "../LibraryBackgroundProjection.vue";

const records = [
  {
    id: "p1",
    name: "Culto",
    path: "/culto.jpg",
    type: "image",
    categoryId: "c1",
    thumb: "/culto.jpg",
  },
  { id: "p2", name: "Mar", path: "/mar.mp4", type: "video", categoryId: "", order: 2 },
];

const categories = [{ id: "c1", name: "Natureza", color: "#3a7", icon: "leaf" }];

function mount() {
  return shallowMount(LibraryBackgroundProjection, {
    global: {
      stubs: {
        LjInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
        LjEmpty: { props: ["title"], template: "<div>{{ title }}</div>" },
        LjTabs: {
          props: ["modelValue", "tabs"],
          emits: ["update:modelValue"],
          template: `<div class="pm-bgp__tabs"><button
            v-for="tab in tabs"
            :key="tab.value"
            class="pm-bgp__tab"
            :data-value="tab.value"
            @click="$emit('update:modelValue', tab.value)"
          >{{ tab.label }}</button></div>`,
        },
        CategoryListItem: {
          props: ["categoryId", "name", "count", "active", "icon", "iconType", "color"],
          template:
            '<button class="pm-category-item" :data-category-id="categoryId" :data-icon="icon" :data-icon-type="iconType" :data-active="String(active)">{{ name }}<span>{{ count }}</span></button>',
        },
      },
    },
  });
}

describe("LibraryBackgroundProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.userdata.playing = false;
    mocks.broadcast.handler = null;
    mocks.activate.mockResolvedValue(true);

    mocks.bgp.records.value = records;
    mocks.bgp.categories.value = categories;
    mocks.bgp.filtered.value = records;
    mocks.bgp.filter.value = "*";
    mocks.bgp.loading.value = false;
    mocks.bgp.loaded.value = true;
    mocks.bgp.hasUncategorized.value = true;
    mocks.bgp.categoryOf.mockImplementation(
      (file: { categoryId?: string }) =>
        categories.find((category) => category.id === file.categoryId) || null
    );
    mocks.bgp.categoryImageOf.mockReturnValue("");
    mocks.bgp.thumbOf.mockImplementation((file: { thumb?: string }) => file.thumb || "");
  });

  it("lista as mídias com miniatura, categoria e cor", async () => {
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.findAll(".pm-bgp__card")).toHaveLength(2);

    const image = wrapper.find('[data-testid="pm-bgp-card-p1"]');
    expect(image.attributes("style")).toContain("--pm-bgp-card-color: #3a7");
    expect(image.find(".pm-bgp__category").text()).toContain("Natureza");
    expect(image.find(".pm-bgp__thumb-img").attributes("src")).toBe("/culto.jpg");

    const video = wrapper.find('[data-testid="pm-bgp-card-p2"]');
    expect(video.attributes("style")).toContain("--pm-bgp-card-color: #607d8b");
    expect(video.find(".pm-bgp__category").text()).toContain(
      "library.background_projection_uncategorized"
    );
    expect(video.find(".pm-bgp__play-badge").exists()).toBe(true);
  });

  it("ativa a projeção com um clique e acrescenta ao programa pelo +", async () => {
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgp-card-p1"]').trigger("click");
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));

    mocks.activate.mockClear();
    await wrapper.find('[data-testid="pm-bgp-add-p1"]').trigger("click");
    expect(mocks.activate).not.toHaveBeenCalled();

    const added = wrapper.emitted("add")?.[0]?.[0] as Record<string, unknown>;
    expect(added).toMatchObject({
      kind: "image",
      title: "Culto",
      subtitle: "Natureza",
    });
  });

  it("mostra o aviso quando a mídia não pode ser ativada", async () => {
    mocks.activate.mockResolvedValue(false);
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgp-card-p1"]').trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("library.background_projection_unplayable");
  });

  it("mostra o aviso quando a ativação falha com exceção", async () => {
    mocks.activate.mockRejectedValue(new Error("falhou"));
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgp-card-p1"]').trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("library.background_projection_unplayable");
  });

  it("mostra o aviso quando encerrar a projeção falha", async () => {
    mocks.userdata.playing = true;
    mocks.stop.mockRejectedValue(new Error("falhou"));
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgp-stop"]').trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("library.background_projection_stop_failed");
  });

  it("destaca o card no ar e sobe a barra com limpar e encerrar", async () => {
    mocks.userdata.playing = true;
    const wrapper = mount();
    await flushPromises();

    mocks.broadcast.handler?.({
      active: true,
      id: "p1",
      epoch: 10,
      type: "image",
      url: "blob:p1",
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-bgp-card-p1"]').classes()).toContain(
      "pm-bgp__card--active"
    );
    const bar = wrapper.find('[data-testid="pm-bgp-bar"]');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain("Culto");
    expect(bar.text()).toContain("Natureza");

    await wrapper.find('[data-testid="pm-bgp-clear"]').trigger("click");
    expect(mocks.clear).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-testid="pm-bgp-stop"]').trigger("click");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("ignora pacote atrasado e mantém o card da mídia mais recente", async () => {
    mocks.userdata.playing = true;
    const wrapper = mount();
    await flushPromises();

    mocks.broadcast.handler?.({
      active: true,
      id: "p1",
      epoch: 10,
      type: "image",
      url: "blob:p1",
    });
    mocks.broadcast.handler?.({
      active: true,
      id: "p2",
      epoch: 9,
      type: "video",
      url: "blob:p2",
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-bgp-card-p1"]').classes()).toContain(
      "pm-bgp__card--active"
    );
    expect(wrapper.find('[data-testid="pm-bgp-card-p2"]').classes()).not.toContain(
      "pm-bgp__card--active"
    );
  });

  it("restaura o card ativo do cache ao abrir a aba", async () => {
    mocks.userdata.playing = true;
    localStorage.setItem(
      KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION,
      JSON.stringify({ active: true, epoch: 5, type: "video", url: "blob:x", id: "p2" })
    );

    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-bgp-card-p2"]').classes()).toContain(
      "pm-bgp__card--active"
    );
    expect(wrapper.find('[data-testid="pm-bgp-bar"]').text()).toContain("Mar");
  });

  it("não sobe a barra sem projeção aberta", async () => {
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-bgp-bar"]').exists()).toBe(false);
  });

  it("usa a imagem enviada da categoria no chip e no card", async () => {
    mocks.bgp.categoryImageOf.mockReturnValue("blob:categoria");
    const wrapper = mount();
    await flushPromises();

    const categoryIcon = wrapper.find(
      '[data-testid="pm-bgp-card-p1"] .pm-bgp__category-icon'
    );
    expect(categoryIcon.attributes("src")).toBe("blob:categoria");

    const chip = wrapper.find('.pm-category-item[data-category-id="c1"]');
    expect(chip.attributes("data-icon")).toBe("blob:categoria");
    expect(chip.attributes("data-icon-type")).toBe("image");
  });

  it("coloca busca e chips na lateral e mantém o filtro de mídia no conteúdo", async () => {
    const wrapper = mount();
    await flushPromises();

    const main = wrapper.find(".pm-bgp__main");
    expect(main.exists()).toBe(true);
    expect(main.element.firstElementChild?.className).toContain("pm-bgp__side");
    expect(main.element.lastElementChild?.className).toContain("pm-bgp__content");

    expect(wrapper.find(".pm-bgp__side .pm-bgp__search").exists()).toBe(true);
    expect(wrapper.find(".pm-bgp__side .pm-bgp__chips").exists()).toBe(true);
    expect(wrapper.find(".pm-bgp__side .pm-category-item").exists()).toBe(true);
    expect(wrapper.find(".pm-bgp__content .pm-bgp__toolbar").exists()).toBe(true);
  });

  it("filtra pela busca e pelo tipo de mídia", async () => {
    const wrapper = mount();
    await flushPromises();

    await wrapper.find(".pm-bgp__tab[data-value='video']").trigger("click");
    expect(wrapper.findAll(".pm-bgp__card")).toHaveLength(1);
    expect(wrapper.find('[data-testid="pm-bgp-card-p2"]').exists()).toBe(true);

    await wrapper.find(".pm-bgp__tab[data-value='all']").trigger("click");
    await wrapper.find("input").setValue("culto");
    expect(wrapper.findAll(".pm-bgp__card")).toHaveLength(1);
    expect(wrapper.find('[data-testid="pm-bgp-card-p1"]').exists()).toBe(true);
  });

  it("abre o módulo pelo rodapé", async () => {
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgp-manage"]').trigger("click");
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });
});
