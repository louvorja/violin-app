import { describe, expect, it } from "vitest";
import { MusicPresentationCore } from "../MusicPresentationCore";

const fixture = () => new MusicPresentationCore("session-a", [
  { lyric: "Cover", cover: true }, { lyric: "Verse" }, { lyric: "Chorus" },
], [0, 10, 20], "Song");

describe("music presentation domain", () => {
  it("replays deterministically and rejects duplicate, older and foreign commands", () => {
    const a = fixture();
    const b = fixture();
    const command = { sessionId: "session-a", commandId: 2, type: "select" as const, index: 1 };
    expect(a.dispatch(command)).toEqual(b.dispatch(command));
    const committed = a.snapshot();
    expect(a.dispatch(command)).toBe(committed);
    expect(a.dispatch({ ...command, commandId: 1, index: 0 })).toBe(committed);
    expect(a.dispatch({ ...command, sessionId: "session-old", commandId: 3 })).toBe(committed);
    expect(a.dispatch({ ...command, commandId: NaN })).toBe(committed);
    expect(committed).toMatchObject({ revision: 1, slideIndex: 1, slide: { lyric: "Verse" }, nextSlide: { lyric: "Chorus" } });
  });

  it("clamps navigation and closes without allowing stale revival", () => {
    const core = fixture();
    const base = { sessionId: "session-a" };
    expect(core.dispatch({ ...base, commandId: 1, type: "select", index: 99 }).slideIndex).toBe(2);
    expect(core.dispatch({ ...base, commandId: 2, type: "select", index: NaN }).slideIndex).toBe(0);
    const closed = core.dispatch({ ...base, commandId: 3, type: "close" });
    expect(closed).toMatchObject({ active: false, totalSlides: 0, slide: null, nextSlide: null, title: "" });
    expect(core.dispatch({ ...base, commandId: 4, type: "select", index: 1 })).toBe(closed);
  });

  it("derives selection from audio time and supports changed track markers", () => {
    const core = fixture();
    const base = { sessionId: "session-a" };
    expect(core.dispatch({ ...base, commandId: 1, type: "clock", position: 15 }).slideIndex).toBe(1);
    expect(core.dispatch({ ...base, commandId: 2, type: "times", times: [0, 8, 13] }).slideIndex).toBe(1);
    expect(core.dispatch({ ...base, commandId: 3, type: "clock", position: 15 }).slideIndex).toBe(2);
  });

  it("does not select past the last visual slide when markers outnumber the deck", () => {
    const core = new MusicPresentationCore("a", [{ lyric: "Only" }], [0, 1, 2], "Song");
    expect(core.dispatch({ sessionId: "a", commandId: 1, type: "clock", position: 3 }).slideIndex).toBe(0);
    expect(core.snapshot().slide?.lyric).toBe("Only");
  });

  it("does not share selection fields or markers with mutable inputs", () => {
    const slides = [{ lyric: "Original" }];
    const times = [0];
    const core = new MusicPresentationCore("a", slides, times, "Song");
    slides[0].lyric = "Mutated";
    times.push(1);
    expect(core.snapshot().slide?.lyric).toBe("Original");
    expect(core.dispatch({ sessionId: "a", commandId: 1, type: "clock", position: 2 }).slideIndex).toBe(0);
  });

});
