import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
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
const projection = (playback_id?: string) => ({
  type: "video", url: "https://example.test/video.mp4", title: "Vídeo", playback_id,
});
const state = (playback_id?: string, revision?: number, currentTime = 10) => ({
  currentTime, isPaused: false, duration: 100, playback_id, revision,
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

  it("accepts initial legacy state without an identity and clears it on close", async () => {
    await activate();
    emit(BROADCAST_TYPE.VIDEO_STATE, state(undefined, undefined, 12));
    expect(applyVideoState.mock.calls.at(-1)?.[1].currentTime).toBe(12);
    emit(BROADCAST_TYPE.MEDIA_CLOSE, {});
    await flushPromises();
    await activate("identified");
    emit(BROADCAST_TYPE.VIDEO_STATE, state(undefined, undefined, 90));
    await wrapper!.find("video").trigger("canplay");
    expect(applyVideoState).toHaveBeenCalledTimes(1);
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
});
