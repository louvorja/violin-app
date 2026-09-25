import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useProjectionState } from "../useProjectionState";
import { useSlides } from "../useSlides";
import Telemetry from "@/helpers/Telemetry";
import { readMusicPresentationPacket } from "@/presentation/MusicPresentationPacket";

const producer = useSlides();
let state: ReturnType<typeof useProjectionState>;
let wrapper: VueWrapper | undefined;
const component = defineComponent({
  setup() { state = useProjectionState(); return () => h("div"); },
});

function slide(playbackId: string | undefined, revision: number | undefined, index = 1) {
  if (revision !== undefined) return versionedSelection(playbackId ?? "unidentified-song", revision, index, "Current", playbackId ?? null);
  Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
    playback_id: playbackId, slide_index: index,
    slide: { lyric: "Current" }, next_slide: null, title: "Song", total_slides: 3,
  });
}

function versionedSelection(session: string, revision: number, index: number, lyric: string, playbackId: string | null = session) {
  const packet = readMusicPresentationPacket({
    schema: 1, selectionRevision: revision, playbackId: playbackId === null ? undefined : playbackId,
    progress: 0, slideProgress: 0, emittedAt: Date.now(),
    snapshot: {
      sessionId: session, revision, active: true, title: session,
      slideIndex: index, totalSlides: 3, slide: { lyric },
      nextSlide: index < 2 ? { lyric: "Next" } : null,
    },
  });
  if (!packet) throw new Error("invalid fixture");
  Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet);
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

  it("does not roll the visible slide back on reordered or duplicate versioned selections", () => {
    versionedSelection("song-a", 10, 1, "Current");
    progress("song-a", 10, 1, 40);
    versionedSelection("song-a", 9, 0, "Older");
    versionedSelection("song-a", 10, 0, "Duplicate");
    expect(state.slide.value?.lyric).toBe("Current");
    expect(state.slideIndex.value).toBe(1);
    expect(state.slideProgress.value).toBe(40);

    versionedSelection("song-b", 11, 2, "New session");
    versionedSelection("song-a", 10, 0, "Late old session");
    expect(state.slide.value?.lyric).toBe("New session");
    expect(state.slideIndex.value).toBe(2);
  });

  it("accepts a fresh producer session whose revision restarted and rejects the retired session", () => {
    versionedSelection("before-reload", 20, 1, "Before reload");
    versionedSelection("after-reload", 1, 2, "After reload");
    versionedSelection("before-reload", 21, 0, "Late old session");
    expect(state.slide.value?.lyric).toBe("After reload");
    expect(state.slideIndex.value).toBe(2);
    versionedSelection("after-reload", 2, 1, "Next current slide");
    expect(state.slide.value?.lyric).toBe("Next current slide");
  });

  it("retires a closed session so a delayed slide cannot revive it, but accepts a new session", () => {
    versionedSelection("closed", 4, 1, "Closing");
    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
    versionedSelection("closed", 5, 2, "Late closed slide");
    expect(state.slide.value).toBeNull();
    versionedSelection("new", 1, 0, "Fresh after close");
    expect(state.slide.value?.lyric).toBe("Fresh after close");
  });

  it("keeps same-selection compatibility for unrevisioned legacy senders", () => {
    slide(undefined, undefined);
    progress(undefined, undefined);
    expect(state.slideProgress.value).toBe(70);
    progress(undefined, undefined, 2);
    expect(state.slideIndex.value).toBe(1);
  });

  it("still accepts legacy selections after a versioned selection", () => {
    versionedSelection("song-a", 30, 1, "Versioned");
    slide(undefined, undefined, 2);
    versionedSelection("song-a", 31, 0, "Late versioned");
    expect(state.slide.value?.lyric).toBe("Current");
    expect(state.slideIndex.value).toBe(2);
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
    const revision = (Broadcast.getLastPayload(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) as Record<string, unknown>).selectionRevision;
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

  it("reports one bounded recovery timeout when a deck arrives without its canonical snapshot", () => {
    vi.useFakeTimers();
    const track = vi.spyOn(Telemetry, "track");
    try {
      Broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
        presentation_session: "missing-core", slides: [{ lyric: "Verse" }],
      });
      vi.advanceTimersByTime(2_000);
      expect(track.mock.calls.filter(([event]) => event === "presentation_snapshot_missing"))
        .toEqual([["presentation_snapshot_missing", { reason: "timeout_after_deck" }]]);
      Broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
        presentation_session: "missing-core", slides: [{ lyric: "Verse" }],
      });
      vi.advanceTimersByTime(2_000);
      expect(track.mock.calls.filter(([event]) => event === "presentation_snapshot_missing")).toHaveLength(1);
    } finally {
      track.mockRestore();
      vi.useRealTimers();
    }
  });

});
