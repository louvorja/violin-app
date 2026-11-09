import { describe, expect, it } from "vitest";
import { musicCommandSessionRejectionReason, readMusicPresentationPacket } from "../MusicPresentationPacket";
import { MusicPresentationCore } from "../MusicPresentationCore";

const snapshot = {
  sessionId: "song-a", revision: 1, active: true, title: "Song", slideIndex: 0,
  totalSlides: 2,
  slide: {
    lyric: "<b>Verse</b>", name: "Name", aux_lyric: "Aux", lyric_aux: "Aux legacy",
    url_image: "images/a.jpg", image_position: "center", cover: true, is_cover: true,
    tipo: "CAPA", color: "#fff", color_aux: "#aaa", font: "Inter",
    font_size_pct: 18, font_size_aux_pct: 12, id_music: 42,
    nested: { secret: "not a visual field" },
  },
  nextSlide: { lyric: "Next", id_music: "42", color: null },
};
const envelope = { schema: 1, selectionRevision: 4, playbackId: "play-a", progress: 25, slideProgress: 30, emittedAt: 1_000 };

describe("production music presentation packet boundary", () => {
  it("delivers the last timed slide even when unmarked slides follow it", () => {
    const core = new MusicPresentationCore("timed-song", [
      { lyric: "Verse" }, { lyric: "Last timed verse" }, { lyric: "Unmarked" },
    ], [0, 10, 0], "Song");
    const lastTimed = core.dispatch({
      type: "clock", position: 15, sessionId: "timed-song", commandId: 1,
    });
    expect(lastTimed).toMatchObject({ slideIndex: 1, totalSlides: 3, nextSlide: null });
    expect(readMusicPresentationPacket({ ...envelope, snapshot: lastTimed })?.snapshot)
      .toEqual(lastTimed);
  });

  it("preserves both slides' visual fields and strips unrelated objects", () => {
    const packet = readMusicPresentationPacket({ ...envelope, snapshot });
    expect(packet?.snapshot.slide).toEqual({
      lyric: "<b>Verse</b>", name: "Name", aux_lyric: "Aux", lyric_aux: "Aux legacy",
      url_image: "images/a.jpg", image_position: "center", cover: true, is_cover: true,
      tipo: "CAPA", color: "#fff", color_aux: "#aaa", font: "Inter",
      font_size_pct: 18, font_size_aux_pct: 12, id_music: 42,
    });
    expect(packet?.snapshot.nextSlide).toEqual({ lyric: "Next", id_music: "42", color: null });
    expect(packet?.snapshot).toMatchObject({ sessionId: "song-a", revision: 1, slideIndex: 0 });
    expect(packet).toMatchObject({ selectionRevision: 4, playbackId: "play-a", progress: 25, slideProgress: 30 });
  });

  it("rejects malformed state and oversize payloads before delivery", () => {
    expect(readMusicPresentationPacket({ ...envelope, schema: 2, snapshot })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, snapshot: { ...snapshot, slideIndex: 2 } })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, snapshot: { ...snapshot, slideIndex: 1 } })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, snapshot: { ...snapshot, slide: { lyric: "x", id_music: {} } } })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, snapshot: { ...snapshot, slide: { lyric: "x".repeat(100_001) } } })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, snapshot: { ...snapshot, slide: { lyric: "x", url_image: "data:" + "x".repeat(8_193) } } })).toBeNull();
    const fullText = "x".repeat(100_000);
    const oversizedSlide = { lyric: fullText, aux_lyric: fullText, lyric_aux: fullText };
    expect(readMusicPresentationPacket({
      ...envelope, snapshot: { ...snapshot, slide: oversizedSlide, nextSlide: oversizedSlide },
    })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, selectionRevision: -1, snapshot })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, progress: Infinity, snapshot })).toBeNull();
    expect(readMusicPresentationPacket({ ...envelope, commandAt: 1_001, snapshot })).toBeNull();
  });

  it("rejects commands from an old, missing or closed music session", () => {
    const active = { active: true, sessionId: "song-b" };
    expect(musicCommandSessionRejectionReason(active, "song-b")).toBeNull();
    expect(musicCommandSessionRejectionReason(active, "song-a")).toBe("stale_or_missing_session");
    expect(musicCommandSessionRejectionReason(active, undefined)).toBe("stale_or_missing_session");
    expect(musicCommandSessionRejectionReason(active, 42)).toBe("invalid_session");
    expect(musicCommandSessionRejectionReason({ active: false, sessionId: "song-b" }, "song-b"))
      .toBe("stale_or_missing_session");
    expect(musicCommandSessionRejectionReason(null, undefined)).toBeNull();
  });

  it("validates send metadata without changing or exposing the underlying state", () => {
    expect(readMusicPresentationPacket({ ...envelope, snapshot,
      delivery: { kind: "snapshot", sentAt: 30_000, secret: "discard" } })?.delivery)
      .toEqual({ kind: "snapshot", sentAt: 30_000 });
    expect(readMusicPresentationPacket({ ...envelope, snapshot, delivery: { kind: "replay" } })?.delivery)
      .toEqual({ kind: "replay" });
    for (const delivery of [null, [], { kind: "unknown", sentAt: 1 }, { kind: "update", sentAt: -1 },
      { kind: "snapshot", sentAt: "now" }, { kind: "replay", sentAt: 1 }]) {
      expect(readMusicPresentationPacket({ ...envelope, snapshot, delivery })).toBeNull();
    }
  });
});
