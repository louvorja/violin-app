import { describe, expect, it } from "vitest";
import { createVideoPlaybackSnapshot, playbackPositionAt, shouldRespondToVideoStateRequest } from "@/helpers/VideoPlaybackSnapshot";
import { VideoStateGate } from "@/helpers/VideoStateVersion";
import { expectedVideoTime, syncVideoElement } from "@/helpers/VideoSync";

describe("video playback recovery snapshot", () => {
  it("captures a coherent clock and advances it at the source rate", () => {
    const snapshot = createVideoPlaybackSnapshot({
      playback_id: "current", revision: 7, currentTime: 12, isPaused: false, rate: 1.5,
    }, 10_000);
    expect(snapshot).toEqual({
      playback_id: "current", revision: 7, sampledAt: 10_000,
      position: 12, playing: true, rate: 1.5, clockAnchor: 2_000,
    });
    expect(playbackPositionAt(snapshot!, 10_400)).toBeCloseTo(12.6);
    expect(expectedVideoTime({ currentTime: 12, isPaused: false, ...snapshot }, 10_400)).toBeCloseTo(12.6);
    expect(expectedVideoTime({ currentTime: 12, isPaused: true, ...snapshot }, 10_400)).toBeNull();
    const el = { readyState: 4, seeking: false, currentTime: 12.6, duration: 100, playbackRate: 1 };
    expect(syncVideoElement(el, { currentTime: 12, isPaused: false, ...snapshot }, 10_400)).toBe("ok");
    expect(el.playbackRate).toBe(1.5);
  });

  it("keeps a paused frame fixed and bounds stale clock extrapolation after a freeze", () => {
    const paused = createVideoPlaybackSnapshot({
      playback_id: "current", revision: 8, currentTime: 25, isPaused: true,
    }, 10_000)!;
    expect(paused.clockAnchor).toBeNull();
    expect(playbackPositionAt(paused, 60_000)).toBe(25);
    expect(playbackPositionAt({ ...paused, playing: true }, 60_000)).toBe(27);
  });

  it("rejects malformed samples and an old playback cannot move a reopened projection", () => {
    expect(createVideoPlaybackSnapshot({
      playback_id: "", revision: 1, currentTime: 1, isPaused: false,
    }, 1000)).toBeNull();
    expect(createVideoPlaybackSnapshot({
      playback_id: "current", revision: 1, currentTime: NaN, isPaused: false,
    }, 1000)).toBeNull();

    const gate = new VideoStateGate();
    gate.begin("current");
    const old = { currentTime: 90, isPaused: false, duration: 100, playback_id: "old", revision: 99 };
    const fresh = { currentTime: 25, isPaused: true, duration: 100, playback_id: "current", revision: 1 };
    expect(gate.accepts(old)).toBe(false);
    expect(gate.accepts(fresh)).toBe(true);
    const el = { readyState: 4, seeking: false, currentTime: 0, duration: 100, playbackRate: 1 };
    expect(syncVideoElement(el, { ...fresh, ...createVideoPlaybackSnapshot(fresh, 1000) }, 5000)).toBe("seek");
    expect(el.currentTime).toBe(25);
  });

  it("responds only to the current identified video, including while paused", () => {
    expect(shouldRespondToVideoStateRequest("current", "current", true)).toBe(true);
    expect(shouldRespondToVideoStateRequest("old", "current", true)).toBe(false);
    expect(shouldRespondToVideoStateRequest(undefined, "current", true)).toBe(false);
    expect(shouldRespondToVideoStateRequest("current", "current", false)).toBe(false);
  });
});
