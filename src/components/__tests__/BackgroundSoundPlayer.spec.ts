import { beforeEach, describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

const sound = vi.hoisted(() => ({
  currentFile: { value: { id: "s1", name: "Som", fileName: "som.mp3" } },
  isPlaying: { value: true },
  currentTime: { value: 10 },
  duration: { value: 100 },
  progress: { value: 10 },
  repeat: { value: false },
  volume: { value: 50 },
  fadeInMs: { value: 3000 },
  fadeOutMs: { value: 4500 },
  togglePlay: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
}));

vi.mock("@/composables/useBackgroundSound", () => ({
  useBackgroundSound: () => sound,
}));
vi.mock("@/helpers/SettingsStorage", () => ({ saveSetting: vi.fn() }));

import BackgroundSoundPlayer from "../BackgroundSoundPlayer.vue";

function mount() {
  return shallowMount(BackgroundSoundPlayer, {
    global: {
      stubs: {
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
        LjSlider: { props: ["modelValue", "min", "max"], template: "<div />" },
      },
    },
  });
}

describe("BackgroundSoundPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sound.isPlaying.value = true;
    sound.currentFile.value = { id: "s1", name: "Som", fileName: "som.mp3" };
  });

  it("parar respeita o fade-out configurado", async () => {
    const wrapper = mount();
    await wrapper.get('[data-testid="bgs-stop-fade"]').trigger("click");
    expect(sound.stop).toHaveBeenCalledWith(4500);
  });

  it("parar imediatamente não usa fade", async () => {
    const wrapper = mount();
    await wrapper.get('[data-testid="bgs-stop-now"]').trigger("click");
    expect(sound.stop).toHaveBeenCalledWith(0);
  });
});
