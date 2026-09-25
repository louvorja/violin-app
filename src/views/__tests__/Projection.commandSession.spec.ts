import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shallowMount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Projection from "@/views/Projection.vue";

const projectionState = {
  slide: ref({ lyric: "Cover" }),
  progress: ref(0),
  title: ref("Song"),
  slideIndex: ref(0),
  totalSlides: ref(2),
  sessionId: ref<string | null>(null),
};

vi.mock("@/composables/useProjectionState", () => ({
  useProjectionState: () => projectionState,
}));
vi.mock("@/views/LibrasOverlay.vue", () => ({ default: { template: "<div />" } }));

describe("Projection navigation session", () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    projectionState.sessionId.value = null;
    projectionState.slideIndex.value = 0;
    projectionState.totalSlides.value = 2;
    wrapper = shallowMount(Projection);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  it("attaches the current music session to cross-window commands", () => {
    const send = vi.spyOn(Broadcast, "send");
    projectionState.sessionId.value = "song-a";
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(send).toHaveBeenCalledWith(BROADCAST_TYPE.GO_TO_SLIDE,
      expect.objectContaining({ index: 1, presentation_session: "song-a", _command_ts: expect.any(Number) }));
  });

  it("keeps unversioned editor commands and ignores navigation without slides", () => {
    const send = vi.spyOn(Broadcast, "send");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    const command = send.mock.calls.find(([type]) => type === BROADCAST_TYPE.GO_TO_SLIDE)?.[1] as Record<string, unknown>;
    expect(command).toMatchObject({ index: 1, _command_ts: expect.any(Number) });
    expect(command).not.toHaveProperty("presentation_session");

    send.mockClear();
    projectionState.totalSlides.value = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(send).not.toHaveBeenCalled();
  });
});
