import { describe, expect, it, vi } from "vitest";
import { VideoFirstFrame } from "@/helpers/VideoFirstFrame";

describe("VideoFirstFrame", () => {
  it("mede da ativação até uma frame decodificada, mesmo que ela chegue antes da revision", () => {
    let now = 0;
    let callback: ((now: number, metadata: unknown) => void) | undefined;
    const track = vi.fn();
    const first = new VideoFirstFrame("projection", track, () => now);
    const video = {
      readyState: 2,
      requestVideoFrameCallback: vi.fn((cb: typeof callback) => { callback = cb; return 7; }),
      cancelVideoFrameCallback: vi.fn(),
    };
    first.begin("playback-a");
    now = 400;
    first.attach(video);
    first.mediaReady(video);
    now = 750;
    callback?.(now, {});
    expect(track).not.toHaveBeenCalled();
    first.acceptRevision(3);
    first.acceptRevision(4);
    first.attach(video);
    callback?.(now, {});
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("projection_video_first_decoded_frame", {
      role: "projection",
      playback_id: "playback-a",
      revision: 3,
      elapsed_ms: 750,
      measurement_method: "requestVideoFrameCallback",
    });
  });

  it("marca fallback só como media ready e limita duração", () => {
    let now = 0;
    const track = vi.fn();
    const first = new VideoFirstFrame("return", track, () => now);
    const video = { readyState: 1 };
    first.begin("playback-b");
    first.acceptRevision(1);
    first.mediaReady(video);
    expect(track).not.toHaveBeenCalled();
    video.readyState = 2;
    now = 100_000;
    first.mediaReady(video);
    first.mediaReady(video);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("projection_video_media_ready", {
      role: "return",
      playback_id: "playback-b",
      revision: 1,
      elapsed_ms: 60_000,
      measurement_method: "readyState",
    });
  });

  it("preserva o primeiro quadro quando a identidade só chega no VIDEO_STATE", () => {
    let callback: ((now: number, metadata: unknown) => void) | undefined;
    const track = vi.fn();
    const first = new VideoFirstFrame("projection", track, () => 25);
    first.begin(null);
    first.attach({
      readyState: 2,
      requestVideoFrameCallback: (cb) => { callback = cb; return 1; },
    });
    callback?.(25, {});
    first.acceptRevision(1, "late-playback");
    expect(track).toHaveBeenCalledWith(
      "projection_video_first_decoded_frame",
      expect.objectContaining({ playback_id: "late-playback", elapsed_ms: 0 })
    );
  });

  it("cancela callbacks obsoletos ao trocar ou fechar playback", () => {
    let now = 0;
    const callbacks: Array<(now: number, metadata: unknown) => void> = [];
    const track = vi.fn();
    const cancel = vi.fn();
    const first = new VideoFirstFrame("projection", track, () => now);
    const video = {
      readyState: 2,
      requestVideoFrameCallback: (cb: (now: number, metadata: unknown) => void) => callbacks.push(cb),
      cancelVideoFrameCallback: cancel,
    };
    first.begin("old");
    first.attach(video);
    first.acceptRevision(1);
    first.begin("new");
    first.attach(video);
    first.acceptRevision(1);
    now = 50;
    callbacks[0](now, {});
    expect(track).not.toHaveBeenCalled();
    first.dispose();
    callbacks[1](now, {});
    expect(track).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("não reemite para o mesmo playback após replay da identidade, mas mede um novo", () => {
    const track = vi.fn();
    const first = new VideoFirstFrame("projection", track, () => 20);
    const video = { readyState: 2 };
    first.begin("one");
    first.acceptRevision(1);
    first.mediaReady(video);
    first.begin("one");
    first.acceptRevision(2);
    first.mediaReady(video);
    first.begin("two");
    first.acceptRevision(1);
    first.mediaReady(video);
    expect(track).toHaveBeenCalledTimes(2);
  });
});
