import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type ComponentCustomProperties } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import CustomSongs from "@/helpers/CustomSongs";
import SlideEditor from "../Index.vue";
import pt from "../../lang/pt.json";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (_payload: unknown) => void>(),
  customTextFormat: false,
  affectExternalSlides: true,
}));

vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    mocks.listeners.set(type, handler);
  },
}));

vi.mock("@/helpers/AudioLibrary", () => ({
  default: {
    resolveAudio: vi.fn().mockResolvedValue("blob:audio-mock"),
    resolveImage: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
  },
}));

vi.mock("@/helpers/UserData", () => ({ default: { set: vi.fn(), get: vi.fn() } }));

vi.mock("@/composables/useSlideStyle", () => ({
  useSlideStyle: () => ({
    cfg: {
      value: {
        font_size_cover: 18,
        font_size_lyric: 10,
        font_size_aux: 8,
        color_cover: "#EFB400",
        color_lyric: "#FFFFFF",
        color_aux: "#EFB400",
        custom_text_format_active: mocks.customTextFormat,
        affect_external_slides: mocks.affectExternalSlides,
      },
    },
    coverStyle: () => ({ color: "#EFB400", fontSize: "18vh" }),
    lyricStyle: () => ({ color: "#FFFFFF", fontSize: "10vh" }),
    auxStyle: () => ({ color: "#EFB400", fontSize: "8vh" }),
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

const DraggableStub = defineComponent({
  name: "draggable",
  props: {
    list: { type: Array, default: () => [] },
    delay: { type: Number, default: 0 },
    delayOnTouchOnly: { type: Boolean, default: false },
    touchStartThreshold: { type: Number, default: 0 },
  },
  setup(props, { slots }) {
    return () =>
      h(
        "div",
        {
          "data-testid": "se-draggable-stub",
          "data-delay": props.delay,
          "data-delay-touch": String(props.delayOnTouchOnly),
          "data-touch-threshold": props.touchStartThreshold,
        },
        (props.list as unknown[]).map((element, index) => slots.item?.({ element, index }))
      );
  },
});

describe("slide editor — preview, timing fracionado e toque (#59, #60, #61)", () => {
  let wrapper: VueWrapper | null = null;

  function storeSong() {
    const song = CustomSongs.newSong("Hino Teste");
    song.audio_token = "audio-tok";
    song.audio_name = "hino.mp3";
    song.slides = [
      CustomSongs.newSlide({
        tipo: "CAPA",
        letra: "Título em Minúscula",
        tamanho_letra: 22,
        cor_letra: "#12ab34",
      }),
      CustomSongs.newSlide({
        tipo: "LETRA",
        letra: "Texto Misto",
        letra_aux: "Auxiliar Misto",
        tamanho_letra: 26,
        tamanho_letra_aux: 13,
        cor_letra: "#ff3366",
        cor_letra_aux: "#00ccff",
      }),
    ];
    sessionStorage.setItem("slide_editor_song_v2", JSON.stringify(song));
  }

  async function mountEditor() {
    wrapper = mount(SlideEditor, {
      global: {
        config: {
          globalProperties: { t: (key: string) => key } as unknown as ComponentCustomProperties,
        },
        stubs: {
          ModuleContainer: defineComponent({
            setup(_, { slots, expose }) {
              expose({ tm: translation });
              return () => h("div", [slots.header?.(), slots.default?.()]);
            },
          }),
          LjIcon: true,
          draggable: DraggableStub,
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  beforeEach(() => {
    mocks.listeners.clear();
    mocks.customTextFormat = false;
    mocks.affectExternalSlides = true;
    sessionStorage.clear();
    storeSong();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("reflete cor, tamanho e caixa exata do slide na prévia mesmo com override global ativo (#59)", async () => {
    mocks.customTextFormat = true;
    mocks.affectExternalSlides = true;
    const editor = await mountEditor();

    const thumbs = editor.findAll(".se-thumb");
    await thumbs[1].trigger("click");
    await flushPromises();

    const mainPreview = editor.find(".se-preview-text--main");
    const auxPreview = editor.find(".se-preview-text--aux");
    expect(mainPreview.text()).toBe("Texto Misto");
    expect(mainPreview.attributes("style")).toContain("font-size: 26cqh");
    expect(mainPreview.attributes("style")).toContain("color: rgb(255, 51, 102)");
    expect(mainPreview.attributes("style")).toContain("text-transform: none");
    expect(auxPreview.attributes("style")).toContain("font-size: 13cqh");
    expect(auxPreview.attributes("style")).toContain("color: rgb(0, 204, 255)");
    expect(editor.find('[data-testid="se-global-override-hint"]').exists()).toBe(true);
  });

  it("configura atraso de toque longo no draggable para não bloquear clique nem rolagem (#60)", async () => {
    const editor = await mountEditor();
    const dragEl = editor.find('[data-testid="se-draggable-stub"]');
    expect(Number(dragEl.attributes("data-delay"))).toBeGreaterThanOrEqual(250);
    expect(dragEl.attributes("data-delay-touch")).toBe("true");
    expect(Number(dragEl.attributes("data-touch-threshold"))).toBeGreaterThanOrEqual(8);
  });

  it("grava tempos fracionados com precisão de milissegundos sem arredondar (#61)", async () => {
    const editor = await mountEditor();
    const audioEl = editor.find("audio").element as HTMLAudioElement;
    Object.defineProperty(audioEl, "duration", { value: 120, configurable: true });
    let currentTime = 5.427;
    Object.defineProperty(audioEl, "currentTime", {
      get: () => currentTime,
      set: (v: number) => {
        currentTime = v;
      },
      configurable: true,
    });
    await editor.find("audio").trigger("loadedmetadata");

    mocks.listeners.get(BROADCAST_TYPE.MODULE_RIBBON_ACTION)?.({
      module: "slide_editor",
      action: "record_advance",
    });
    await flushPromises();

    const thumbs = editor.findAll(".se-thumb");
    expect(thumbs[1].text()).toContain("00:00:05.427");
  });
});
