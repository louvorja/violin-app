import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { KEYS } from "@/constants/UserDataKeys";
import Index from "../Index.vue";

const saved = ref<Array<{ id_music: number; name: string }>>([]);
const disabled = ref<number[]>([]);
const persistReorder = vi.fn();
const catalog = Array.from({ length: 131 }, (_, index) => ({
  id_music: index + 1,
  name: `Música ${index + 1}`,
  albums: [{ id_album: index === 1 ? 629 : 10, name: "Coletânea" }],
}));

vi.mock("@/helpers/AppData", () => ({ default: { get: () => saved.value } }));
vi.mock("@/helpers/Favorites", () => ({
  default: {
    reorder: (songs: typeof saved.value) => {
      persistReorder(songs);
      saved.value = songs;
    },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) =>
      key === KEYS.OPTIONS.DISABLED_ALBUMS
        ? disabled.value
        : key.includes("hymnal_1996")
          ? true
          : fallback,
  },
}));
vi.mock("@/helpers/Database", () => ({
  default: { get: async (key: string) => (key.endsWith("_musics") ? catalog : []) },
}));
vi.mock("@/modules/favorites/manifest", () => ({ module: { id: "favorites" } }));
vi.mock("@/components/ModuleContainer.vue", () => ({
  default: {
    name: "ModuleContainer",
    props: ["manifest"],
    emits: ["scroll"],
    methods: { tm: (key: string) => key },
    template: "<section><slot /></section>",
  },
}));
vi.mock("@/components/MusicMenuTable.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/components/ui", () => ({ LjIcon: { template: "<span />" } }));
vi.mock("vuedraggable", () => ({
  default: {
    name: "Draggable",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<div><slot v-for="element in modelValue" :key="element.id_music" name="item" :element="element" /></div>',
  },
}));

const wrappers: ReturnType<typeof mountUi<typeof Index>>[] = [];
beforeEach(() => {
  saved.value = catalog.map(({ id_music, name }) => ({ id_music, name }));
  disabled.value = [];
  persistReorder.mockClear();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("paginação dos favoritos", () => {
  it("monta a primeira página e alcança toda a lista pelo scroll do módulo", async () => {
    const wrapper = mountUi(Index);
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll(".music-list-item")).toHaveLength(60);

    const container = wrapper.findComponent({ name: "ModuleContainer" });
    container.vm.$emit("scroll", { scroll_bottom: 151 });
    await flushPromises();
    expect(wrapper.findAll(".music-list-item")).toHaveLength(60);
    container.vm.$emit("scroll", { scroll_bottom: 100 });
    await flushPromises();
    expect(wrapper.findAll(".music-list-item")).toHaveLength(120);
    container.vm.$emit("scroll", { scroll_bottom: 0 });
    await flushPromises();
    expect(wrapper.findAll(".music-list-item")).toHaveLength(131);
    expect(saved.value).toHaveLength(131);
    expect(persistReorder).not.toHaveBeenCalled();
  });

  it("arrastar a página preserva as páginas seguintes e os favoritos de álbuns ocultos", async () => {
    disabled.value = [629];
    const original = [...saved.value];
    const wrapper = mountUi(Index);
    wrappers.push(wrapper);
    await flushPromises();
    const list = wrapper.findComponent({ name: "Draggable" });
    const firstPage = list.props("modelValue") as typeof saved.value;
    expect(firstPage).toHaveLength(60);
    expect(firstPage.some((song) => song.id_music === 2)).toBe(false);

    list.vm.$emit("update:modelValue", [...firstPage].reverse());
    await flushPromises();

    expect(saved.value).toHaveLength(131);
    expect(saved.value[1]).toEqual(original[1]);
    expect(saved.value.slice(61)).toEqual(original.slice(61));
    expect(saved.value.map((song) => song.id_music).slice(0, 4)).toEqual([61, 2, 60, 59]);
    expect(saved.value.every((song) => !("albums" in song))).toBe(true);
  });
});
