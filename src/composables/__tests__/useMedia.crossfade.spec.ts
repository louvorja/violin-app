import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { KEYS } from "@/constants/UserDataKeys";
import type { Music } from "@/types/Music";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: vi.fn(async () => undefined),
    getAll: vi.fn(async () => []),
    getAllByPrefix: vi.fn(async () => []),
    put: vi.fn(async () => {}),
    putMany: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/Path", () => ({
  default: { db: (path: string) => `https://api.test/json_db${path}` },
}));
vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_TOKEN: "",
  API_URL_FALLBACK: "https://fallback.test",
  API_URL_DB_FALLBACK: "https://fallback.test/json_db",
  API_URL_FALLBACK_TOKEN: "",
  apiOrigin: () => "https://api.test",
  API_URL_DB: "https://api.test/json_db",
  API_URL_FILES: "https://api.test/file",
  getTokenForUrl: () => "",
  apiTokenHeaders: () => ({}),
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: {
    track: vi.fn(),
    captureException: vi.fn(),
    setRuntimeContext: vi.fn(),
    log: vi.fn(),
  },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openProjectionWindows: vi.fn(async () => {}),
  openVideoProjectionWindows: vi.fn(async () => {}),
  isVideoProjectionOpen: vi.fn(async () => false),
  openFileProjectionWindows: vi.fn(async () => {}),
  closeProjectionWindows: vi.fn(async () => {}),
  closeFileProjectionWindows: vi.fn(async () => {}),
  closeMusicProjectionWindows: vi.fn(async () => {}),
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

const song: Music = { id_music: 123, name: "Próxima música", duration: "00:03:00", lyric: [] };

beforeEach(async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  h.fetch.mockReset();
  h.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => song,
  } as Response);
  vi.stubGlobal("fetch", h.fetch);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  media = (await import("@/composables/useMedia")).default;
  vi.spyOn(media, "_launchProjection").mockImplementation(() => {});
  const { default: userdata } = await import("@/helpers/UserData");
  userdata.set(KEYS.MODULES.MEDIA.FADE_AUDIO, true);
  vi.useFakeTimers();
});

afterEach(() => {
  media.clearVariables();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A música atual está no ar: abrir outra começa pelo fade-out dela. */
async function tocandoMusicaAtual(): Promise<HTMLMediaElement> {
  const { useAudioPlayback } = await import("@/composables/useAudioPlayback");
  const el = useAudioPlayback().getElement();
  el.setAttribute("src", "blob:musica-atual");
  Object.defineProperty(el, "paused", { configurable: true, value: false });
  el.volume = 1;
  return el;
}

function acompanhar(promise: Promise<boolean>) {
  const state = { settled: false, value: undefined as boolean | undefined };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

describe("pausar e retomar com fade", () => {
  it("a tecla multimídia usa o fade e retoma mesmo se o sistema enviar pause duas vezes", async () => {
    const el = await tocandoMusicaAtual();
    el.play = vi.fn(async () => {
      Object.defineProperty(el, "paused", { configurable: true, value: false });
    });
    el.pause = vi.fn(() => {
      Object.defineProperty(el, "paused", { configurable: true, value: true });
    });
    const { default: appdata } = await import("@/helpers/AppData");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "blob:musica-atual");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.VOLUME, 100);

    const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
    const session = {
      playbackState: "none" as MediaSessionPlaybackState,
      setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
        if (handler) handlers.set(action, handler);
        else handlers.delete(action);
      },
    };
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaSession");
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
    const { default: playerSession } = await import("@/helpers/PlayerMediaSession");
    try {
      playerSession.init();
      handlers.get("pause")!({ action: "pause" });
      expect(session.playbackState).toBe("paused");
      expect(el.pause).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60);
      expect(el.volume).toBeGreaterThan(0);
      expect(el.volume).toBeLessThan(1);

      // O elemento ainda toca: o Play/Pause físico pode chegar como outro pause.
      handlers.get("pause")!({ action: "pause" });
      expect(session.playbackState).toBe("playing");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(el.play).toHaveBeenCalledTimes(1);
      expect(el.pause).not.toHaveBeenCalled();
      expect(el.volume).toBe(1);

      handlers.get("pause")!({ action: "pause" });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(el.pause).toHaveBeenCalledTimes(1);
      expect(el.volume).toBe(0);
      expect(session.playbackState).toBe("paused");

      handlers.get("play")!({ action: "play" });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(el.play).toHaveBeenCalledTimes(2);
      expect(el.volume).toBe(1);
      expect(session.playbackState).toBe("playing");
    } finally {
      playerSession.destroy();
      if (original) Object.defineProperty(navigator, "mediaSession", original);
      else Reflect.deleteProperty(navigator, "mediaSession");
    }
  });

  it("o estado muda no pedido: o segundo toque durante o fade retoma, não pausa de novo", async () => {
    const el = await tocandoMusicaAtual();
    el.play = vi.fn(() => Promise.resolve()) as unknown as HTMLMediaElement["play"];
    const { default: appdata } = await import("@/helpers/AppData");
    const pausado = () => appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED);

    media.pause();
    expect(pausado()).toBe(true);
    await vi.advanceTimersByTimeAsync(60);

    // O botão e o espaço decidem por este estado (main-shell `_playPause`).
    if (pausado()) media.play();
    else media.pause();
    expect(pausado()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(el.play).toHaveBeenCalled();
    expect(pausado()).toBe(false);
  });

  it("play que falha volta a mostrar pausado", async () => {
    const el = await tocandoMusicaAtual();
    const erro = new Error("no supported source");
    erro.name = "NotSupportedError";
    el.play = vi.fn(() => Promise.reject(erro)) as unknown as HTMLMediaElement["play"];
    const { default: appdata } = await import("@/helpers/AppData");

    media.play();
    expect(appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED)).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED)).toBe(true);
  });
});

describe("fade ao trocar de música", () => {
  it("abre a próxima música mesmo se o operador pausar durante o fade", async () => {
    await tocandoMusicaAtual();
    const opened = acompanhar(media.open(123));
    await vi.advanceTimersByTimeAsync(60);

    media.pause();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(opened.settled).toBe(true);
  });

  it("a segunda música pedida durante o fade não deixa a primeira presa", async () => {
    await tocandoMusicaAtual();
    const first = acompanhar(media.open(123));
    await vi.advanceTimersByTimeAsync(60);

    const second = acompanhar(media.open(123));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(second.settled).toBe(true);
    expect(first.settled).toBe(true);
  });

  it("parar durante o fade não deixa a abertura pendurada", async () => {
    await tocandoMusicaAtual();
    const opened = acompanhar(media.open(123));
    await vi.advanceTimersByTimeAsync(60);

    media.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(opened.settled).toBe(true);
  });
});
