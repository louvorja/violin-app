import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type ComponentCustomProperties } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import CustomSongs from "@/helpers/CustomSongs";
import SlideEditor from "../Index.vue";
import pt from "../../lang/pt.json";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (_payload: unknown) => void>(),
}));

vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    mocks.listeners.set(type, handler);
  },
}));

vi.mock("@/helpers/AudioLibrary", () => ({
  default: {
    resolveAudio: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
  },
}));

vi.mock("@/helpers/UserData", () => ({ default: { set: vi.fn(), get: vi.fn() } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { show: vi.fn() } }));

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

const CLOCK = /\d\d:\d\d:\d\d \/ \d\d:\d\d:\d\d/;

describe("slide editor header, audio track status", () => {
  let wrapper: VueWrapper | null = null;

  function store(extra: Record<string, unknown> = {}) {
    const song = CustomSongs.newSong("Canção");
    song.slides = [CustomSongs.newSlide({ tipo: "CAPA", letra: "Capa" })];
    sessionStorage.setItem("slide_editor_song_v2", JSON.stringify({ ...song, ...extra }));
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
          SljaPackagePrompts: true,
          draggable: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  async function toggleTrack(editor: VueWrapper) {
    mocks.listeners.get(BROADCAST_TYPE.MODULE_RIBBON_ACTION)?.({
      module: "slide_editor",
      action: "audio_track",
    });
    await flushPromises();
    return editor;
  }

  function chip(editor: VueWrapper) {
    const label = editor.find('[data-testid="se-track"]');
    expect(label.exists()).toBe(true);
    const cell = label.element.parentElement as HTMLElement;
    return {
      label: label.text(),
      audio: (cell.querySelector(".se-audio-time")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      title: cell.title,
    };
  }

  function cells(editor: VueWrapper) {
    return editor.findAll(".se-statusbar-inline > *").length;
  }

  beforeEach(() => {
    mocks.listeners.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
  });

  it("keeps the same cell on both tracks when the song has no audio", async () => {
    store();
    const editor = await mountEditor();
    const total = cells(editor);
    expect(chip(editor)).toMatchObject({ label: "Cantado", audio: "Nenhum áudio anexado" });

    await toggleTrack(editor);
    expect(chip(editor)).toMatchObject({ label: "Playback", audio: "Nenhum áudio anexado" });
    expect(cells(editor)).toBe(total);

    await toggleTrack(editor);
    expect(chip(editor)).toMatchObject({ label: "Cantado", audio: "Nenhum áudio anexado" });
    expect(cells(editor)).toBe(total);
  });

  it("names the sung track even when only it has audio", async () => {
    store({ audio_token: "lib://audio/cantado.wav", audio_name: "cantado.wav" });
    const editor = await mountEditor();
    const total = cells(editor);
    expect(chip(editor).label).toBe("Cantado");
    expect(chip(editor).audio).toMatch(CLOCK);

    await toggleTrack(editor);
    expect(chip(editor)).toMatchObject({ label: "Playback", audio: "Nenhum áudio anexado" });
    expect(cells(editor)).toBe(total);
  });

  it("shows each track's own audio when the song has both", async () => {
    store({
      audio_token: "lib://audio/cantado.wav",
      audio_name: "cantado.wav",
      playback_token: "lib://audio/playback.wav",
      playback_name: "playback.wav",
    });
    const editor = await mountEditor();
    expect(chip(editor)).toMatchObject({ label: "Cantado", title: "cantado.wav" });
    expect(chip(editor).audio).toMatch(CLOCK);

    await toggleTrack(editor);
    expect(chip(editor)).toMatchObject({ label: "Playback", title: "playback.wav" });
    expect(chip(editor).audio).toMatch(CLOCK);
  });

  it("converts active track from Cantado to Playback via ribbon action (#62)", async () => {
    store({
      audio_token: "lib://audio/errada.wav",
      audio_name: "errada.wav",
      slides: [
        CustomSongs.newSlide({ tipo: "CAPA", letra: "Capa", tempo_seconds: 0 }),
        CustomSongs.newSlide({ tipo: "LETRA", letra: "V1", tempo_seconds: 11.4 }),
      ],
    });
    const editor = await mountEditor();
    expect(chip(editor)).toMatchObject({ label: "Cantado", title: "errada.wav" });

    mocks.listeners.get(BROADCAST_TYPE.MODULE_RIBBON_ACTION)?.({
      module: "slide_editor",
      action: "audio_convert",
    });
    await flushPromises();

    expect(chip(editor)).toMatchObject({ label: "Playback", title: "errada.wav" });
    mocks.listeners.get(BROADCAST_TYPE.MODULE_RIBBON_ACTION)?.({
      module: "slide_editor",
      action: "next",
    });
    await flushPromises();
    expect(editor.text()).toContain("00:00:11.400");
  });
});
