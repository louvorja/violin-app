import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, ref } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const tracks = [
  { id_music: 1, track: 1, name: "Primeira", duration: 180, has_instrumental_music: true },
  { id_music: 2, track: 2, name: "Segunda", duration: 200, has_instrumental_music: false },
];
let finishCheck: (_downloaded: string | false) => void = () => {};
const playSequence = vi.fn();

vi.mock("@/composables/useModule", () => ({
  useModule: () => ({
    module: computed(() => ({ show: true, data: { id_album: 7, name: "Meu CD", musics: tracks } })),
    t: (key: string) => key,
    $path: { file: (path: string) => path },
    $datetime: { shortTime: () => "3:00" },
  }),
}));
vi.mock("@/composables/useAlbum", () => ({
  useAlbum: () => ({ loading: ref(false), close: vi.fn() }),
}));
vi.mock("@/helpers/Platform", () => ({
  default: { download: {}, storage: { checkLocal: vi.fn() } },
}));
vi.mock("@/helpers/SyncIntent", () => ({ requestAlbumDownload: vi.fn() }));
vi.mock("@/composables/useSyncManager", () => ({
  useSyncManager: () => ({
    collectAlbumFileList: async () => [],
    originOfFileList: () =>
      new Promise((resolve) => {
        finishCheck = resolve;
      }),
  }),
}));
vi.mock("@/composables/useMusicCatalog", () => ({ useDisabledAlbums: () => ref([]) }));
vi.mock("@/modules/musics/composables/usePlaylistPlayback", () => ({
  usePlaylistPlayback: () => ({ playSequence }),
}));
vi.mock("@/components/MusicMenuTable.vue", () => ({
  default: { template: '<button type="button" class="stub-menu">⋮</button>' },
}));

const Index = (await import("../Index.vue")).default;

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const banner = () => document.querySelector(".album-download") as HTMLElement | null;

describe("diálogo do CD no desktop", () => {
  it("reserva o espaço do aviso enquanto confere o disco, para o diálogo não pular ao abrir", async () => {
    wrapper = mountUi(Index, { attachTo: document.body });
    await flushPromises();

    expect(banner()?.classList.contains("album-download--pending")).toBe(true);
    expect(banner()?.getAttribute("aria-hidden")).toBe("true");

    finishCheck("own");
    await flushPromises();
    expect(banner()?.classList.contains("album-download--pending")).toBe(false);
    expect(banner()?.getAttribute("aria-hidden")).toBeNull();
    expect(banner()?.textContent).toContain("downloaded_hint");
  });

  it("Tocar Todas enfileira as faixas do CD na ordem, com o nome do CD (#50)", async () => {
    wrapper = mountUi(Index, { attachTo: document.body });
    await flushPromises();

    (document.querySelector(".album-summary__actions button") as HTMLElement).click();
    expect(playSequence).toHaveBeenCalledWith("Meu CD", [
      { id_music: 1, name: "Primeira", duration: 180, has_instrumental_music: true },
      { id_music: 2, name: "Segunda", duration: 200, has_instrumental_music: false },
    ]);
  });
});
