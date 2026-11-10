import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, h, ref } from "vue";
import { TooltipProvider } from "reka-ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const tracks = [
  { id_music: 1, track: 1, name: "Primeira", duration: 180, has_instrumental_music: true },
  { id_music: 2, track: 2, name: "Segunda", duration: 200, has_instrumental_music: false },
];
let finishCheck: (_downloaded: string | false) => void = () => {};
const playSequence = vi.fn();
const requestAlbumDownload = vi.fn();

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
vi.mock("@/helpers/SyncIntent", () => ({
  requestAlbumDownload: (...args: unknown[]) => requestAlbumDownload(...args),
}));
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
// A dica do download só funciona sob o TooltipProvider do App.vue.
const mountDialog = () =>
  mountUi({ render: () => h(TooltipProvider, () => h(Index)) }, { attachTo: document.body });

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const actions = () => document.querySelector(".album-summary__actions") as HTMLElement;
const buttons = () => [...actions().querySelectorAll("button")].map((b) => b.textContent?.trim());

describe("diálogo do CD no desktop", () => {
  it("a situação do download entra na linha do Tocar Todas, sem faixa própria", async () => {
    wrapper = mountDialog();
    await flushPromises();
    // Conferindo o disco: só o Tocar Todas; a linha já existe, então nada muda de altura depois.
    expect(buttons()).toEqual(["Tocar Todas"]);

    finishCheck("own");
    await flushPromises();
    expect(buttons()).toEqual(["Tocar Todas"]);
    expect(actions().querySelector(".album-downloaded")?.textContent?.trim()).toBe("downloaded");
  });

  it("CD não baixado: botão Baixar álbum ao lado, que leva ao Sincronizar", async () => {
    wrapper = mountDialog();
    await flushPromises();
    finishCheck(false);
    await flushPromises();

    expect(buttons()).toEqual(["Tocar Todas", "download"]);
    expect(actions().querySelector(".album-downloaded")).toBeNull();
    (actions().querySelectorAll("button")[1] as HTMLElement).click();
    expect(requestAlbumDownload).toHaveBeenCalledWith(7);
  });

  it("Tocar Todas enfileira as faixas do CD na ordem, com o nome do CD (#50)", async () => {
    wrapper = mountDialog();
    await flushPromises();

    (document.querySelector(".album-summary__actions button") as HTMLElement).click();
    expect(playSequence).toHaveBeenCalledWith("Meu CD", [
      { id_music: 1, name: "Primeira", duration: 180, has_instrumental_music: true },
      { id_music: 2, name: "Segunda", duration: 200, has_instrumental_music: false },
    ]);
  });
});
