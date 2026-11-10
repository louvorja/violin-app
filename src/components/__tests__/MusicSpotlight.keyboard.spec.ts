import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref, toValue } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const quickPlay = vi.fn(() => true);

vi.mock("@/helpers/QuickPlay", () => ({
  quickPlay: (...args: unknown[]) => quickPlay(...(args as [])),
  isQuickPlayEnter: (e: KeyboardEvent) =>
    e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey,
}));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: (source: () => unknown[]) => ({ musics: computed(() => toValue(source)) }),
  useDisabledAlbums: () => ref([]),
}));
vi.mock("@/helpers/Database", () => ({ default: { get: vi.fn(async () => []) } }));
vi.mock("@/helpers/CustomMusicCatalog", () => ({ loadCustomMusicCatalog: async () => [] }));
vi.mock("@/helpers/Platform", () => ({ default: { isRemote: false } }));
vi.mock("@/composables/useSobreposicaoGlobal", () => ({ useSobreposicaoGlobal: () => {} }));
vi.mock("@/components/MusicMenuTable.vue", () => ({ default: { template: "<span />" } }));

const MusicSpotlight = (await import("../MusicSpotlight.vue")).default;

const musics = [
  { id_music: 1, name: "Castelo Forte", has_instrumental_music: true },
  { id_music: 2, name: "Castelo Seguro", has_instrumental_music: false },
  { id_music: 3, name: "Castelo Eterno", has_instrumental_music: true },
];

let wrapper: VueWrapper | null = null;

async function abrir(props: Record<string, unknown> = {}) {
  wrapper = mountUi(MusicSpotlight, {
    props: { modelValue: true, musicsList: musics, ...props },
    attachTo: document.body,
  });
  await flushPromises();
}

function campo(): HTMLInputElement {
  return document.querySelector(".music-search__bar input") as HTMLInputElement;
}

async function digitarSemPausa(texto: string) {
  campo().value = texto;
  campo().dispatchEvent(new Event("input"));
  await nextTick();
}

/** A lista acompanha o campo depois da pausa de digitação. */
async function digitar(texto: string) {
  await digitarSemPausa(texto);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await nextTick();
}

async function tecla(key: string, shiftKey = false) {
  campo().dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
  );
  await nextTick();
}

function destacada(): string | undefined {
  return document.querySelector("tr.lj-music-row--active .music-search__name")?.textContent?.trim();
}

beforeEach(() => quickPlay.mockClear());
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("MusicSpotlight (Ctrl+M) pelo teclado", () => {
  it("a primeira vem destacada; ↓ e Enter tocam a escolhida", async () => {
    await abrir();
    await digitar("castelo");
    expect(destacada()).toBe("Castelo Forte");

    await tecla("ArrowDown");
    expect(destacada()).toBe("Castelo Seguro");
    await tecla("Enter");
    expect(quickPlay).toHaveBeenCalledWith(musics[1], false);
  });

  it("Shift+Enter pede o playback da destacada", async () => {
    await abrir();
    await digitar("castelo");
    await tecla("ArrowDown");
    await tecla("ArrowDown");
    await tecla("Enter", true);
    expect(quickPlay).toHaveBeenCalledWith(musics[2], true);
  });

  it("↑ volta e digitar de novo recomeça na primeira", async () => {
    await abrir();
    await digitar("castelo");
    await tecla("ArrowDown");
    await tecla("ArrowDown");
    await tecla("ArrowUp");
    expect(destacada()).toBe("Castelo Seguro");
    await digitar("castelo ");
    await digitar("castelo");
    expect(destacada()).toBe("Castelo Forte");
  });

  it("Enter logo após digitar toca o que está escrito, sem esperar a pausa", async () => {
    await abrir();
    await digitar("castelo");
    await digitarSemPausa("castelo e");
    await tecla("Enter");
    expect(quickPlay).toHaveBeenCalledWith(musics[2], false);
  });

  it("↓ logo após digitar anda na lista do que está escrito", async () => {
    await abrir();
    await digitarSemPausa("castelo");
    await tecla("ArrowDown");
    expect(destacada()).toBe("Castelo Seguro");
  });

  it("o mouse leva o destaque, e o Enter toca a que está marcada", async () => {
    await abrir();
    await digitar("castelo");
    document.querySelectorAll("tr.lj-music-row")[2].dispatchEvent(new MouseEvent("mousemove"));
    await nextTick();
    expect(destacada()).toBe("Castelo Eterno");
    await tecla("Enter");
    expect(quickPlay).toHaveBeenCalledWith(musics[2], false);
  });

  it("como seletor de outro módulo, Enter escolhe a destacada", async () => {
    await abrir({ mode: "pick" });
    await digitar("castelo");
    await tecla("ArrowDown");
    await tecla("Enter");
    expect(wrapper!.emitted("pick")?.[0]).toEqual([musics[1]]);
    expect(quickPlay).not.toHaveBeenCalled();
  });
});
