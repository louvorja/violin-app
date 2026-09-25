import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import Operator from "@/views/Operator.vue";

const { listeners, applyVideoState } = vi.hoisted(() => ({
  listeners: new Map<string, (_payload: unknown) => void>(),
  applyVideoState: vi.fn(),
}));

vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    listeners.set(type, handler);
  },
}));
vi.mock("@/helpers/VideoSync", () => ({ applyVideoState }));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const projection = (playback_id?: string) => ({
  type: "video", url: "https://example.test/video.mp4", title: "Vídeo", playback_id,
});
const state = (playback_id?: string, revision?: number, currentTime = 10) => ({
  currentTime, isPaused: false, duration: 100, playback_id, revision,
});
const musicPacket = (sessionId: string, revision: number, slideIndex: number, active = true,
  selectionRevision = revision, progress = 25) => ({
  schema: 1, selectionRevision, playbackId: sessionId,
  progress, slideProgress: 0, emittedAt: Date.now(),
  snapshot: {
    sessionId, revision, active, title: active ? sessionId : "", slideIndex: active ? slideIndex : 0,
    totalSlides: active ? 2 : 0,
    slide: active ? { lyric: "Verse", id_music: 42 } : null,
    nextSlide: active && slideIndex === 0 ? { lyric: "Next" } : null,
  },
});

function emit(type: string, payload: unknown) {
  const handler = listeners.get(type);
  expect(handler).toBeDefined();
  handler!(payload);
}

