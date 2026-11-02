import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const el = { muted: false };
const duration = ref(0);
const isPaused = ref(true);
vi.mock("@/composables/useAudioPlayback", () => ({
  useAudioPlayback: () => ({ getElement: () => el, duration, isPaused }),
}));

const { usePlayerMute } = await import("../usePlayerMute");

describe("usePlayerMute", () => {
  it("mudo é do elemento, e vale para a próxima mídia até ser tirado", async () => {
    const mute = usePlayerMute();
    mute.mute();
    expect(el.muted).toBe(true);
    // O player troca de mídia e zera o elemento: o mudo volta.
    el.muted = false;
    duration.value = 40;
    await nextTick();
    expect(el.muted).toBe(true);
    mute.unmute();
    expect(el.muted).toBe(false);
    expect(mute.muted.value).toBe(false);
  });
});
