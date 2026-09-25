import { describe, expect, it, vi } from "vitest";
import { MusicPresentationCore, type MusicSnapshot } from "../MusicPresentationCore";
import { createMemoryPresentationTransport } from "../PresentationTransport";

function fixture() {
  return createMemoryPresentationTransport(new MusicPresentationCore("song-1", [
    { lyric: "Cover" }, { lyric: "Verse" }, { lyric: "Chorus" },
  ], [0, 10, 20], "Song"));
}

describe("presentation memory transport used by the music core", () => {
  it("recovers one cohesive snapshot after observer disconnect and missed updates", () => {
    const transport = fixture();
    let observed: MusicSnapshot | null = null;
    const listener = (snapshot: MusicSnapshot) => { observed = snapshot; };
    const disconnect = transport.subscribe(listener);
    transport.dispatch({ sessionId: "song-1", commandId: 1, type: "select", index: 1 });
    expect(observed).toMatchObject({ revision: 1, slideIndex: 1 });
    disconnect();
    transport.dispatch({ sessionId: "song-1", commandId: 2, type: "select", index: 2 });
    expect(observed).toMatchObject({ revision: 1 });
    transport.subscribe(listener);
    observed = transport.requestSnapshot();
    expect(observed).toMatchObject({
      sessionId: "song-1", revision: 2, slideIndex: 2, totalSlides: 3,
      slide: { lyric: "Chorus" }, nextSlide: null, title: "Song",
    });
    expect(transport.requestSnapshot()).toBe(observed);
  });

  it("recovers closed state even if the close notification was lost", () => {
    const transport = fixture();
    transport.dispatch({ sessionId: "song-1", commandId: 1, type: "close" });
    expect(transport.requestSnapshot()).toMatchObject({ active: false, slide: null, totalSlides: 0 });
  });

  it("isolates observers and does not emit duplicates or foreign session commands", () => {
    const transport = fixture();
    transport.subscribe(() => { throw new Error("observer unavailable"); });
    const healthy = vi.fn();
    transport.subscribe(healthy);
    const command = { sessionId: "song-1", commandId: 1, type: "select" as const, index: 1 };
    transport.dispatch(command);
    transport.dispatch(command);
    transport.dispatch({ ...command, sessionId: "old-song", commandId: 2 });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledWith(transport.requestSnapshot());
  });
});