describe("Operator video state", () => {
  let wrapper: VueWrapper | null = null;
  let storedProjection: string | null = null;

  function mountOperator() {
    wrapper = mount(Operator, { global: { plugins: [i18n] } });
  }

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    listeners.clear();
    applyVideoState.mockClear();
    storedProjection = null;
    vi.stubGlobal("localStorage", {
      getItem: () => storedProjection,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    mountOperator();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  async function activate(playbackId?: string) {
    emit(BROADCAST_TYPE.FILE_PROJECTION, projection(playbackId));
    await flushPromises();
    expect(wrapper!.find("video").exists()).toBe(true);
  }

  it("rejects another playback, duplicate revisions, and out-of-order revisions before cache or apply", async () => {
    await activate("new");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("old", 99, 90));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("new", 3, 30));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("new", 3, 31));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("new", 2, 20));
    emit(BROADCAST_TYPE.VIDEO_STATE, state(undefined, undefined, 80));
    expect(applyVideoState).toHaveBeenCalledTimes(1);
    expect(applyVideoState.mock.calls[0][1]).toMatchObject({ currentTime: 30 });

    await wrapper!.find("video").trigger("canplay");
    await wrapper!.find("video").trigger("seeked");
    expect(applyVideoState).toHaveBeenCalledTimes(3);
    expect(applyVideoState.mock.calls.slice(1).map((call) => call[1].currentTime)).toEqual([30, 30]);
  });

  it("keeps revision ordering on repeated activation and resets for a new playback", async () => {
    await activate("first");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("first", 4, 40));
    await activate("first");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("first", 3, 30));
    expect(applyVideoState).toHaveBeenCalledTimes(1);
    await wrapper!.find("video").trigger("canplay");
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(40);

    await activate("second");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("first", 5, 50));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("second", 1, 10));
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(10);
  });

  it("rejects identity-free state before and after close", async () => {
    await activate();
    emit(BROADCAST_TYPE.VIDEO_STATE, state(undefined, undefined, 12));
    expect(applyVideoState).not.toHaveBeenCalled();
    emit(BROADCAST_TYPE.MEDIA_CLOSE, {});
    await flushPromises();
    await activate("identified");
    emit(BROADCAST_TYPE.VIDEO_STATE, state(undefined, undefined, 90));
    await wrapper!.find("video").trigger("canplay");
    expect(applyVideoState).not.toHaveBeenCalled();
  });

  it("clears the previous playback on slides and non-video projection", async () => {
    await activate("first");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("first", 2, 20));
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [], title: "Slides" });
    await activate("second");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("first", 3, 30));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("second", 1, 10));
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(10);

    emit(BROADCAST_TYPE.FILE_PROJECTION, { type: "image", url: "image.png" });
    await activate("third");
    emit(BROADCAST_TYPE.VIDEO_STATE, state("second", 2, 40));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("third", 1, 5));
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(5);
  });

  it("rehydrates a recreated window with the stored playback identity", async () => {
    wrapper!.unmount();
    listeners.clear();
    storedProjection = JSON.stringify(projection("current"));
    mountOperator();
    await flushPromises();
    expect(wrapper!.find("video").exists()).toBe(true);

    emit(BROADCAST_TYPE.VIDEO_STATE, state("previous", 50, 90));
    emit(BROADCAST_TYPE.VIDEO_STATE, state("current", 1, 15));
    expect(applyVideoState).toHaveBeenCalledTimes(1);
    await wrapper!.find("video").trigger("canplay");
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(15);
  });

  it("uses validated music packets and never reuses music cards for the editor", async () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List", slide_index: 0 });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 20, 1));
    emit(BROADCAST_TYPE.SLIDE_CHANGE, {
      presentation_session: "song-a", presentation_revision: 20,
      slide_index: 0, title: "Stale companion", progress: 99,
    });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 19, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "Late list", slide_index: 0 });
    await flushPromises();
    expect(wrapper!.findAll(".op-card--active")).toHaveLength(1);
    expect(wrapper!.findAll(".op-card--active")[0].text()).toContain("Verse");
    expect(wrapper!.find(".op-title").text()).toBe("song-a");

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-b", 1, 0));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 21, 1));
    await flushPromises();
    expect(wrapper!.findAll(".op-card--active")[0].text()).toContain("Cover");
    emit(BROADCAST_TYPE.SLIDE_CHANGE, { slide_index: 1, title: "Editor", progress: 0 });
    await flushPromises();
    expect(wrapper!.findAll(".op-card--active")).toHaveLength(0);
    expect(wrapper!.find(".op-empty").exists()).toBe(true);
    expect(wrapper!.find(".op-title").text()).toBe("Editor");

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, { schema: 1, snapshot: { slideIndex: 0 } });
    expect(wrapper!.find(".op-title").text()).toBe("Editor");
  });

  it("clears music cards on a canonical close and rejects a late old session", async () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 2, 1));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 3, 0, false));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 4, 1));
    await flushPromises();
    expect(wrapper!.find(".op-grid").exists()).toBe(false);
    expect(wrapper!.find(".op-empty").exists()).toBe(true);
  });

  it("buffers a new session list until its snapshot and rejects a retired list", async () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Old" }], title: "Old" });
    await flushPromises();
    expect(wrapper!.findAll(".op-card")).toHaveLength(0);
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-b", slides: [{ lyric: "New" }], title: "New" });
    await flushPromises();
    expect(wrapper!.findAll(".op-card")[0].text()).toContain("Old");

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-b", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Late old" }], title: "Late old" });
    await flushPromises();
    expect(wrapper!.findAll(".op-card")[0].text()).toContain("New");
    expect(wrapper!.find(".op-title").text()).toBe("song-b");
  });

  it("accepts a refreshed envelope at the same core revision without letting an older envelope return", () => {
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 4, 0, true, 8, 25));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 4, 0, true, 9, 70));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 5, 0, true, 8, 10));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.progress).toBe(70);
  });

  it("correlates a music navigation command and leaves editor commands unversioned", async () => {
    const send = vi.spyOn(Broadcast, "send");
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a",
      slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "Song" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, musicPacket("song-a", 1, 0));
    await flushPromises();
    send.mockClear();
    await wrapper!.findAll(".op-card")[1].trigger("click");
    expect(send).toHaveBeenCalledWith(BROADCAST_TYPE.GO_TO_SLIDE,
      expect.objectContaining({ index: 1, presentation_session: "song-a", _command_ts: expect.any(Number) }));

    emit(BROADCAST_TYPE.SLIDE_CHANGE, { slide_index: 0, title: "Editor" });
    send.mockClear();
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    (state.goTo as (index: number) => void)(0);
    const command = send.mock.calls.find(([type]) => type === BROADCAST_TYPE.GO_TO_SLIDE)?.[1] as Record<string, unknown>;
    expect(command).toMatchObject({ index: 0, _command_ts: expect.any(Number) });
    expect(command).not.toHaveProperty("presentation_session");
  });
});
