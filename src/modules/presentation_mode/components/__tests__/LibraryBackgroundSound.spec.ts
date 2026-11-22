import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { DB_TABLE } from "@/constants/DbTables";

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));
const sound = vi.hoisted(() => ({
  currentFile: { value: null as null | { id: string } },
  isPlaying: { value: false },
  playFile: vi.fn(),
  togglePlay: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));
vi.mock("@/helpers/BackgroundSoundPath", () => ({
  resolveBackgroundSoundPath: () => "/acervo/som.mp3",
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/helpers/Modules", () => ({ default: { open: vi.fn() } }));
vi.mock("@/composables/useBackgroundSound", () => ({
  useBackgroundSound: () => sound,
}));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));

import LibraryBackgroundSound from "../LibraryBackgroundSound.vue";

const records = [
  { id: "s1", name: "Piano", fileName: "piano.mp3", categoryId: "c1", path: "/piano.mp3" },
  { id: "s2", name: "Chuva", fileName: "chuva.mp3", categoryId: "", path: "/chuva.mp3" },
];

function mount() {
  return shallowMount(LibraryBackgroundSound, {
    global: {
      stubs: {
        LjInput: { props: ["modelValue"], template: '<input :value="modelValue" />' },
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
        LjEmpty: { props: ["title"], template: "<div>{{ title }}</div>" },
        BackgroundSoundPlayer: {
          props: ["embedded"],
          template: '<div data-testid="pm-bgs-player" :data-embedded="String(embedded)" />',
        },
        CategoryChip: {
          props: ["categoryId", "name", "count", "active", "showMenu"],
          template:
            '<button class="pm-bgs__filter" :data-category-id="categoryId" :data-show-menu="String(showMenu)">{{ name }}</button>',
        },
      },
    },
  });
}

describe("LibraryBackgroundSound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sound.currentFile.value = null;
    sound.isPlaying.value = false;
    getAll.mockImplementation(async (table: string) => {
      if (table === DB_TABLE.BACKGROUND_SOUND_LIBRARY) return records;
      if (table === DB_TABLE.BACKGROUND_SOUND_CATEGORY) {
        return [{ id: "c1", name: "Natureza", color: "#3a7" }];
      }
      return [];
    });
  });

  it("lista os sons e toca com um clique", async () => {
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.findAll(".pm-bgs__card")).toHaveLength(2);

    await wrapper.find('[data-testid="pm-bgs-card-s1"]').trigger("click");
    expect(sound.playFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "s1",
        name: "Piano",
        path: "/acervo/som.mp3",
      })
    );
  });

  it("mantém os chips de categoria na mesma linha da busca", async () => {
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find(".pm-bgs__head .pm-bgs__filter").exists()).toBe(true);
    expect(wrapper.find(".pm-bgs__filters").element.parentElement?.className).toContain(
      "pm-bgs__head"
    );
    expect(wrapper.find(".pm-bgs__filter").attributes("data-show-menu")).toBe("false");
  });

  it("roda o mouse converte o eixo vertical em rolagem lateral dos chips", async () => {
    const wrapper = mount();
    await flushPromises();

    const filters = wrapper.find(".pm-bgs__filters").element as HTMLElement;
    Object.defineProperty(filters, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(filters, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(filters, "scrollLeft", { value: 0, writable: true, configurable: true });

    await wrapper.find(".pm-bgs__filters").trigger("wheel", { deltaY: 120, deltaMode: 0 });

    expect(filters.scrollLeft).toBe(120);
  });

  it("colore o card com a categoria e mostra o nome dela", async () => {
    const wrapper = mount();
    await flushPromises();

    const card = wrapper.find('[data-testid="pm-bgs-card-s1"]');
    expect(card.attributes("style")).toContain("--pm-bgs-card-color: #3a7");
    expect(card.find(".pm-bgs__category").text()).toContain("Natureza");

    const uncategorized = wrapper.find('[data-testid="pm-bgs-card-s2"]');
    expect(uncategorized.attributes("style")).toContain("--pm-bgs-card-color: #607d8b");
    expect(uncategorized.find(".pm-bgs__category").text()).toContain(
      "library.background_sound_uncategorized"
    );
  });

  it("sobe o player embutido quando há um som atual", async () => {
    sound.currentFile.value = { id: "s1" };
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find('[data-testid="pm-bgs-player"]').exists()).toBe(true);
  });

  it("não mostra o player sem som atual", async () => {
    const wrapper = mount();
    await flushPromises();
    expect(wrapper.find('[data-testid="pm-bgs-player"]').exists()).toBe(false);
  });

  it("o + adiciona ao programa sem tocar o som", async () => {
    const wrapper = mount();
    await flushPromises();

    await wrapper.find('[data-testid="pm-bgs-add-s1"]').trigger("click");

    expect(sound.playFile).not.toHaveBeenCalled();
    expect(wrapper.emitted("add")?.[0]?.[0]).toMatchObject({
      kind: "audio",
      title: "Piano",
      source: { tipo: "som-de-fundo", ref_id: "s1" },
    });
  });
});
