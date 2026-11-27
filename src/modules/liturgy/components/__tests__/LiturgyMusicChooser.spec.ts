import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref, toValue } from "vue";
import { TooltipProvider } from "reka-ui";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import type { LiturgyItem } from "@/types/Liturgy";

const catalogo = [{ id_music: 7, name: "Castelo Forte", has_instrumental_music: true }];
const personalizada = {
  id_music: -2,
  name: "Hino da Igreja Local",
  custom_song_id: "uuid-local",
  custom_collection_names: [],
  has_audio: true,
  has_instrumental_music: false,
  albums: [],
};

vi.mock("@/helpers/QuickPlay", () => ({ quickPlay: () => false, isQuickPlayEnter: () => false }));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: (source: () => unknown[]) => ({ musics: computed(() => toValue(source)) }),
  useDisabledAlbums: () => ref([]),
}));
vi.mock("@/helpers/Database", () => ({ default: { get: vi.fn(async () => catalogo) } }));
vi.mock("@/helpers/CustomMusicCatalog", () => ({
  loadCustomMusicCatalog: async () => [personalizada],
}));
vi.mock("@/helpers/Platform", () => ({ default: { isRemote: false } }));
vi.mock("@/composables/useSobreposicaoGlobal", () => ({ useSobreposicaoGlobal: () => {} }));
vi.mock("@/components/MusicMenuTable.vue", () => ({ default: { template: "<span />" } }));

const LiturgyMusicChooser = (await import("../LiturgyMusicChooser.vue")).default;

const itemNaHora = {
  id: "item-1",
  tipo: "musica",
  item: "Louvor especial",
  subitem: "",
  subtipo: "escolha",
  musica: -1,
  escolha: true,
  // Sobra de quando o item apontava para outra música personalizada.
  ref_id: "uuid-antigo",
} as unknown as LiturgyItem;

let host: VueWrapper | null = null;

// Os botões de versão têm dica; o provedor mora no App.vue.
const Host = {
  components: { TooltipProvider, LiturgyMusicChooser },
  template: "<TooltipProvider><LiturgyMusicChooser /></TooltipProvider>",
};

const seletor = () => host!.findComponent(LiturgyMusicChooser);

async function abrir(mode?: string) {
  host = mountUi(Host, { attachTo: document.body });
  (seletor().vm as unknown as { choose: (item: LiturgyItem, mode?: string) => void }).choose(
    itemNaHora,
    mode
  );
  await flushPromises();
}

async function buscar(texto: string) {
  const campo = document.querySelector(".music-search__bar input") as HTMLInputElement;
  campo.value = texto;
  campo.dispatchEvent(new Event("input"));
  await new Promise((r) => setTimeout(r, 200));
  await nextTick();
}

const nomes = () =>
  [...document.querySelectorAll(".music-search__name")].map((el) => el.textContent?.trim());

afterEach(() => {
  host?.unmount();
  host = null;
});

describe("música escolhida na hora do culto", () => {
  it("lista a música personalizada e a entrega pelo UUID, na versão do botão", async () => {
    await abrir();
    await buscar("igreja local");
    expect(nomes()).toEqual(["Hino da Igreja Local"]);

    (document.querySelector('[data-testid="music-search-no-audio"]') as HTMLElement).click();
    await nextTick();

    const [executable, mode, item] = seletor().emitted("chosen")![0] as [
      LiturgyItem,
      string,
      LiturgyItem,
    ];
    expect(executable).toMatchObject({
      id: "item-1",
      id_music: -2,
      musica: -2,
      escolha: false,
      ref_id: "uuid-local",
    });
    expect(mode).toBe("no_audio");
    expect(item).toBe(itemNaHora);
  });

  it("música do acervo toca na versão pedida no item e não herda o UUID antigo", async () => {
    await abrir("pb");
    await buscar("castelo");
    (document.querySelector("tr.lj-music-row") as HTMLElement).click();
    await nextTick();

    const [executable, mode] = seletor().emitted("chosen")![0] as [LiturgyItem, string];
    expect(executable).toMatchObject({ id_music: 7, musica: 7, escolha: false });
    expect(executable.ref_id).toBeUndefined();
    expect(mode).toBe("pb");
  });
});

describe("paridade entre o módulo Liturgia e a liturgia lateral", () => {
  const fonte = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

  it.each(["src/modules/liturgy/components/Index.vue", "src/layout/shell/ShellLiturgyPanel.vue"])(
    "%s escolhe a música pelo seletor compartilhado",
    (caminho) => {
      const sfc = fonte(caminho);
      expect(sfc.includes("<LiturgyMusicChooser")).toBe(true);
      expect(sfc.includes("<MusicSpotlight")).toBe(false);
    }
  );
});
