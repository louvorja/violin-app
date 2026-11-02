/**
 * Áudio de arquivo no player de mídia (`openAudio` com URL direta).
 *
 * É o caminho que a Biblioteca e a liturgia usam. Três invariantes importam:
 *
 * 1. **o telão é preservado** — um versículo/PDF projetado continua na tela
 *    enquanto a faixa toca (salvo se o que está lá for vídeo, que tem som
 *    próprio e se sobreporia);
 * 2. **o fim da faixa não fecha a projeção** — só a janela do player;
 * 3. **as setas continuam com quem está no palco** — áudio de arquivo não conta
 *    como "música tocando" (`_isPlayingMusic`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { KEYS } from "@/constants/UserDataKeys";
import $appdata from "@/helpers/AppData";

const t = vi.hoisted(() => ({ cb: null as null | ((_ct: number, _d: number) => void) }));

const h = vi.hoisted(() => ({
  audio: {
    isPaused: { value: true },
    currentTime: { value: 0 },
    duration: { value: 0 },
    progress: { value: 0 },
    buffered: { value: 0 },
    volume: { value: 100 },
    isFading: { value: false },
    setSrc: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    seekTo: vi.fn(),
    setElementKind: vi.fn(),
    setVolume: vi.fn(),
    setTelemetryContext: vi.fn(),
    setDurationHint: vi.fn(),
    takeOver: vi.fn(async () => {}),
    release: vi.fn(),
    advanceTime: vi.fn(),
    fadeIn: vi.fn(),
    fadeOut: vi.fn(),
    toggleVolume: vi.fn(),
    cleanup: vi.fn(),
    getElement: () => ({ currentTime: 0, paused: true, addEventListener: () => {} }),
    onTimeUpdate: (cb: (_ct: number, _d: number) => void) => {
      t.cb = cb;
      return () => {};
    },
  },
  fecharArquivo: vi.fn(async () => {}),
  fecharTudo: vi.fn(async () => {}),
  goNext: vi.fn(),
  goPrev: vi.fn(),
  resetSlides: vi.fn(),
}));

vi.mock("@/composables/useAudioPlayback", () => ({ useAudioPlayback: () => h.audio }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openProjectionWindows: vi.fn(async () => {}),
  openVideoProjectionWindows: vi.fn(async () => {}),
  isVideoProjectionOpen: vi.fn(async () => false),
  openFileProjectionWindows: vi.fn(async () => {}),
  closeProjectionWindows: () => h.fecharTudo(),
  closeFileProjectionWindows: () => h.fecharArquivo(),
  closeMusicProjectionWindows: vi.fn(async () => {}),
  // Fim da mídia com o Modo apresentação ligado: as telas ficam (não é o caso aqui).
  presentationKeepsScreens: () => false,
}));
vi.mock("@/composables/useSlides", () => ({
  useSlides: () => ({
    goNext: h.goNext,
    goPrev: h.goPrev,
    goFirst: vi.fn(),
    goLast: vi.fn(),
    reset: h.resetSlides,
    setSlides: vi.fn(),
    setTimes: vi.fn(),
    setPlaybackId: vi.fn(),
    broadcastSlide: vi.fn(),
    presentationSnapshot: () => null,
    timeForPosition: () => 0,
  }),
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: vi.fn(), listen: () => () => {}, getLastPayload: () => null },
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

/** Simula a faixa chegando ao fim, pelo callback que o player registrou. */
function terminarFaixa(duracao = 30): void {
  h.audio.duration.value = duracao;
  h.audio.isPaused.value = false;
  h.audio.currentTime.value = duracao;
  t.cb?.(duracao, duracao);
}

const AUDIO = {
  url: "blob:audio",
  title: "fundo.mp3",
  mediaType: "audio" as const,
  minimized: false,
  preserveFileProjection: true,
};

const projecao = (tipo: string) =>
  localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify({ type: tipo }));

beforeEach(async () => {
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
  h.audio.stop.mockClear();
  h.audio.setSrc.mockClear();
  h.fecharArquivo.mockClear();
  h.fecharTudo.mockClear();
  h.goNext.mockClear();
  localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
  $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
  media.unregisterNavigationDelegate();
});

describe("áudio de arquivo: palco", () => {
  it("não derruba um PDF projetado (o telão fica como está)", async () => {
    projecao("pdf");
    await media.openAudio(AUDIO).catch(() => {});

    expect(h.fecharArquivo).not.toHaveBeenCalled();
    expect(h.fecharTudo).not.toHaveBeenCalled();
  });

  it("derruba um VÍDEO projetado: ele tem som próprio e sobreporia a faixa", async () => {
    projecao("video");
    await media.openAudio(AUDIO).catch(() => {});

    expect(h.fecharArquivo).toHaveBeenCalled();
  });

  /*
   * Sem a opção, uma foto ou um PDF também ficam: o áudio toca por baixo deles
   * (useMedia.audioUnderImage.spec). O que sai é o vídeo, porque o player é um só.
   */
  it("sem a opção de preservar, um vídeo projetado ainda sai (liturgia/legado)", async () => {
    projecao("video");
    await media
      .openAudio({ url: "blob:audio", title: "x", mediaType: "audio" })
      .catch(() => {});

    expect(h.fecharArquivo).toHaveBeenCalled();
  });
});

describe("áudio de arquivo: player", () => {
  it("abre a janela da Mídia quando pedido", async () => {
    await media.openAudio(AUDIO).catch(() => {});

    expect($appdata.get(KEYS.MODULES.MEDIA.SHOW)).toBe(true);
    expect($appdata.get(KEYS.MODULES.MEDIA.MINIMIZED)).toBe(false);
  });

  it("minimizado NÃO abre a janela (é o que a Biblioteca pede)", async () => {
    await media.openAudio({ ...AUDIO, minimized: true }).catch(() => {});

    expect($appdata.get(KEYS.MODULES.MEDIA.SHOW)).toBe(false);
    expect($appdata.get(KEYS.MODULES.MEDIA.MINIMIZED)).toBe(true);
  });

  it("fim da faixa fecha a janela e NÃO fecha a projeção", async () => {
    const fechar = vi.spyOn(media, "close");
    await media.openAudio(AUDIO).catch(() => {});

    terminarFaixa();

    expect(fechar).not.toHaveBeenCalled();
    expect($appdata.get(KEYS.MODULES.MEDIA.SHOW)).toBe(false);
    expect($appdata.get(KEYS.MODULES.MEDIA.IS_PLAYING)).toBe(false);
  });

  it("áudio de arquivo NÃO conta como música para o desempate das setas", async () => {
    /* O player marca IS_PLAYING enquanto toca. Se isso valesse como "música",
     * as setas ignorariam o delegado de quem está no palco (a Biblioteca). */
    const next = vi.fn();
    media.registerNavigationDelegate({ next, prev: vi.fn() });

    await media.openAudio(AUDIO).catch(() => {});
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
    media.nextSlide();

    expect(next).toHaveBeenCalledTimes(1);
    expect(h.goNext).not.toHaveBeenCalled();
  });

  it("ao terminar, a próxima mídia volta a ser do deck (flag desarmada)", async () => {
    const next = vi.fn();
    media.registerNavigationDelegate({ next, prev: vi.fn() });

    await media.openAudio(AUDIO).catch(() => {});
    terminarFaixa();
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
    media.nextSlide();

    expect(next).not.toHaveBeenCalled();
    expect(h.goNext).toHaveBeenCalledTimes(1);
  });
});
