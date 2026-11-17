import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const mocks = vi.hoisted(() => {
  const listeners = new Set<(msg: { type: string; payload: unknown }) => void>();
  return {
    listeners,
    openFileWindows: vi.fn(async () => {}),
    closeFileWindows: vi.fn(async () => {}),
    closeMusicWindows: vi.fn(async () => {}),
  };
});

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    listen: (cb: (msg: { type: string; payload: unknown }) => void) => {
      mocks.listeners.add(cb);
      return () => mocks.listeners.delete(cb);
    },
    send: (type: string, payload: unknown) => {
      for (const cb of mocks.listeners) cb({ type, payload });
    },
  },
}));

vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/helpers/ProjectionWindows")>();
  return {
    ...orig,
    openFileProjectionWindows: mocks.openFileWindows,
    closeFileProjectionWindows: mocks.closeFileWindows,
    closeMusicProjectionWindows: mocks.closeMusicWindows,
  };
});

vi.mock("@/composables/useProjectionCloseNotice", () => ({
  useProjectionCloseNotice: vi.fn(),
}));

vi.mock("@/helpers/AudioPacketScan", () => ({
  prepareLocalMediaAudio: vi.fn(async () => {}),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));

import { KEYS } from "@/constants/UserDataKeys";
import { MediaEnum } from "@/enums/MediaEnum";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import Media from "@/composables/useMedia";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import { useTimerEndAction } from "@/composables/useTimerEndAction";
import FileProjection from "@/views/FileProjection.vue";
import BackgroundProjection from "@/views/BackgroundProjection.vue";

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: {
    pt: {
      projection: {
        video_unavailable: "Vídeo indisponível",
        video_unavailable_hint: "Tente novamente",
      },
      modules: {
        timer: { lang: { end_action: {} } },
        timer_worship: { lang: { end_action: {} } },
      },
    },
  },
});

function setupLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

function withEndAction(moduleId: "timer" | "timer_worship") {
  let api!: ReturnType<typeof useTimerEndAction>;
  const keys = moduleId === "timer" ? KEYS.MODULES.TIMER : KEYS.MODULES.TIMER_WORSHIP;
  const Host = defineComponent({
    setup() {
      api = useTimerEndAction(moduleId, keys);
      return {};
    },
    template: "<div />",
  });
  const wrapper = mount(Host, { global: { plugins: [i18n] } });
  return { wrapper, api, keys };
}

describe("useTimerEndAction — integração com Media e projeção", () => {
  const playCalls: Array<{ tag: string; src: string }> = [];

  beforeEach(() => {
    setActivePinia(createPinia());
    setupLocalStorage();
    mocks.listeners.clear();
    mocks.openFileWindows.mockClear();
    mocks.closeFileWindows.mockClear();
    mocks.closeMusicWindows.mockClear();
    playCalls.length = 0;

    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VOLUME, 80);

    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement
    ) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement
    ) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      playCalls.push({
        tag: this.tagName.toLowerCase(),
        src: this.getAttribute("src") || this.src || "",
      });
      return Promise.resolve();
    });
  });

  afterEach(async () => {
    await Media.close(true);
    useAudioPlayback().reset();
    vi.restoreAllMocks();
    mocks.listeners.clear();
  });

  it.each(["timer", "timer_worship"] as const)(
    "%s: vídeo MP4 ao fim do timer inicia no player (com áudio) e sincroniza projeção sem autoplay",
    async (moduleId) => {
      const projection = mount(FileProjection, {
        attachTo: document.body,
        global: { plugins: [i18n], stubs: { OverlayRenderer: true, Transition: false } },
      });
      const { wrapper, api, keys } = withEndAction(moduleId);

      const url = "louvorja://local/C:/Videos/abertura.mp4";
      $userdata.set(keys.END_ACTION, MediaEnum.VIDEO);
      $userdata.set(keys.END_ACTION_VIDEO, { url, type: "video" });

      // Player começa parado (sem faixa carregada).
      expect($appdata.get(KEYS.MODULES.MEDIA.IS_PLAYING)).toBeFalsy();

      api.triggerTimerEndAction();
      await flushPromises();
      await nextTick();
      await flushPromises();

      const videoEl = projection.find("video.file-projection__media").element as HTMLVideoElement;
      expect(videoEl).toBeTruthy();
      expect(videoEl.autoplay).toBe(false);
      expect(videoEl.muted).toBe(true);

      // O player principal iniciou a faixa de vídeo (com áudio) e emitiu VIDEO_STATE de play.
      expect($appdata.get(KEYS.MODULES.MEDIA.IS_PLAYING)).toBe(true);
      expect($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE)).toBe(true);
      expect($appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED)).toBe(false);
      expect(playCalls.some((c) => c.src === url)).toBe(true);
      expect(videoEl.paused).toBe(false);

      // Pausa e seek pelo player propagam para a projeção.
      Media.pause(true);
      await flushPromises();
      expect(videoEl.paused).toBe(true);

      const playerEl = useAudioPlayback().getElement();
      Object.defineProperty(playerEl, "duration", { configurable: true, value: 30 });
      Object.defineProperty(videoEl, "duration", { configurable: true, value: 30 });
      Object.defineProperty(videoEl, "readyState", { configurable: true, value: 4 });
      Media.goToTime(4.2);
      await flushPromises();
      expect(videoEl.currentTime).toBeCloseTo(4.2, 1);

      wrapper.unmount();
      projection.unmount();
    }
  );

  it("imagem ao fim do timer projeta normalmente e preserva áudio já em execução", async () => {
    const audio = useAudioPlayback();
    const stopSpy = vi.spyOn(audio, "stop");
    const { wrapper, api, keys } = withEndAction("timer");

    $userdata.set(keys.END_ACTION, MediaEnum.VIDEO);
    $userdata.set(keys.END_ACTION_VIDEO, {
      url: "louvorja://local/C:/Imagens/aviso.jpg",
      type: "image",
    });

    api.triggerTimerEndAction();
    await flushPromises();

    expect(stopSpy).not.toHaveBeenCalled();
    expect(playCalls).toHaveLength(0);
    expect($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE)).toBeFalsy();

    wrapper.unmount();
  });

  it("BackgroundProjection ativo sincroniza vídeo após timer/projectFile e mantém autoplay=false sem VIDEO_STATE", async () => {
    const bg = mount(BackgroundProjection, {
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { OverlayRenderer: true, ModuleProjectionLayer: true } },
    });
    const { wrapper, api, keys } = withEndAction("timer");

    // Bloqueia play() inicial do player para confirmar #73 antes de VIDEO_STATE.
    const url = "blob:https://app.test/abertura-timer.mp4";
    $appdata.set(KEYS.SHELL.IS_ONLINE, false);
    $userdata.set(keys.END_ACTION, MediaEnum.VIDEO);
    $userdata.set(keys.END_ACTION_VIDEO, { url, type: "video" });

    api.triggerTimerEndAction();
    await flushPromises();
    await nextTick();
    await flushPromises();

    const bgVideo = bg.find(".file-projection video").element as HTMLVideoElement;
    expect(bgVideo).toBeTruthy();
    expect(bgVideo.autoplay).toBe(false);
    expect(bgVideo.paused).toBe(false);
    expect(playCalls.some((c) => c.src === url)).toBe(true);

    wrapper.unmount();
    bg.unmount();
  });
});
