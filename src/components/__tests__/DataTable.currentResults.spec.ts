import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import DataTable from "../DataTable.vue";

const catalog = [
  { id_music: 1, name: "Castelo Forte", albums: [] },
  { id_music: 2, name: "Castelo de Deus", albums: [] },
  { id_music: 3, name: "Grandioso És Tu", albums: [] },
];

vi.mock("@/helpers/Database", () => ({ default: { get: async () => catalog } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: () => ({ disabledAlbums: ref([]), years: ref(new Map()) }),
}));
vi.mock("@/composables/useOfflineLibrary", () => ({
  useOfflineLibrary: () => ({
    active: computed(() => false),
    offline: computed(() => false),
    hasMusic: () => true,
  }),
}));
vi.mock("@/components/ui", () => ({
  LjAlert: { template: "<div />" },
  LjProgress: { template: "<div />" },
  LjTable: { template: "<table><slot /></table>" },
}));

type Table = { currentResults: () => Array<{ id_music: number; name: string }> };
const wrappers: ReturnType<typeof mountUi<typeof DataTable>>[] = [];

async function mountTable() {
  const wrapper = mountUi(DataTable, {
    props: {
      file: "pt_musics",
      search: "",
      letter: "",
      search_min_length: 3,
      searchable_fields: { name: true },
      sort_by: "name",
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
});

describe("resultado da busca para o Enter", () => {
  it("vale o que está escrito, sem esperar a pausa da digitação", async () => {
    const wrapper = await mountTable();
    await wrapper.setProps({ search: "grandioso" });

    const table = wrapper.vm as unknown as Table;
    expect(table.currentResults()[0]?.id_music).toBe(3);
  });

  it("devolve o primeiro da lista quando sobra mais de um", async () => {
    const wrapper = await mountTable();
    await wrapper.setProps({ search: "castelo" });

    const table = wrapper.vm as unknown as Table;
    expect(table.currentResults()[0]?.name).toBe("Castelo de Deus");
  });

  it("não devolve nada sem busca aplicada: campo vazio ou abaixo do mínimo", async () => {
    const wrapper = await mountTable();
    const table = wrapper.vm as unknown as Table;
    expect(table.currentResults()).toEqual([]);

    await wrapper.setProps({ search: "ca" });
    expect(table.currentResults()).toEqual([]);
  });

  it("não devolve nada quando a busca não acha música", async () => {
    const wrapper = await mountTable();
    await wrapper.setProps({ search: "xyzxyzxyz" });

    const table = wrapper.vm as unknown as Table;
    expect(table.currentResults()).toEqual([]);
  });
});
