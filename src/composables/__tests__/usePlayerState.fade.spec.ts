import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import PlayerControls from "@/components/PlayerControls.vue";
import LjIcon from "@/components/ui/LjIcon.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { usePlayerState } from "@/composables/usePlayerState";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import AppData from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { ICONS } from "@/config/Icons";

const media = vi.hoisted(() => ({ play: vi.fn(), pause: vi.fn() }));

vi.mock("@/composables/useMedia", () => ({
  default: { ...media, slides: () => [] },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: {} }));

const audio = useAudioPlayback();
const CONFIG = KEYS.MODULES.MEDIA.CONFIG;
const Harness = defineComponent({
  setup() {
    const { buttons } = usePlayerState();
    return () =>
      h(PlayerControls, {
        buttons: buttons.value,
        loading: !!AppData.get(KEYS.MODULES.MEDIA.LOADING, false),
      });
  },
});

let wrapper: ReturnType<typeof mountUi>;
const button = () => wrapper.get<HTMLButtonElement>("button.lj-btn--primary");
const icon = () => button().findComponent(LjIcon).props("icon");

beforeEach(() => {
  setActivePinia(createPinia());
  audio.reset();
  media.play.mockReset();
  media.pause.mockReset();
  AppData.set(CONFIG.AUDIO, "blob:musica-atual");
  AppData.set(CONFIG.IS_PAUSED, false);
  audio.isPaused.value = false;

  // O comando muda a intenção imediatamente; o estado físico fica atrasado
  // durante a transição. useMedia.crossfade.spec cobre o motor e seus timers.
  media.pause.mockImplementation(() => {
    AppData.set(CONFIG.IS_PAUSED, true);
    audio.isFading.value = true;
  });
  media.play.mockImplementation(() => {
    AppData.set(CONFIG.IS_PAUSED, false);
    audio.isFading.value = true;
  });
});

afterEach(() => {
  wrapper?.unmount();
  audio.reset();
});

describe("play/pause pelo botão durante o fade", () => {
  it("retoma ao clicar novamente durante o fade de pausa", async () => {
    wrapper = mountUi(Harness);
    expect(icon()).toBe(ICONS.PLAYER.PAUSE_PLAIN);

    await button().trigger("click");
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(audio.isPaused.value).toBe(false);
    expect(audio.isFading.value).toBe(true);
    expect(button().element.disabled).toBe(false);
    expect(icon()).toBe(ICONS.PLAYER.PLAYER);

    await button().trigger("click");
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(icon()).toBe(ICONS.PLAYER.PAUSE_PLAIN);

    await button().trigger("click");
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(icon()).toBe(ICONS.PLAYER.PLAYER);
  });

  it("pausa ao clicar novamente durante a retomada, antes de o áudio confirmar play", async () => {
    AppData.set(CONFIG.IS_PAUSED, true);
    audio.isPaused.value = true;
    wrapper = mountUi(Harness);

    await button().trigger("click");
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(audio.isPaused.value).toBe(true);
    expect(audio.isFading.value).toBe(true);
    expect(button().element.disabled).toBe(false);
    expect(icon()).toBe(ICONS.PLAYER.PAUSE_PLAIN);

    await button().trigger("click");
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(icon()).toBe(ICONS.PLAYER.PLAYER);
  });

  it("continua bloqueando play/pause enquanto a mídia carrega", async () => {
    AppData.set(KEYS.MODULES.MEDIA.LOADING, true);
    audio.isFading.value = true;
    wrapper = mountUi(Harness);

    expect(button().element.disabled).toBe(true);
    await button().trigger("click");
    expect(media.play).not.toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
  });
});
