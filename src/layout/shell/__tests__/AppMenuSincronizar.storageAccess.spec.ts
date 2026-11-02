import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import pt from "@/lang/pt.json";

const state = vi.hoisted(() => ({
  desktop: true,
  access: { writable: true, shared: true },
  locations: vi.fn(),
  clearFiles: vi.fn(),
  enforceQuota: vi.fn(),
  removeFiles: vi.fn(),
  yesno: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return state.desktop;
    },
    download: {},
    api: { storage: { locations: state.locations } },
    storage: {
      checkLocal: vi.fn(),
      stats: vi.fn(async () => ({})),
      clearFiles: state.clearFiles,
      enforceQuota: state.enforceQuota,
      removeFiles: state.removeFiles,
    },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_: string, fallback: unknown) => fallback, set: vi.fn() },
}));
vi.mock("@/helpers/Alert", () => ({ default: { confirm: state.confirm, yesno: state.yesno } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/helpers/Libras", () => ({ default: { getCacheStats: async () => ({}) } }));
vi.mock("@/helpers/WebFileStore", () => ({
  webStorageUsage: async () => ({}),
  requestPersistence: vi.fn(),
}));
vi.mock("@/composables/useAppInstall", async () => {
  const { ref } = await import("vue");
  return { useAppInstall: () => ({ canOffer: ref(false), openGuide: vi.fn() }) };
});
vi.mock("@/composables/useBackgroundTasks", async () => {
  const { ref } = await import("vue");
  return { useBackgroundTasks: () => ({ tasks: ref([]) }) };
});
vi.mock("@/composables/useSyncManager", async () => {
  const { ref } = await import("vue");
  return {
    CatalogIncompleteError: class extends Error {},
    useSyncManager: () => ({
      ftpChecking: ref(false),
      ftpOk: ref(true),
      ftpError: ref(null),
      scanProgress: ref({ done: 0, total: 0 }),
      bundleInstalling: ref(false),
      bundlePercent: ref(0),
      bundleProgress: ref({}),
      downloading: ref(false),
      downloadProgress: ref({ done: 0, total: 0 }),
      downloadFailedCount: ref(0),
      downloadCompletedMsg: ref(""),
      bibleDownloading: ref(false),
      bibleProgress: ref({ done: 0, total: 0 }),
      bibleCompletedMsg: ref(""),
      bibleRevision: ref(0),
      humanSize: () => "0 B",
      checkFtp: vi.fn(),
      cleanup: vi.fn(),
      ensureCatalogBundle: vi.fn(),
      loadCatalog: async () => ({
        categories: [
          {
            id_category: 1,
            name: "Categoria",
            albums: [
              { id_album: 1, name: "Completo" },
              { id_album: 2, name: "Parcial" },
            ],
          },
        ],
        hymnalIds: [10],
        hymnal1996Ids: [],
      }),
      scanCache: async () => ({
        cachedAlbums: new Set([1]),
        classicAlbums: new Set(),
        hymnalCached: true,
        hymnal1996Cached: false,
        partialAlbums: new Map([[2, { have: 1, total: 2 }]]),
      }),
      refreshDiskUsage: async () => ({ bytes: 0, fileCount: 0, albumCount: 1, hymnalCached: true }),
      loadBibleVersions: async () => ({ versions: [] }),
      scanBibleVersionsDisk: async () => [],
      collectAlbumFileList: async () => [{ remote: "musics/1.mp3" }],
      collectHymnalFileList: async () => [],
      removeFilesFromCache: state.removeFiles,
    }),
  };
});
vi.mock("@/components/ui", () => ({
  LjButton: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  LjIcon: { template: "<span />" },
  LjProgress: { template: "<span />" },
  LjTabs: {
    props: ["tabs", "modelValue"],
    emits: ["update:modelValue"],
    template:
      '<div><button v-for="tab in tabs" :key="tab.value" @click="$emit(\'update:modelValue\', tab.value)">{{ tab.label }}</button></div>',
  },
}));

import AppMenuSincronizar from "../AppMenuSincronizar.vue";

let wrapper: VueWrapper;
async function render() {
  wrapper = mount(AppMenuSincronizar, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "pt", messages: { pt } })],
      stubs: { StorageLocations: true, ProgressBar: true },
      directives: { "requires-network": {} },
    },
  });
  await flushPromises();
}
function button(text: string) {
  const found = wrapper.findAll("button").find((item) => item.text().trim() === text);
  if (!found) throw new Error(`Botão ausente: ${text}`);
  return found;
}
async function storageTab() {
  await button(pt.options.storage.title).trigger("click");
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = true;
  state.access = { writable: true, shared: true };
  state.locations.mockImplementation(async () => ({ access: { media: { ...state.access } } }));
  state.confirm.mockResolvedValue(true);
  state.yesno.mockImplementation((_: string, callback: (_value: string) => void) => callback("yes"));
});
afterEach(() => wrapper?.unmount());

