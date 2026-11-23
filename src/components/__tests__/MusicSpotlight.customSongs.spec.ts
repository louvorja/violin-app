import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref, toValue } from "vue";
import { TooltipProvider } from "reka-ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const loadCustomMusicCatalog = vi.fn(async () => [
  { id_music: -2, name: "Hino da Igreja Local", custom_song_id: "uuid-local", albums: [] },
]);

vi.mock("@/helpers/QuickPlay", () => ({ quickPlay: () => false, isQuickPlayEnter: () => false }));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: (source: () => unknown[]) => ({ musics: computed(() => toValue(source)) }),
  useDisabledAlbums: () => ref([]),
}));
vi.mock("@/helpers/Database", () => ({
  default: { get: vi.fn(async () => [{ id_music: 7, name: "Hino da Manhã" }]) },
}));
vi.mock("@/helpers/CustomMusicCatalog", () => ({
  loadCustomMusicCatalog: () => loadCustomMusicCatalog(),
}));
vi.mock("@/helpers/Platform", () => ({ default: { isRemote: false } }));
vi.mock("@/composables/useSobreposicaoGlobal", () => ({ useSobreposicaoGlobal: () => {} }));
vi.mock("@/components/MusicMenuTable.vue", () => ({ default: { template: "<span />" } }));

const MusicSpotlight = (await import("../MusicSpotlight.vue")).default;

let host: VueWrapper | null = null;

async function listar(props: Record<string, unknown>): Promise<(string | undefined)[]> {
  host = mountUi(
    {
      components: { TooltipProvider, MusicSpotlight },
      setup: () => ({ props }),
      template:
        '<TooltipProvider><MusicSpotlight :model-value="true" v-bind="props" /></TooltipProvider>',
    },
    { attachTo: document.body }
  );
  await flushPromises();
  const campo = document.querySelector(".music-search__bar input") as HTMLInputElement;
  campo.value = "hino";
  campo.dispatchEvent(new Event("input"));
  await new Promise((r) => setTimeout(r, 200));
  await nextTick();
  return [...document.querySelectorAll(".music-search__name")].map((el) => el.textContent?.trim());
}

afterEach(() => {
  host?.unmount();
  host = null;
  loadCustomMusicCatalog.mockClear();
});

describe("MusicSpotlight — músicas personalizadas", () => {
  it("a busca que toca (Ctrl+M) lista as personalizadas", async () => {
    expect(await listar({})).toEqual(["Hino da Manhã", "Hino da Igreja Local"]);
  });

  it("o seletor que declara saber tocá-las também lista", async () => {
    expect(await listar({ mode: "pick", onMusicAction: () => {}, customSongs: true })).toEqual([
      "Hino da Manhã",
      "Hino da Igreja Local",
    ]);
  });

  it("o seletor que guarda só o id do acervo (temporizador) não as oferece", async () => {
    expect(await listar({ mode: "pick", onMusicAction: () => {} })).toEqual(["Hino da Manhã"]);
    expect(loadCustomMusicCatalog).not.toHaveBeenCalled();
  });
});
