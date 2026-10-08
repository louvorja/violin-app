import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import CustomSongs from "@/helpers/CustomSongs";
import SlideEditor from "../Index.vue";
import pt from "../../lang/pt.json";

vi.mock("@/composables/useBroadcastListener", () => ({ useBroadcastListener: vi.fn() }));

vi.mock("@/helpers/AudioLibrary", () => ({
  default: {
    resolveAudio: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
  },
}));

vi.mock("@/helpers/UserData", () => ({ default: { set: vi.fn(), get: vi.fn() } }));

vi.mock("@/composables/useSlideStyle", () => ({
  useSlideStyle: () => ({
    cfg: { value: { font_size_cover: "10px", font_size_lyric: "10px", font_size_aux: "10px" } },
    coverStyle: () => ({}),
    lyricStyle: () => ({}),
    auxStyle: () => ({}),
  }),
}));

function translation(key: string): string {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return key;
  }, pt) as string;
}

describe("slide editor image position", () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
  });

  it("renders all translated positions and saves a position change with an image attached", async () => {
    const song = CustomSongs.newSong("Canção com imagem");
    song.slides = [
      CustomSongs.newSlide({
        tipo: "CAPA",
        letra: "Capa",
        imagem: "data:image/png;base64,iVBORw0KGgo=",
        imagem_posicao: 5,
      }),
    ];
    sessionStorage.setItem("slide_editor_song_v2", JSON.stringify(song));
    const renderErrors = vi.fn();
    wrapper = mount(SlideEditor, {
      global: {
        // A global `t` would hide the regression: the editor must use ModuleContainer.tm.
        config: { errorHandler: renderErrors },
        stubs: {
          ModuleContainer: defineComponent({
            setup(_, { slots, expose }) {
              expose({ tm: translation });
              return () => h("div", [slots.header?.(), slots.default?.()]);
            },
          }),
          LjIcon: true,
          draggable: true,
        },
      },
    });
    await flushPromises();

    expect(renderErrors).not.toHaveBeenCalled();
    const position = wrapper.get<HTMLSelectElement>("select.se-select");
    expect(
      position
        .findAll<HTMLOptionElement>("option")
        .map((option) => [option.element.value, option.text()])
    ).toEqual([
      ["1", "Sup. Esq."],
      ["2", "Sup. Centro"],
      ["3", "Sup. Dir."],
      ["4", "Meio Esq."],
      ["5", "Centro"],
      ["6", "Meio Dir."],
      ["7", "Inf. Esq."],
      ["8", "Inf. Centro"],
      ["9", "Inf. Dir."],
    ]);
    expect(position.element.value).toBe("5");
    expect(wrapper.get<HTMLElement>(".se-preview").element.style.backgroundPosition).toBe(
      "center center"
    );
    expect(wrapper.find(".se-dirty-dot").exists()).toBe(false);

    await position.setValue("9");

    expect(position.element.value).toBe("9");
    expect(wrapper.get<HTMLElement>(".se-preview").element.style.backgroundPosition).toBe(
      "right bottom"
    );
    expect(wrapper.find(".se-dirty-dot").exists()).toBe(true);
    await vi.waitFor(() => {
      const saved = JSON.parse(sessionStorage.getItem("slide_editor_song_v2") ?? "null");
      expect(saved?.slides[0]).toMatchObject({ imagem: song.slides[0].imagem, imagem_posicao: 9 });
    });
    expect(renderErrors).not.toHaveBeenCalled();
  });
});
