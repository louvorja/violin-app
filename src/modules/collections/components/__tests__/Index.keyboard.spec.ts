import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const openAlbum = vi.fn();
const afterPlay = vi.fn();
let albums: Array<{ id_album: number; name: string; order: number }> = [];

vi.mock("@/components/ModuleContainer.vue", () => ({
  default: {
    name: "ModuleContainer",
    props: ["manifest"],
    methods: { tm: (key: string) => key },
    template: '<section><slot name="header" /><slot name="left" /><slot /></section>',
  },
}));
vi.mock("@/helpers/Database", () => ({
  default: {
    get: async () => [{ id_category: 1, name: "Categoria", order: 1, albums }],
  },
}));
vi.mock("@/composables/useMedia", () => ({
  default: { openAlbum: (id: number) => openAlbum(id) },
}));
vi.mock("@/helpers/Modules", () => ({ default: { close: vi.fn() } }));
vi.mock("@/helpers/Path", () => ({ default: { file: (path: string) => path } }));
vi.mock("@/composables/useShell", () => ({ useShell: () => ({ openMusicSearch: vi.fn() }) }));
vi.mock("@/composables/useQuickSearch", () => ({ useQuickSearch: () => ({ afterPlay }) }));
vi.mock("@/composables/useMusicCatalog", () => ({ useDisabledAlbums: () => ref([]) }));
vi.mock("@/composables/useOfflineLibrary", () => ({
  useOfflineLibrary: () => ({ active: ref(false), hasAlbum: () => true }),
}));
vi.mock("@/composables/useViewport", () => ({ useViewport: () => ({ width: ref(1000) }) }));

const Index = (await import("../Index.vue")).default;

let wrapper: VueWrapper | null = null;

async function abrir() {
  wrapper = mountUi(Index, { attachTo: document.body });
  await flushPromises();
}

function campo(): HTMLInputElement {
  return wrapper!.find(".col-search input").element as HTMLInputElement;
}

async function digitar(texto: string) {
  campo().value = texto;
  campo().dispatchEvent(new Event("input"));
  await nextTick();
}

async function tecla(key: string) {
  campo().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await nextTick();
}

function destacada(): string | undefined {
  return wrapper!.find(".col-album--active .col-album__name").element?.textContent?.trim();
}

beforeEach(() => {
  openAlbum.mockClear();
  afterPlay.mockClear();
  albums = [
    { id_album: 10, name: "Louvores Alpha", order: 1 },
    { id_album: 11, name: "Louvores Beta", order: 2 },
    { id_album: 12, name: "Outra Coletânea", order: 3 },
  ];
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("Coletâneas pelo teclado", () => {
  it("busca filtrando: a primeira vem destacada; ↓ e Enter abrem a escolhida", async () => {
    await abrir();
    await digitar("louvores");
    expect(destacada()).toBe("Louvores Alpha");

    await tecla("ArrowDown");
    expect(destacada()).toBe("Louvores Beta");
    await tecla("Enter");
    expect(openAlbum).toHaveBeenCalledWith(11);
    expect(afterPlay).toHaveBeenCalledOnce();
  });

  it("sem filtro, Enter não abre nada até a primeira seta", async () => {
    await abrir();
    await digitar("lou");
    expect(wrapper!.find(".col-album--active").exists()).toBe(false);
    await tecla("Enter");
    expect(openAlbum).not.toHaveBeenCalled();

    await tecla("ArrowDown");
    await tecla("ArrowDown");
    await tecla("ArrowDown");
    expect(destacada()).toBe("Outra Coletânea");
    await tecla("Enter");
    expect(openAlbum).toHaveBeenCalledWith(12);
  });

  it("a seta passa da última coletânea montada e monta a próxima página", async () => {
    albums = Array.from({ length: 45 }, (_, i) => ({
      id_album: 100 + i,
      name: `Coletânea ${i + 1}`,
      order: i + 1,
    }));
    await abrir();
    expect(wrapper!.findAll(".col-album")).toHaveLength(30);
    for (let i = 0; i < 31; i++) await tecla("ArrowDown");
    expect(wrapper!.findAll(".col-album")).toHaveLength(45);
    expect(destacada()).toBe("Coletânea 31");
  });
});
