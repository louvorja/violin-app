import { describe, expect, it, vi } from "vitest";
import { MusicPresentationCore } from "../MusicPresentationCore";
import { MusicShadowReceiver, readMusicShadowPacket } from "../MusicShadowReceiver";
import { createMusicShadowSessionFactory } from "@/helpers/MusicShadowSession";
import music1 from "../../../e2e/fixtures/music_1.json";

function fixture(sessionId = "session-a") {
  const core = new MusicPresentationCore(
    sessionId,
    [{ lyric: "Cover" }, { lyric: "Verse" }],
    [],
    "Song"
  );
  return { version: 1 as const, legacyRevision: 7, snapshot: core.snapshot() };
}

describe("auxiliary music snapshot shadow", () => {
  it("validates the boundary and strips nested/unrelated content", () => {
    const packet = fixture();
    expect(readMusicShadowPacket(null)).toBeNull();
    expect(readMusicShadowPacket({ ...packet, legacyRevision: NaN })).toBeNull();
    expect(
      readMusicShadowPacket({ ...packet, snapshot: { ...packet.snapshot, sessionId: "" } })
    ).toBeNull();
    expect(
      readMusicShadowPacket({ ...packet, snapshot: { ...packet.snapshot, slide: { lyric: [] } } })
    ).toBeNull();
    expect(
      readMusicShadowPacket({
        ...packet,
        snapshot: { ...packet.snapshot, slide: { lyric: "Text", extra: { private: true } } },
      })?.snapshot.slide
    ).toEqual({ lyric: "Text" });
  });

  it("rejects inconsistent active selections but accepts empty covers and the last slide", () => {
    const packet = fixture();
    const snapshot = packet.snapshot;
    expect(
      readMusicShadowPacket({
        ...packet,
        snapshot: { ...snapshot, totalSlides: 0, slide: null, nextSlide: null },
      })
    ).toBeNull();
    expect(
      readMusicShadowPacket({ ...packet, snapshot: { ...snapshot, slideIndex: 2 } })
    ).toBeNull();
    expect(readMusicShadowPacket({ ...packet, snapshot: { ...snapshot, slide: null } })).toBeNull();
    expect(
      readMusicShadowPacket({ ...packet, snapshot: { ...snapshot, nextSlide: null } })
    ).toBeNull();

    const cover = {
      ...packet,
      snapshot: { ...snapshot, slide: { cover: true }, nextSlide: { lyric: "Verse" } },
    };
    expect(readMusicShadowPacket(cover)?.snapshot.slide).toEqual({ cover: true });
    const lastSlide = {
      ...packet,
      snapshot: {
        ...snapshot,
        slideIndex: 1,
        slide: { lyric: "Verse" },
        nextSlide: null,
      },
    };
    expect(readMusicShadowPacket(lastSlide)?.snapshot.nextSlide).toBeNull();
  });

  it("normalizes null optional image fields from the real music fixture", () => {
    const packet = fixture();
    const lyric = Object.values(music1.lyric)[0];
    const fromMusicFixture = {
      ...packet,
      snapshot: {
        ...packet.snapshot,
        slide: {
          lyric: music1.name,
          cover: true,
          url_image: music1.url_image,
          image_position: music1.image_position,
        },
        nextSlide: {
          lyric: lyric.lyric.replace(/[\r\n]+/g, "<br>"),
          cover: false,
          url_image: music1.url_image,
          image_position: music1.image_position,
        },
      },
    };
    const normalized = readMusicShadowPacket(fromMusicFixture);
    expect(normalized?.snapshot.slide).toEqual({
      lyric: "Aleluia",
      cover: true,
      url_image: null,
      image_position: null,
    });
    expect(normalized?.snapshot.nextSlide).toEqual({
      lyric: "Aleluia<br>Glória ao Senhor",
      cover: false,
      url_image: null,
      image_position: null,
    });
    const receiver = new MusicShadowReceiver();
    receiver.observe("session-a", 7, normalized!.snapshot);
    receiver.receive(normalized);
    expect(receiver.takeDifferences()).toEqual([]);
  });

  it("waits for matching legacy revision in either delivery order", () => {
    const receiver = new MusicShadowReceiver();
    const packet = fixture();
    receiver.receive(packet);
    receiver.observe("session-a", 6, { ...packet.snapshot, title: "Earlier title" });
    expect(receiver.takeDifferences()).toEqual([]);
    expect(receiver.comparisonCount()).toBe(0);
    receiver.observe("session-a", 7, packet.snapshot);
    expect(receiver.takeDifferences()).toEqual([]);
    expect(receiver.comparisonCount()).toBe(1);
    const next = {
      ...packet,
      legacyRevision: 8,
      snapshot: { ...packet.snapshot, revision: 1, title: "New title" },
    };
    receiver.observe("session-a", 8, next.snapshot);
    expect(receiver.takeDifferences()).toEqual([]);
    receiver.receive(next);
    expect(receiver.takeDifferences()).toEqual([]);
    expect(receiver.comparisonCount()).toBe(2);
    receiver.receive(packet);
    expect(receiver.snapshot()?.title).toBe("New title");
  });

  it("recovers after missed messages from one current snapshot and reports only one incident", () => {
    const receiver = new MusicShadowReceiver();
    const packet = fixture();
    receiver.observe("session-a", 7, packet.snapshot);
    receiver.receive(packet);
    const latest = {
      ...packet,
      legacyRevision: 20,
      snapshot: { ...packet.snapshot, revision: 10, title: "Recovered" },
    };
    receiver.observe("session-a", 20, latest.snapshot);
    receiver.receive(latest);
    expect(receiver.snapshot()).toEqual(latest.snapshot);
    expect(receiver.takeDifferences()).toEqual([]);
    receiver.observe("session-a", 20, { ...latest.snapshot, title: "Wrong legacy title" });
    expect(receiver.takeDifferences()).toEqual(["title"]);
    expect(receiver.takeDifferences()).toEqual([]);
    expect(receiver.comparisonCount()).toBe(2);
  });

  it("does not confuse Bible, close timing or old sessions with divergence", () => {
    const receiver = new MusicShadowReceiver();
    const packet = fixture();
    receiver.observe("session-a", 7, packet.snapshot);
    receiver.suspend();
    receiver.receive({ ...packet, snapshot: { ...packet.snapshot, title: "Different" } });
    expect(receiver.takeDifferences()).toEqual([]);
    const closed = {
      ...packet,
      snapshot: {
        ...packet.snapshot,
        revision: 1,
        active: false,
        title: "",
        totalSlides: 0,
        slide: null,
        nextSlide: null,
      },
    };
    receiver.receive(closed);
    receiver.close();
    expect(receiver.takeDifferences()).toEqual([]);
    const reopened = fixture("session-b");
    receiver.observe("session-b", 7, reopened.snapshot);
    receiver.receive(reopened);
    receiver.receive(packet);
    expect(receiver.snapshot()?.sessionId).toBe("session-b");
    expect(receiver.takeDifferences()).toEqual([]);
  });

  it("producer reload creates a fresh authority even at the same wall-clock time", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1);
    try {
      const firstProducer = createMusicShadowSessionFactory();
      const reloadedProducer = createMusicShadowSessionFactory();
      const previous = fixture(firstProducer());
      const current = fixture(reloadedProducer());
      expect(previous.snapshot.sessionId).not.toBe(current.snapshot.sessionId);
      const receiver = new MusicShadowReceiver();
      receiver.observe(current.snapshot.sessionId, 7, current.snapshot);
      receiver.receive(current);
      receiver.receive(previous);
      expect(receiver.snapshot()?.sessionId).toBe(current.snapshot.sessionId);
    } finally {
      now.mockRestore();
    }
  });
});
