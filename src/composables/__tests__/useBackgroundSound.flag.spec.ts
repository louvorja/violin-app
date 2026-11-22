import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { KEYS } from "@/constants/UserDataKeys";

const { set } = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("@/helpers/UserData", () => ({ default: { set } }));
vi.mock("@/helpers/AppData", () => ({ default: { get: () => false, set: () => {} } }));
vi.mock("@/helpers/Broadcast", () => ({
  default: { listen: () => () => {}, send: () => {}, getLastPayload: () => undefined },
}));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: async () => null,
  saveSetting: async () => {},
}));

import { useBackgroundSound } from "@/composables/useBackgroundSound";

describe("sinal de som de fundo no ar", () => {
  it("acompanha o player mesmo sem a aba do módulo aberta", async () => {
    const bg = useBackgroundSound();
    bg.isPlaying.value = true;
    await nextTick();
    expect(set).toHaveBeenLastCalledWith(KEYS.MODULES.BACKGROUND_SOUND.IS_PLAYING, true);

    bg.isPlaying.value = false;
    await nextTick();
    expect(set).toHaveBeenLastCalledWith(KEYS.MODULES.BACKGROUND_SOUND.IS_PLAYING, false);
  });
});
