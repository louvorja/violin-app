import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const fake = vi.hoisted(() => ({
  listeners: new Set<(message: { type: string; payload: unknown }) => void>(),
  track: vi.fn(),
  histogram: vi.fn(),
}));

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: vi.fn(),
    listen: (listener: (message: { type: string; payload: unknown }) => void) => {
      fake.listeners.add(listener);
      return () => fake.listeners.delete(listener);
    },
  },
}));

vi.mock("@/helpers/Telemetry", () => ({
  default: { track: fake.track, histogram: fake.histogram },
  isProjectionMilestone: (index: number, total: number) => index === 0 || index === total - 1,
}));

import { useProjectionState } from "@/composables/useProjectionState";

describe("useProjectionState frame opportunity", () => {
  let wrapper: VueWrapper | null = null;
  let frames: FrameRequestCallback[];

  const component = defineComponent({
    setup() {
      const { slide } = useProjectionState();
      return () => h("div", String(slide.value?.lyric ?? ""));
    },
  });

  function emit(payload: Record<string, unknown>) {
    for (const listener of [...fake.listeners]) {
      listener({ type: BROADCAST_TYPE.SLIDE_CHANGE, payload });
    }
  }

  function nextFrame() {
    const callbacks = frames;
    frames = [];
    for (const callback of callbacks) callback(performance.now());
  }

  beforeEach(() => {
    fake.listeners.clear();
    fake.track.mockClear();
    fake.histogram.mockClear();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    wrapper = mount(component);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
  });

  it("mede comando, recebimento, patch Vue e primeira oportunidade de pintura", async () => {
    await nextTick();
    const sentAt = Date.now() - 20;
    emit({
      slide: { lyric: "slide visível" },
      slide_index: 0,
      total_slides: 2,
      presentation_revision: 7,
      playback_id: "p1",
      _ts: sentAt,
      _command_ts: sentAt - 10,
    });
    await nextTick();
    expect(wrapper?.text()).toBe("slide visível");
    expect(fake.histogram).not.toHaveBeenCalledWith(
      "louvorja.projection.slide.frame_opportunity",
      expect.any(Number),
      expect.any(Object)
    );

    nextFrame();
    expect(fake.track).not.toHaveBeenCalledWith("projection_slide_frame_opportunity", expect.any(Object));
    nextFrame();

    expect(fake.histogram).toHaveBeenCalledWith(
      "louvorja.projection.slide.command_to_frame",
      expect.any(Number),
      { window_role: "auxiliary" }
    );
    expect(fake.track).toHaveBeenCalledWith(
      "projection_slide_frame_opportunity",
      expect.objectContaining({
        presentation_revision: 7,
        command_to_frame_ms: expect.any(Number),
        receive_to_apply_ms: expect.any(Number),
      })
    );
  });

  it("descarta o probe de um slide superado antes do frame", async () => {
    await nextTick();
    emit({ slide: { lyric: "antigo" }, slide_index: 0, total_slides: 2, _ts: Date.now() });
    await nextTick();
    emit({ slide: { lyric: "novo" }, slide_index: 1, total_slides: 2, _ts: Date.now() });
    await nextTick();
    nextFrame();
    nextFrame();

    expect(wrapper?.text()).toBe("novo");
    expect(fake.histogram.mock.calls.filter(([name]) => name === "louvorja.projection.slide.frame_opportunity")).toHaveLength(1);
  });

  it("não mede paint de uma rota já desmontada", async () => {
    await nextTick();
    emit({ slide: { lyric: "antigo" }, slide_index: 0, total_slides: 2, _ts: Date.now() });
    await nextTick();
    wrapper?.unmount();
    wrapper = null;
    nextFrame();
    nextFrame();

    expect(fake.histogram.mock.calls.filter(([name]) => name === "louvorja.projection.slide.frame_opportunity")).toHaveLength(0);
  });

  it("ignora timestamp remoto impossível sem criar histograma de alta cardinalidade", async () => {
    await nextTick();
    emit({ slide: { lyric: "visível" }, slide_index: 0, total_slides: 1, _ts: -1e12 });
    await nextTick();
    nextFrame();
    nextFrame();
    expect(fake.histogram).not.toHaveBeenCalled();
  });
});
