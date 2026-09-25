import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import RemoteControl from "../RemoteControl.vue";

const listeners = vi.hoisted(() => new Map<string, (_payload: unknown) => void>());
const postApi = vi.hoisted(() => vi.fn(async () => ({ status: "ok" })));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, listener: (_payload: unknown) => void) => {
    listeners.set(type, listener);
  },
}));
vi.mock("@/helpers/ApiClient", () => ({
  isTokenInvalid: vi.fn(() => false),
  apiFetch: vi.fn(),
  postApi,
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });
const packet = (sessionId: string, revision: number, slideIndex: number, active = true,
  selectionRevision = revision) => ({
  schema: 1, selectionRevision, playbackId: sessionId,
  progress: 0, slideProgress: 0, emittedAt: Date.now(),
  snapshot: {
    sessionId, revision, active, title: active ? sessionId : "", slideIndex: active ? slideIndex : 0,
    totalSlides: active ? 2 : 0,
    slide: active ? { lyric: "Verse" } : null,
    nextSlide: active && slideIndex === 0 ? { lyric: "Next" } : null,
  },
});

function emit(type: string, payload: unknown) {
  const listener = listeners.get(type);
  expect(listener).toBeDefined();
  listener!(payload);
}

describe("remote slide selection", () => {
  let wrapper: VueWrapper | null = null;
  beforeEach(() => {
    listeners.clear();
    wrapper = shallowMount(RemoteControl, { global: { plugins: [i18n] } });
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("takes music index/title from validated snapshots while retaining editor selections", async () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List", slide_index: 0 });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 20, 1));
    emit(BROADCAST_TYPE.SLIDE_CHANGE, { presentation_session: "song-a", presentation_revision: 20,
      slide_index: 0, title: "Stale companion" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 19, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "Late list", slide_index: 0 });
    await flushPromises();
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.currentSlideIndex).toBe(1);
    expect(state.currentTitle).toBe("song-a");

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-b", 1, 0));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 21, 1));
    expect(state.currentSlideIndex).toBe(0);
    emit(BROADCAST_TYPE.SLIDE_CHANGE, { slide_index: 1, title: "Editor" });
    expect(state.currentSlideIndex).toBe(1);
    expect(state.currentTitle).toBe("Editor");
    expect(state.slides).toEqual([]);
  });

  it("clears the remote slide list on canonical close", () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 1, 0));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 2, 0, false));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 3, 1));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.slides).toEqual([]);
    expect(state.currentTitle).toBe("");
  });

  it("holds a new session list until matching snapshot and rejects an old list", () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Old" }], title: "Old" });
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.slides).toEqual([]);
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-b", slides: [{ lyric: "New" }], title: "New" });
    expect(state.slides).toEqual([{ lyric: "Old" }]);

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-b", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Late old" }], title: "Late old" });
    expect(state.slides).toEqual([{ lyric: "New" }]);
    expect(state.currentTitle).toBe("song-b");
  });

  it("orders a same-core refresh by selection revision", () => {
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 4, 0, true, 8));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
      ...packet("song-a", 4, 0, true, 9),
      snapshot: { ...packet("song-a", 4, 0, true, 9).snapshot, title: "Refreshed" },
    });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 5, 0, true, 8));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.currentTitle).toBe("Refreshed");
  });

  it("sends the observed music session with remote slide selection", async () => {
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 4, 0));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    (state.goToSlide as (index: number) => void)(1);
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "go-to-slide", index: 1, presentation_session: "song-a",
    }, expect.anything());
    (state.closeMedia as () => Promise<void>)();
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "close", presentation_session: "song-a",
    }, expect.anything());
  });
});
