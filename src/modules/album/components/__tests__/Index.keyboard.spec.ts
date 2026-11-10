import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const quickPlay = vi.fn(() => true);
const tracks = [
  { id_music: 1, track: 1, name: "Primeira", duration: 180, has_instrumental_music: true },
  { id_music: 2, track: 2, name: "Segunda", duration: 200, has_instrumental_music: true },
  { id_music: 3, track: 3, name: "Terceira", duration: 210, has_instrumental_music: false },
];

vi.mock("@/helpers/QuickPlay", () => ({
  quickPlay: (...args: unknown[]) => quickPlay(...(args as [])),
  isQuickPlayEnter: (e: KeyboardEvent) =>
    e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey,
}));
vi.mock("@/composables/useModule", () => ({
  useModule: () => ({
    module: computed(() => ({ show: true, data: { id_album: 7, name: "Álbum", musics: tracks } })),
    t: (key: string) => key,
    $path: { file: (path: string) => path },
    $datetime: { shortTime: () => "3:00" },
  }),
}));
vi.mock("@/composables/useAlbum", () => ({
  useAlbum: () => ({ loading: ref(false), close: vi.fn() }),
}));
vi.mock("@/helpers/Platform", () => ({ default: {} }));
vi.mock("@/helpers/SyncIntent", () => ({ requestAlbumDownload: vi.fn() }));
vi.mock("@/composables/useSyncManager", () => ({ useSyncManager: () => ({}) }));
vi.mock("@/composables/useMusicCatalog", () => ({ useDisabledAlbums: () => ref([]) }));
vi.mock("@/modules/musics/composables/usePlaylistPlayback", () => ({
  usePlaylistPlayback: () => ({ playSequence: vi.fn() }),
}));
vi.mock("@/components/MusicMenuTable.vue", () => ({
  default: { template: '<button type="button" class="stub-menu">⋮</button>' },
}));

const Index = (await import("../Index.vue")).default;

let wrapper: VueWrapper | null = null;

function lista(): HTMLElement {
  return document.querySelector(".album-tracks") as HTMLElement;
}

async function tecla(key: string, alvo: HTMLElement = lista(), shiftKey = false) {
  alvo.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
  );
  await nextTick();
}

function destacada(): string | undefined {
  return document.querySelector("tr.lj-music-row--active .album-track-name")?.textContent?.trim();
}

beforeEach(async () => {
  quickPlay.mockClear();
  wrapper = mountUi(Index, { attachTo: document.body });
  await flushPromises();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("Álbum pelo teclado", () => {
  it("abre com o foco na lista e a primeira faixa destacada", () => {
    expect(document.activeElement).toBe(lista());
    expect(destacada()).toBe("Primeira");
  });

  it("↓ e Enter tocam a faixa escolhida; Shift+Enter, o playback", async () => {
    await tecla("ArrowDown");
    expect(destacada()).toBe("Segunda");
    await tecla("Enter");
    expect(quickPlay).toHaveBeenLastCalledWith(tracks[1], false);
    await tecla("Enter", lista(), true);
    expect(quickPlay).toHaveBeenLastCalledWith(tracks[1], true);
  });

  it("com o foco num botão da linha, a tecla é do botão", async () => {
    const botao = document.querySelectorAll<HTMLElement>(".stub-menu")[2];
    await tecla("ArrowDown", botao);
    await tecla("Enter", botao);
    expect(destacada()).toBe("Primeira");
    expect(quickPlay).not.toHaveBeenCalled();
  });
});
