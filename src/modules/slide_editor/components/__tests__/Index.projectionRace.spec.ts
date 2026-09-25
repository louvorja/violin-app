import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type ComponentCustomProperties } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import CustomSongs from "@/helpers/CustomSongs";
import SlideEditor from "../Index.vue";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (_payload: unknown) => void>(),
  send: vi.fn(),
  resolveImage: vi.fn(),
  openProjectionWindows: vi.fn(),
  closeProjectionWindows: vi.fn(),
  stopMedia: vi.fn(),
  setUserData: vi.fn(),
}));

vi.mock("@/composables/useMedia", () => ({
  default: {
    stopForSlideEditor: mocks.stopMedia,
    openProjectionStage: mocks.openProjectionWindows,
    closeProjectionStage: mocks.closeProjectionWindows,
  },
}));

vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    mocks.listeners.set(type, handler);
  },
}));

vi.mock("@/helpers/Broadcast", () => ({ default: { send: mocks.send } }));

vi.mock("@/helpers/AudioLibrary", () => ({
  default: {
    resolveImage: mocks.resolveImage,
    resolveAudio: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
  },
}));

vi.mock("@/helpers/ProjectionWindows", () => ({
  openProjectionWindows: mocks.openProjectionWindows,
  closeProjectionWindows: mocks.closeProjectionWindows,
}));

vi.mock("@/helpers/UserData", () => ({ default: { set: mocks.setUserData, get: vi.fn() } }));

vi.mock("@/composables/useSlideStyle", () => ({
  useSlideStyle: () => ({
    cfg: { value: { font_size_cover: "10px", font_size_lyric: "10px", font_size_aux: "10px" } },
    coverStyle: () => ({}),
    lyricStyle: () => ({}),
    auxStyle: () => ({}),
  }),
}));

function emit(type: string, payload: unknown = {}) {
  mocks.listeners.get(type)?.(payload);
}

function songWithImages() {
  const song = CustomSongs.newSong("Race test");
  song.slides = [
    CustomSongs.newSlide({ tipo: "CAPA", letra: "Capa", imagem: "cover-token" }),
    CustomSongs.newSlide({ letra: "Próximo", imagem: "next-token" }),
  ];
  return song;
}

describe("slide editor projection cancellation", () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    mocks.listeners.clear();
    mocks.send.mockReset();
    mocks.resolveImage.mockReset();
    mocks.openProjectionWindows.mockReset().mockResolvedValue(undefined);
    mocks.closeProjectionWindows.mockReset().mockResolvedValue(undefined);
    mocks.stopMedia.mockReset().mockResolvedValue(undefined);
    mocks.setUserData.mockReset();
    sessionStorage.setItem("slide_editor_song_v2", JSON.stringify(songWithImages()));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
    vi.useRealTimers();
  });

  function mountEditor() {
    wrapper = mount(SlideEditor, {
      global: {
        config: {
          globalProperties: { t: (key: string) => key } as unknown as ComponentCustomProperties,
        },
        stubs: {
          ModuleContainer: defineComponent({
            setup(_, { slots, expose }) {
              expose({ tm: (key: string) => key });
              return () => h("div", [slots.header?.(), slots.default?.()]);
            },
          }),
          LjIcon: true,
          draggable: true,
        },
      },
    });
  }

  it("does not publish image resolution that finishes after MEDIA_CLOSE", async () => {
    const pendingImageResolutions: Array<(_url: string) => void> = [];
    mocks.resolveImage.mockImplementation(
      (token: string) =>
        new Promise<string>((resolve) => {
          pendingImageResolutions.push((url) => resolve(url || `blob:${token}`));
        })
    );
    mountEditor();
    await flushPromises();

    emit(BROADCAST_TYPE.MODULE_RIBBON_ACTION, { module: "slide_editor", action: "project" });
    await flushPromises();
    expect(mocks.stopMedia).toHaveBeenCalledOnce();
    emit(BROADCAST_TYPE.MEDIA_CLOSE);
    for (let round = 0; round < 4; round += 1) {
      for (const resolve of pendingImageResolutions.splice(0)) resolve("");
      await flushPromises();
    }

    expect(mocks.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.SLIDE_CHANGE, expect.anything());
  });

  it("a claim pendente fica visível e MEDIA_CLOSE cancela antes de abrir a janela", async () => {
    let release!: () => void;
    mocks.stopMedia.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    mountEditor();
    await flushPromises();

    emit(BROADCAST_TYPE.MODULE_RIBBON_ACTION, { module: "slide_editor", action: "project" });
    expect(mocks.setUserData).toHaveBeenCalledWith(KEYS.MODULES.SLIDE_EDITOR.PROJECTING, true);
    emit(BROADCAST_TYPE.MEDIA_CLOSE);
    release();
    await flushPromises();

    expect(mocks.openProjectionWindows).not.toHaveBeenCalled();
    expect(mocks.setUserData).toHaveBeenCalledWith(KEYS.MODULES.SLIDE_EDITOR.PROJECTING, false);
    expect(mocks.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.SLIDE_CHANGE, expect.anything());
  });

  it("still publishes the current slide while projection remains active", async () => {
    mocks.resolveImage.mockImplementation(async (token: string) => `blob:${token}`);
    mountEditor();
    await flushPromises();

    emit(BROADCAST_TYPE.MODULE_RIBBON_ACTION, { module: "slide_editor", action: "project" });
    await flushPromises();

    expect(mocks.send).toHaveBeenCalledWith(
      BROADCAST_TYPE.SLIDE_CHANGE,
      expect.objectContaining({
        slide_index: 0,
        slide: expect.objectContaining({ url_image: "blob:cover-token" }),
        next_slide: expect.objectContaining({ url_image: "blob:next-token" }),
      })
    );
  });

  it("cancels a pending editor slide when a new canonical music session takes the stage", async () => {
    let resolveImage: ((_url: string) => void) | undefined;
    mocks.resolveImage.mockImplementation(() => new Promise<string>((resolve) => { resolveImage = resolve; }));
    mountEditor();
    await flushPromises();
    emit(BROADCAST_TYPE.MODULE_RIBBON_ACTION, { module: "slide_editor", action: "project" });
    await flushPromises();
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
      schema: 1, selectionRevision: 1, progress: 0, slideProgress: 0, emittedAt: Date.now(),
      snapshot: {
        sessionId: "new-music", revision: 0, active: true, title: "New",
        slideIndex: 0, totalSlides: 1, slide: { lyric: "New" }, nextSlide: null,
      },
    });
    resolveImage?.("blob:late-editor");
    await flushPromises();
    expect(mocks.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.SLIDE_CHANGE, expect.anything());
  });
});
