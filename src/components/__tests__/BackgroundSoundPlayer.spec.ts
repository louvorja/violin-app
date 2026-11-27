import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { ICONS } from "@/config/Icons";
import messages from "@/lang/pt.json";

// O rodapé aparece sem o módulo aberto: os rótulos dele vêm do idioma global.
const pt = messages.shell.background_sound;

const bg = {
  isPlaying: ref(true),
  currentFile: ref({ id: "s1", name: "Prelúdio", fileName: "preludio.mp3", path: "x" }),
  currentTime: ref(0),
  duration: ref(0),
  progress: ref(0),
  volume: ref(50),
  repeat: ref(false),
  fadeInMs: ref(3000),
  fadeOutMs: ref(3000),
  seek: vi.fn(),
  setVolume: vi.fn(),
  stop: vi.fn(),
  stopWithFade: vi.fn(),
  togglePlay: vi.fn(),
  toggleWithFade: vi.fn(),
};

vi.mock("@/composables/useBackgroundSound", () => ({ useBackgroundSound: () => bg }));
vi.mock("@/helpers/SettingsStorage", () => ({ saveSetting: vi.fn() }));

import BackgroundSoundPlayer from "../BackgroundSoundPlayer.vue";

const ButtonStub = defineComponent({
  name: "LjButton",
  props: { icon: { type: String, default: "" } },
  emits: ["click"],
  template: `<button :data-icon="icon" @click="$emit('click', $event)" />`,
});

function mountPlayer() {
  const i18n = createI18n({
    legacy: false,
    locale: "pt",
    messages: { pt: messages },
  });
  return mount(BackgroundSoundPlayer, {
    global: {
      plugins: [i18n],
      stubs: { LjButton: ButtonStub, LjIcon: true, LjSlider: true },
    },
  });
}

/**
 * Os dois botões vermelhos do player do rodapé faziam a mesma coisa: "Parar"
 * chamava `stop()` sem duração e cortava seco, como o "Parar imediatamente".
 */
describe("BackgroundSoundPlayer (rodapé)", () => {
  beforeEach(() => {
    bg.stop.mockClear();
    bg.stopWithFade.mockClear();
    bg.toggleWithFade.mockClear();
  });

  it("Parar sai com o fade configurado", async () => {
    const wrapper = mountPlayer();

    await wrapper.find(`[data-icon="${ICONS.PLAYER.STOP}"]`).trigger("click");

    expect(bg.stopWithFade).toHaveBeenCalledTimes(1);
    expect(bg.stop).not.toHaveBeenCalled();
  });

  it("Parar imediatamente corta na hora", async () => {
    const wrapper = mountPlayer();

    await wrapper.find(`[data-icon="${ICONS.PLAYER.STOP_NOW}"]`).trigger("click");

    expect(bg.stop).toHaveBeenCalledWith(0);
    expect(bg.stopWithFade).not.toHaveBeenCalled();
  });

  it("Tocar/Pausar usa os fades configurados", async () => {
    const wrapper = mountPlayer();

    await wrapper.find(`[data-icon="${ICONS.PLAYER.PAUSE}"]`).trigger("click");

    expect(bg.toggleWithFade).toHaveBeenCalledTimes(1);
  });

  it("cada botão de ícone diz o que faz", () => {
    const wrapper = mountPlayer();
    const title = (icon: string) => wrapper.find(`[data-icon="${icon}"]`).attributes("title");

    expect(title(ICONS.PLAYER.STOP)).toBe(pt.stop);
    expect(title(ICONS.PLAYER.STOP_NOW)).toBe(pt.stop_immediately);
    expect(title(ICONS.PLAYER.PAUSE)).toBe(pt.pause);
  });
});
