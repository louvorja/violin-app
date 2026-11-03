import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const setting = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: vi.fn(async () => setting.current),
  saveSetting: vi.fn(),
}));
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import Slide from "@/components/Slide.vue";

describe("Slide.vue — fundo de vídeo dos slides", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    $userdata.set(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, true);
    $userdata.set(KEYS.OPTIONS.SLIDE.AFFECT_EXTERNAL_SLIDES, true);
    setting.current = {
      id: "slide_custom_background",
      image: new ArrayBuffer(8),
      mime: "video/mp4",
    };
  });

  it("renders a video layer for a video setting", async () => {
    const w = mount(Slide, {
      props: { slide: { lyric: "Teste", id_music: 1, cover: false } },
    });
    await new Promise((r) => setTimeout(r, 50));
    await w.vm.$nextTick();
    expect(w.find("video").exists()).toBe(true);
  });
});
