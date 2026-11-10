import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import AppData from "@/helpers/AppData";
import PlayerMediaSession from "@/helpers/PlayerMediaSession";
import { KEYS } from "@/constants/UserDataKeys";

const media = vi.hoisted(() => ({ play: vi.fn(), pause: vi.fn() }));
const audio = vi.hoisted(() => ({ isFading: { value: false } }));
vi.mock("@/composables/useMedia", () => ({ default: media }));
vi.mock("@/composables/useAudioPlayback", () => ({ useAudioPlayback: () => audio }));

const CONFIG = KEYS.MODULES.MEDIA.CONFIG;
const originalSession = Object.getOwnPropertyDescriptor(navigator, "mediaSession");
let handlers: Map<MediaSessionAction, MediaSessionActionHandler>;
let session: Pick<MediaSession, "playbackState" | "setActionHandler">;

function press(action: "play" | "pause"): void {
  const handler = handlers.get(action);
  expect(handler).toBeTypeOf("function");
  handler!({ action });
}

beforeEach(() => {
  setActivePinia(createPinia());
  handlers = new Map();
  session = {
    playbackState: "none",
    setActionHandler: vi.fn((action, handler) => {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    }),
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  audio.isFading.value = false;
  media.play.mockReset();
  media.pause.mockReset();
  AppData.set(CONFIG.AUDIO, "blob:musica-atual");
  AppData.set(CONFIG.IS_PAUSED, false);

  // O motor real e seus timers são cobertos em useMedia.crossfade.spec.ts.
  // Aqui os comandos mudam a intenção, mantendo a transição em andamento.
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
  PlayerMediaSession.destroy();
  if (originalSession) Object.defineProperty(navigator, "mediaSession", originalSession);
  else Reflect.deleteProperty(navigator, "mediaSession");
});

describe("PlayerMediaSession", () => {
  it("não exige a API em navegadores sem suporte", () => {
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: undefined });
    expect(() => PlayerMediaSession.init()).not.toThrow();
    expect(media.play).not.toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
  });

  it("instala uma vez e reflete imediatamente os pedidos feitos por Space ou botão", () => {
    PlayerMediaSession.init();
    PlayerMediaSession.init();
    expect(session.setActionHandler).toHaveBeenCalledTimes(2);
    expect(session.playbackState).toBe("playing");

    AppData.set(CONFIG.IS_PAUSED, true);
    expect(session.playbackState).toBe("paused");
    AppData.set(CONFIG.IS_PAUSED, false);
    expect(session.playbackState).toBe("playing");
    expect(media.play).not.toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
  });

  it("o segundo pause nativo durante o fade retoma em vez de pausar novamente", () => {
    PlayerMediaSession.init();
    press("pause");
    expect(session.playbackState).toBe("paused");
    expect(audio.isFading.value).toBe(true);

    // O sistema ainda escuta o elemento tocando e pode mandar pause de novo.
    press("pause");
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(session.playbackState).toBe("playing");
  });

  it("aceita pausa, retomada e nova pausa antes de a transição terminar", () => {
    PlayerMediaSession.init();
    press("pause");
    press("play");
    press("pause");
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(session.playbackState).toBe("paused");
  });

  it("fora do fade os comandos play e pause são idempotentes", () => {
    PlayerMediaSession.init();
    press("play");
    expect(media.play).not.toHaveBeenCalled();

    press("pause");
    audio.isFading.value = false;
    press("pause");
    expect(media.pause).toHaveBeenCalledTimes(1);

    press("play");
    audio.isFading.value = false;
    press("play");
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("ignora os controles enquanto a mídia carrega", () => {
    PlayerMediaSession.init();
    AppData.set(KEYS.MODULES.MEDIA.LOADING, true);
    press("pause");
    AppData.set(CONFIG.IS_PAUSED, true);
    press("play");
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
  });

  it("só assume os controles enquanto há mídia e os libera ao fechar", () => {
    AppData.set(CONFIG.AUDIO, "");
    PlayerMediaSession.init();
    expect(handlers.size).toBe(0);
    expect(session.playbackState).toBe("none");

    AppData.set(CONFIG.AUDIO, "blob:musica-atual");
    expect(handlers.size).toBe(2);
    expect(session.playbackState).toBe("playing");
    const latePause = handlers.get("pause")!;

    AppData.set(CONFIG.AUDIO, "");
    expect(handlers.size).toBe(0);
    expect(session.playbackState).toBe("none");
    latePause({ action: "pause" });
    expect(media.pause).not.toHaveBeenCalled();
  });

  it("remove handlers e observação ao desmontar, permitindo inicializar novamente", () => {
    PlayerMediaSession.init();
    PlayerMediaSession.destroy();
    expect(handlers.size).toBe(0);
    expect(session.playbackState).toBe("none");
    AppData.set(CONFIG.IS_PAUSED, true);
    expect(session.playbackState).toBe("none");
    expect(handlers.size).toBe(0);

    PlayerMediaSession.init();
    expect(session.playbackState).toBe("paused");
    press("play");
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("uma ação sem suporte não impede o boot nem o controle disponível", () => {
    const supported = session.setActionHandler;
    session.setActionHandler = vi.fn((action, handler) => {
      if (action === "pause") throw new DOMException("Unsupported action", "NotSupportedError");
      supported(action, handler);
    });
    AppData.set(CONFIG.IS_PAUSED, true);
    expect(() => PlayerMediaSession.init()).not.toThrow();
    expect(handlers.has("pause")).toBe(false);
    press("play");
    expect(media.play).toHaveBeenCalledTimes(1);
  });
});