describe("manutenção do acervo na tela de downloads", () => {
  it.each([
    [{ writable: true, shared: true }, pt.options.storage.shared_hint],
    [{ writable: false, shared: false }, pt.options.storage.read_only_hint],
  ])("desabilita limpeza/quota e remoção no acervo %j", async (access, hint) => {
    state.access = access;
    await render();
    expect(wrapper.text()).toContain(hint);
    expect(wrapper.get("#sync-album-1 input").attributes("disabled")).toBeDefined();
    expect(
      button(pt.options.collections_download.partial_discard).attributes("disabled")
    ).toBeDefined();
    await button(pt.options.collections_download.clear).trigger("click");
    expect((wrapper.get("#sync-album-1 input").element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).not.toContain(pt.options.collections_download.will_remove);
    await storageTab();
    expect(wrapper.get("#opt-quota").attributes("disabled")).toBeDefined();
    expect(button(pt.options.storage.clear_files).attributes("disabled")).toBeDefined();
    expect(button(pt.options.storage.clear_cache).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain(pt.options.storage.quota_hint);
    expect(state.removeFiles).not.toHaveBeenCalled();
  });

  it("mantém limpeza, limite e remoção disponíveis no acervo privado gravável", async () => {
    state.access = { writable: true, shared: false };
    await render();
    expect(wrapper.get("#sync-album-1 input").attributes("disabled")).toBeUndefined();
    await wrapper.get("#sync-album-1 input").setValue(false);
    const remove = wrapper.findAll("button").find((item) => item.text().includes("Remover 1"));
    expect(remove?.attributes("disabled")).toBeUndefined();
    await remove!.trigger("click");
    await flushPromises();
    expect(state.removeFiles).toHaveBeenCalled();
    await storageTab();
    expect(wrapper.get("#opt-quota").attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain(pt.options.storage.quota_hint);
    await button(pt.options.storage.clear_files).trigger("click");
    await flushPromises();
    expect(state.clearFiles).toHaveBeenCalledOnce();
  });

  it("preserva remoção e limpeza do Cache Storage na web sem consultar permissões desktop", async () => {
    state.desktop = false;
    await render();
    expect(wrapper.get("#sync-album-1 input").attributes("disabled")).toBeUndefined();
    expect(
      button(pt.options.collections_download.partial_discard).attributes("disabled")
    ).toBeUndefined();
    await storageTab();
    await button(pt.options.storage.clear_files).trigger("click");
    await flushPromises();
    expect(state.clearFiles).toHaveBeenCalledOnce();
    expect(state.locations).not.toHaveBeenCalled();
  });

  it("atualiza a permissão antes da confirmação quando outra conta compartilhou a pasta", async () => {
    state.access = { writable: true, shared: false };
    await render();
    await storageTab();
    state.access = { writable: true, shared: true };
    await button(pt.options.storage.clear_files).trigger("click");
    await flushPromises();
    expect(state.yesno).not.toHaveBeenCalled();
    expect(state.clearFiles).not.toHaveBeenCalled();
    expect(button(pt.options.storage.clear_files).attributes("disabled")).toBeDefined();
  });
});
