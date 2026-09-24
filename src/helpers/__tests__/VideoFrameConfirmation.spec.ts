import { describe, expect, it, vi } from "vitest";
import { VideoFrameConfirmation, VIDEO_FRAME_SLOW_MS } from "@/helpers/VideoFrameConfirmation";
import type { VideoMediaState } from "@/types/Media";

const state = (patch: Partial<VideoMediaState> = {}): VideoMediaState => ({
  currentTime: 10,
  duration: 100,
  isPaused: false,
  playback_id: "playback-a",
  revision: 1,
  ...patch,
});

function scheduler() {
  let now = 0;
  let nextHandle = 1;
  const animationFrames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  return {
    setNow: (value: number) => (now = value),
    runAnimationFrame: (handle: number) => animationFrames.get(handle)?.(now),
    runTimer: (handle: number) => timers.get(handle)?.(),
    scheduler: {
      now: () => now,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const handle = nextHandle++;
        animationFrames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle: number) => animationFrames.delete(handle),
      setTimeout: (callback: () => void) => {
        const handle = nextHandle++;
        timers.set(handle, callback);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => timers.delete(handle as unknown as number),
    },
  };
}

describe("VideoFrameConfirmation", () => {
  it("correlaciona VIDEO_STATE aceito à frame realmente apresentada", () => {
    const track = vi.fn();
    const clock = scheduler();
    let callback: ((_now: number, _metadata: unknown) => void) | undefined;
    const confirmation = new VideoFrameConfirmation("file_projection_video", track, clock.scheduler);

    confirmation.observe(
      {
        requestVideoFrameCallback: (cb) => ((callback = cb), 10),
        cancelVideoFrameCallback: vi.fn(),
      },
      state({ revision: 4 }),
      "seek"
    );
    clock.setNow(42);
    callback?.(42, {});

    expect(track).toHaveBeenCalledWith("file_projection_video_frame_presented", {
      playback_id: "playback-a",
      revision: 4,
      sync_action: "seek",
      elapsed_ms: 42,
      measurement_method: "decoded_frame",
      actual_decoded_frame: true,
    });
  });

  it("descarta callback obsoleto quando uma nova transição aceita o substitui", () => {
    const track = vi.fn();
    const clock = scheduler();
    const callbacks: Array<(_now: number, _metadata: unknown) => void> = [];
    const confirmation = new VideoFrameConfirmation("file_projection_video", track, clock.scheduler);
    const video = {
      requestVideoFrameCallback: (callback: (_now: number, _metadata: unknown) => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelVideoFrameCallback: vi.fn(),
    };

    confirmation.observe(video, state({ revision: 1, isPaused: false }), "seek");
    confirmation.observe(video, state({ revision: 2, isPaused: true }), "ok");
    callbacks[0](0, {});
    callbacks[1](0, {});

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenLastCalledWith(
      "file_projection_video_frame_presented",
      expect.objectContaining({ revision: 2 })
    );
  });

  it("cancela ao desmontar ou quando o vídeo fica indisponível", () => {
    const track = vi.fn();
    const clock = scheduler();
    const cancelVideoFrameCallback = vi.fn();
    const confirmation = new VideoFrameConfirmation("file_projection_video", track, clock.scheduler);
    const video = { requestVideoFrameCallback: () => 9, cancelVideoFrameCallback };

    confirmation.observe(video, state(), "seek");
    confirmation.cancel(); // vídeo indisponível
    confirmation.observe(video, state({ revision: 2, isPaused: true }), "ok");
    confirmation.dispose(); // unmount

    expect(cancelVideoFrameCallback).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  it("marca rAF como oportunidade, nunca como prova de frame decodificada", () => {
    const track = vi.fn();
    const clock = scheduler();
    const confirmation = new VideoFrameConfirmation("file_projection_video", track, clock.scheduler);

    confirmation.observe({}, state(), "seek");
    clock.setNow(16);
    clock.runAnimationFrame(1);

    expect(track).toHaveBeenCalledWith(
      "file_projection_video_frame_opportunity",
      expect.objectContaining({
        measurement_method: "animation_frame_opportunity",
        actual_decoded_frame: false,
      })
    );
  });

  it("emite diagnóstico lento uma única vez, sem criar telemetria por frame", () => {
    const track = vi.fn();
    const clock = scheduler();
    const confirmation = new VideoFrameConfirmation("file_projection_video", track, clock.scheduler);

    confirmation.observe({ requestVideoFrameCallback: () => 1 }, state(), "seek");
    clock.setNow(VIDEO_FRAME_SLOW_MS);
    clock.runTimer(1);
    clock.runTimer(1);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      "file_projection_video_frame_slow",
      expect.objectContaining({ actual_decoded_frame: false, elapsed_ms: VIDEO_FRAME_SLOW_MS })
    );
  });
});
