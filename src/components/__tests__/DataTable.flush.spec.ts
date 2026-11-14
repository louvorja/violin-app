import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
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

type Row = { id_music: number; name: string };
type Model = { data: Row[]; revision: number };
type Table = { flush: () => void; searching: () => boolean };
const wrappers: ReturnType<typeof mountUi<typeof DataTable>>[] = [];

function shown(wrapper: ReturnType<typeof mountUi<typeof DataTable>>): Model {
  return wrapper.emitted("update:modelValue")!.at(-1)![0] as Model;
}

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

describe("busca pelo teclado no DataTable", () => {
  it("flush aplica o que está escrito, sem esperar a pausa da digitação", async () => {
    const wrapper = await mountTable();
    const table = wrapper.vm as unknown as Table;
    await wrapper.setProps({ search: "grandioso" });
    expect(shown(wrapper).data).toHaveLength(3);

    table.flush();
    await nextTick();
    expect(shown(wrapper).data.map((row) => row.id_music)).toEqual([3]);
  });

  it("a revisão muda ao refiltrar e não ao paginar", async () => {
    const wrapper = await mountTable();
    const before = shown(wrapper).revision;
    await wrapper.setProps({ search: "castelo" });
    (wrapper.vm as unknown as Table).flush();
    await nextTick();
    expect(shown(wrapper).revision).toBeGreaterThan(before);
    expect(shown(wrapper).data[0]?.name).toBe("Castelo de Deus");
  });

  it("sem busca aplicada — campo vazio ou abaixo do mínimo — não é resultado de busca", async () => {
    const wrapper = await mountTable();
    const table = wrapper.vm as unknown as Table;
    expect(table.searching()).toBe(false);

    await wrapper.setProps({ search: "ca" });
    expect(table.searching()).toBe(false);

    await wrapper.setProps({ search: "cas" });
    expect(table.searching()).toBe(true);
  });

  it("número curto vale como busca (o hino 12)", async () => {
    const wrapper = await mountTable();
    await wrapper.setProps({ search: "12" });
    expect((wrapper.vm as unknown as Table).searching()).toBe(true);
  });
});
