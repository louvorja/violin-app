import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useProjectionState } from "../useProjectionState";
import { useSlides } from "../useSlides";
import Telemetry from "@/helpers/Telemetry";
import { MusicShadowReceiver } from "@/presentation/MusicShadowReceiver";

const producer = useSlides();
let state: ReturnType<typeof useProjectionState>;
let wrapper: VueWrapper | undefined;
const component = defineComponent({
  setup() { state = useProjectionState(); return () => h("div"); },
});

function slide(playbackId: string | undefined, revision: number | undefined, index = 1) {
  Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
    playback_id: playbackId, presentation_revision: revision, slide_index: index,
    slide: { lyric: "Current" }, next_slide: null, title: "Song", total_slides: 3,
  });
}

function progress(playbackId: string | undefined, revision: number | undefined, index = 1, value = 70) {
  Broadcast.send(BROADCAST_TYPE.SLIDE_PROGRESS, {
    playback_id: playbackId, presentation_revision: revision, slide_index: index, slide_progress: value,
  });
}

describe("projection progress belongs to the committed music slide", () => {
  beforeEach(() => {
    producer.reset();
    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
    Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, { active: false });
    wrapper = mount(component);
  });
  afterEach(() => {
    wrapper?.unmount();
    producer.reset();
    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
  });

  it("rejects a previous song, previous revision and progress arriving ahead of selection", () => {
    slide("new", 20);
    progress("new", 20);
    expect(state.slideProgress.value).toBe(70);
    progress("old", 19, 2, 99);
    progress("old", 20, 1, 99);
    progress("new", 19, 1, 99);
    progress("new", 21, 2, 99);
    expect(state.slideIndex.value).toBe(1);
    expect(state.slideProgress.value).toBe(70);
    slide("new", 21, 2);
    expect(state.slideProgress.value).toBe(0);
    progress("new", 21, 2, 30);
    expect(state.slideProgress.value).toBe(30);
  });

  it("rejects old revisions even when music has no playback identity", () => {
    slide(undefined, 22);
    progress(undefined, 21);
    progress(undefined, undefined);
    expect(state.slideProgress.value).toBe(0);
    progress(undefined, 22);
    expect(state.slideProgress.value).toBe(70);
  });

  it("keeps same-selection compatibility for unrevisioned legacy senders", () => {
    slide(undefined, undefined);
    progress(undefined, undefined);
    expect(state.slideProgress.value).toBe(70);
    progress(undefined, undefined, 2);
    expect(state.slideIndex.value).toBe(1);
  });

  it("close clears cached progress and rejects packets arriving after close or Bible override", () => {
    slide("song", 1);
    progress("song", 1);
    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.SLIDE_PROGRESS)).toBeNull();
    progress("song", 1);
    expect(state.slideIndex.value).toBe(0);
    expect(state.slideProgress.value).toBe(0);
    slide("song", 2);
    Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, { active: true, text: "Verse", reference: "Reference" });
    progress("song", 2, 0);
    expect(state.slideProgress.value).toBe(0);
    expect(state.slide.value?.lyric).toBe("Verse");
  });

  it("reopen requests current selection and progress after stale replay", () => {
    producer.setSlides([{ lyric: "Cover" }, { lyric: "Verse" }], [], "New", "new");
    producer.goToSlide(1);
    producer.slideProgress.value = 42;
    producer.broadcastSlide();
    const revision = (Broadcast.getLastPayload(BROADCAST_TYPE.SLIDE_CHANGE) as Record<string, unknown>).presentation_revision;
    progress("old", Number(revision) - 1, 0, 99);
    wrapper?.unmount();
    wrapper = mount(component);
    expect(state.slideIndex.value).toBe(1);
    expect(state.slide.value?.lyric).toBe("Verse");
    expect(state.slideProgress.value).toBe(42);
  });

  it("validates progress at the boundary", () => {
    slide("song", 1);
    progress("song", 1, 1, Infinity);
    expect(state.slideProgress.value).toBe(0);
    progress("song", 1, 1, 200);
    expect(state.slideProgress.value).toBe(100);
  });

  it("an auxiliary mount recovers the real shadow and never renders diagnostic payloads", () => {
    producer.setSlides([{ lyric: "Cover" }, { lyric: "Verse" }], [], "Authoritative", "new");
    producer.goToSlide(1);
    wrapper?.unmount();
    const receive = vi.spyOn(MusicShadowReceiver.prototype, "receive");
    const track = vi.spyOn(Telemetry, "track");
    try {
      wrapper = mount(component);
      expect(receive).toHaveBeenCalled();
      const packet = receive.mock.calls.at(-1)![0] as { version: 1; legacyRevision: number; snapshot: Record<string, unknown> };
      expect(packet.snapshot).toMatchObject({ title: "Authoritative", slideIndex: 1, slide: { lyric: "Verse" } });
      expect(track.mock.calls.filter(([name]) => name === "presentation_shadow_renderer_divergence")).toHaveLength(0);
      const inconsistent = { ...packet, snapshot: { ...packet.snapshot, title: "Diagnostic-only title" } };
      Broadcast.send(BROADCAST_TYPE.MUSIC_SHADOW_SNAPSHOT, inconsistent);
      Broadcast.send(BROADCAST_TYPE.MUSIC_SHADOW_SNAPSHOT, inconsistent);
      expect(state.title.value).toBe("Authoritative");
      expect(state.slide.value?.lyric).toBe("Verse");
      expect(track.mock.calls.filter(([name]) => name === "presentation_shadow_renderer_divergence"))
        .toEqual([["presentation_shadow_renderer_divergence", { fields: "title" }]]);
    } finally {
      receive.mockRestore();
      track.mockRestore();
    }
  });
});
