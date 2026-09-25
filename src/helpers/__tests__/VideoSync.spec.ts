import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVideoState,
  CATCH_UP,
  expectedVideoTime,
  HARD_SEEK_S,
  PAUSED_SEEK_S,
  RATE_SYNC_S,
  syncVideoElement,
} from "@/helpers/VideoSync";

describe("expectedVideoTime", () => {
  it("compensa a idade da mensagem quando o vídeo está tocando", () => {
    // Estado lido em t=10 s e recebido 300 ms depois: o som já está em 10,3.
    expect(expectedVideoTime({ currentTime: 10, isPaused: false, sentAt: 1000 }, 1300)).toBeCloseTo(10.3, 5);
  });

  it("pausado, a posição não anda", () => {
    expect(expectedVideoTime({ currentTime: 10, isPaused: true, sentAt: 1000 }, 1900)).toBe(10);
  });

  it("sem hora de envio (mensagem de uma versão antiga) usa a posição como veio", () => {
    expect(expectedVideoTime({ currentTime: 42, isPaused: false }, 99999)).toBe(42);
  });

  it("relógio que voltou para trás não faz o vídeo recuar", () => {
    expect(expectedVideoTime({ currentTime: 10, isPaused: false, sentAt: 5000 }, 4000)).toBe(10);
  });

  it("mensagem velha demais não empurra o vídeo para longe", () => {
    expect(expectedVideoTime({ currentTime: 10, isPaused: false, sentAt: 0 }, 60_000)).toBe(12);
  });

  it("recusa posição que não é número", () => {
    expect(expectedVideoTime({ currentTime: undefined as unknown as number, isPaused: false })).toBeNull();
    expect(expectedVideoTime({ currentTime: NaN, isPaused: false })).toBeNull();
    expect(expectedVideoTime({ currentTime: Infinity, isPaused: false })).toBeNull();
  });
});

function video(over: Partial<Record<"readyState" | "seeking" | "currentTime" | "duration" | "playbackRate", number | boolean>> = {}) {
  return { readyState: 4, seeking: false, currentTime: 10, duration: 200, playbackRate: 1, ...over } as any;
}

const playing = (currentTime: number) => ({ currentTime, isPaused: false });

describe("syncVideoElement — vídeo tocando", () => {
  it("dentro da tolerância: nada muda e a velocidade volta ao normal", () => {
    const el = video({ currentTime: 10, playbackRate: 1.08 });
    expect(syncVideoElement(el, playing(10.02))).toBe("ok");
    expect(el.playbackRate).toBe(1);
    expect(el.currentTime).toBe(10);
  });

  it("imagem atrás do som: acelera um pouco, sem buscar (o caso medido: 0,15–0,3 s)", () => {
    for (const lag of [0.1, 0.15, 0.25, 0.3, 0.45]) {
      const el = video({ currentTime: 10 });
      expect(syncVideoElement(el, playing(10 + lag))).toBe("rate");
      expect(el.playbackRate).toBeCloseTo(1 + CATCH_UP, 5);
      expect(el.currentTime).toBe(10); // nenhum salto visível
    }
  });

  it("imagem adiantada: freia um pouco", () => {
    const el = video({ currentTime: 10.3 });
    expect(syncVideoElement(el, playing(10))).toBe("rate");
    expect(el.playbackRate).toBeCloseTo(1 - CATCH_UP, 5);
  });

  it("erro grande: busca de uma vez e volta à velocidade normal", () => {
    const el = video({ currentTime: 10, playbackRate: 1.08 });
    expect(syncVideoElement(el, playing(10 + HARD_SEEK_S + 0.1))).toBe("seek");
    expect(el.currentTime).toBeCloseTo(10 + HARD_SEEK_S + 0.1, 5);
    expect(el.playbackRate).toBe(1);
  });

  it("busca também para trás", () => {
    const el = video({ currentTime: 100 });
    expect(syncVideoElement(el, playing(20))).toBe("seek");
    expect(el.currentTime).toBe(20);
  });

  it("compensa a idade da mensagem antes de decidir", () => {
    const el = video({ currentTime: 10.3 });
    // Mensagem diz 10,0 mas foi lida há 300 ms: o som está em 10,3 e a imagem já está certa.
    expect(syncVideoElement(el, { currentTime: 10, isPaused: false, sentAt: 1000 }, 1300)).toBe("ok");
    expect(el.playbackRate).toBe(1);
  });

  it("limita a busca à duração do vídeo", () => {
    const el = video({ currentTime: 10, duration: 20 });
    expect(syncVideoElement(el, playing(500))).toBe("seek");
    expect(el.currentTime).toBe(20);
  });

  it("nunca busca antes do início", () => {
    const el = video({ currentTime: 100 });
    expect(syncVideoElement(el, playing(-5))).toBe("seek");
    expect(el.currentTime).toBe(0);
  });

  it("duração ainda desconhecida (NaN) não impede a busca", () => {
    const el = video({ currentTime: 0, duration: NaN });
    expect(syncVideoElement(el, playing(30))).toBe("seek");
    expect(el.currentTime).toBe(30);
  });

  it("convergência: seguir corrigindo em passos de 500 ms zera o erro sem nenhum salto", () => {
    // Imagem 0,25 s atrás; a cada mensagem a janela ajusta a velocidade e a imagem
    // avança na taxa escolhida enquanto o som anda a 1×.
    const el = video({ currentTime: 100 });
    let audio = 100.25;
    let seeks = 0;
    for (let tick = 0; tick < 20; tick++) {
      if (syncVideoElement(el, playing(audio)) === "seek") seeks++;
      el.currentTime += 0.5 * el.playbackRate;
      audio += 0.5;
    }
    expect(seeks).toBe(0);
    expect(Math.abs(audio - el.currentTime)).toBeLessThan(RATE_SYNC_S + 0.04);
    expect(el.playbackRate).toBe(1);
  });
});

describe("syncVideoElement — vídeo parado", () => {
  it("diferença pequena de um quadro parado é ignorada", () => {
    const el = video({ currentTime: 10 });
    expect(syncVideoElement(el, { currentTime: 10.1, isPaused: true })).toBe("ok");
    expect(el.currentTime).toBe(10);
  });

  it("diferença grande vai para a posição exata", () => {
    const el = video({ currentTime: 10 });
    expect(syncVideoElement(el, { currentTime: 10 + PAUSED_SEEK_S + 0.1, isPaused: true })).toBe("seek");
    expect(el.currentTime).toBeCloseTo(10 + PAUSED_SEEK_S + 0.1, 5);
  });

  it("parado nunca fica com a velocidade alterada", () => {
    const el = video({ currentTime: 10, playbackRate: 1.08 });
    syncVideoElement(el, { currentTime: 10, isPaused: true });
    expect(el.playbackRate).toBe(1);
  });

  it("parado, o tempo da mensagem não é 'envelhecido'", () => {
    const el = video({ currentTime: 10 });
    expect(syncVideoElement(el, { currentTime: 10, isPaused: true, sentAt: 0 }, 5000)).toBe("ok");
  });
});

describe("syncVideoElement — quando não mexer", () => {
  it("sem metadados ainda (readyState 0) não faz nada", () => {
    const el = video({ readyState: 0, currentTime: 0 });
    expect(syncVideoElement(el, playing(50))).toBe("skip");
    expect(el.currentTime).toBe(0);
    expect(el.playbackRate).toBe(1);
  });

  it("enquanto busca, espera o quadro chegar em vez de buscar de novo", () => {
    const el = video({ seeking: true, currentTime: 50 });
    expect(syncVideoElement(el, playing(80))).toBe("skip");
    expect(el.currentTime).toBe(50);
  });

  it("posição inválida na mensagem é ignorada", () => {
    const el = video();
    expect(syncVideoElement(el, { currentTime: NaN, isPaused: false })).toBe("skip");
    expect(syncVideoElement(el, { currentTime: undefined as unknown as number, isPaused: false })).toBe("skip");
  });
});

describe("applyVideoState", () => {
  afterEach(() => vi.restoreAllMocks());

  function playbackVideo() {
    return {
      ...video(), src: "https://example.test/video.mp4", paused: false,
      pause: vi.fn(), play: vi.fn(() => Promise.resolve()),
    } as HTMLVideoElement;
  }

  it("aligns the measured 407 ms startup lag once, then uses rate correction", () => {
    const el = playbackVideo();
    const state = { ...playing(10.407), playback_id: "first" };
    expect(applyVideoState(el, state)).toBe("seek");
    expect(el.currentTime).toBeCloseTo(10.407);
    expect(el.playbackRate).toBe(1);

    // The seek has decoded its frame. A subsequent moderate delay must not
    // produce another seek on seeked/canplay or the next periodic broadcast.
    el.currentTime = 10;
    expect(applyVideoState(el, state)).toBe("rate");
    expect(applyVideoState(el, state)).toBe("rate");
    expect(el.currentTime).toBe(10);
    expect(el.playbackRate).toBeCloseTo(1 + CATCH_UP);
    expect(applyVideoState(el, { ...state, currentTime: 11 })).toBe("seek");
  });

  it("keeps one seek for startup lag that develops after an initially close frame", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const el = playbackVideo();
    expect(applyVideoState(el, playing(10.02))).toBe("ok");
    clock.mockReturnValue(250);
    expect(applyVideoState(el, playing(10.1))).toBe("rate");
    clock.mockReturnValue(500);
    expect(applyVideoState(el, playing(10.407))).toBe("seek");
    expect(el.currentTime).toBeCloseTo(10.407);
    el.currentTime = 10;
    clock.mockReturnValue(1000);
    expect(applyVideoState(el, playing(10.407))).toBe("rate");
    expect(applyVideoState(el, playing(10.407))).toBe("rate");
    expect(el.currentTime).toBe(10);
  });

  it.each([2000, 2001])("expires the unused startup seek at %i ms", (elapsed) => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const el = playbackVideo();
    expect(applyVideoState(el, playing(10.02))).toBe("ok");
    clock.mockReturnValue(elapsed);
    expect(applyVideoState(el, playing(10.407))).toBe("rate");
    expect(el.currentTime).toBe(10);
  });

  it("does not extend or restart the startup window after pause, buffering or seeking", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const el = playbackVideo();
    expect(applyVideoState(el, playing(10.02))).toBe("ok");
    clock.mockReturnValue(1000);
    expect(applyVideoState(el, { currentTime: 10, isPaused: true })).toBe("ok");
    Object.defineProperty(el, "readyState", { value: 2, configurable: true });
    expect(applyVideoState(el, playing(10.1))).toBe("rate");
    clock.mockReturnValue(1900);
    Object.defineProperty(el, "readyState", { value: 4, configurable: true });
    Object.defineProperty(el, "seeking", { value: true, configurable: true });
    expect(applyVideoState(el, playing(10.407))).toBe("skip");
    clock.mockReturnValue(2001);
    Object.defineProperty(el, "seeking", { value: false, configurable: true });
    expect(applyVideoState(el, playing(10.407))).toBe("rate");
    clock.mockReturnValue(5000);
    expect(applyVideoState(el, { currentTime: 10, isPaused: true })).toBe("ok");
    expect(applyVideoState(el, playing(10.407))).toBe("rate");
    expect(el.currentTime).toBe(10);
  });

  it("resets alignment for a new playback identity, source, or video element", () => {
    const el = playbackVideo();
    const state = { ...playing(10.407), playback_id: "first" };
    expect(applyVideoState(el, state)).toBe("seek");
    el.currentTime = 10;
    expect(applyVideoState(el, state)).toBe("rate");
    expect(applyVideoState(el, { ...state, playback_id: "second" })).toBe("seek");
    el.currentTime = 10;
    el.src = "https://example.test/other.mp4";
    expect(applyVideoState(el, { ...state, playback_id: "second" })).toBe("seek");
    expect(applyVideoState(playbackVideo(), state)).toBe("seek");
  });

  it("keeps initial alignment pending through metadata, buffering and seeking", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const el = playbackVideo();
    const state = playing(10.407);
    for (const readyState of [0, 1, 2]) {
      Object.defineProperty(el, "readyState", { value: readyState, configurable: true });
      expect(applyVideoState(el, state)).toBe(readyState === 0 ? "skip" : "rate");
    }
    Object.defineProperty(el, "readyState", { value: 4, configurable: true });
    Object.defineProperty(el, "seeking", { value: true, configurable: true });
    expect(applyVideoState(el, state)).toBe("skip");
    clock.mockReturnValue(5000);
    Object.defineProperty(el, "seeking", { value: false, configurable: true });
    expect(applyVideoState(el, state)).toBe("seek");
  });

  it("does not consume startup alignment on paused or invalid states", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const el = playbackVideo();
    expect(applyVideoState(el, { currentTime: 10, isPaused: true })).toBe("ok");
    expect(applyVideoState(el, playing(NaN))).toBe("skip");
    clock.mockReturnValue(5000);
    expect(applyVideoState(el, playing(10.407))).toBe("seek");
  });

  it("mantém pausado e alinha a posição quando uma busca termina", () => {
    const fake = {
      readyState: 4,
      seeking: true,
      currentTime: 8,
      duration: 200,
      playbackRate: 1,
      paused: false,
      pause: vi.fn(() => { fake.paused = true; }),
      play: vi.fn(() => { fake.paused = false; return Promise.resolve(); }),
    };
    const el = fake as unknown as HTMLVideoElement;

    expect(applyVideoState(el, { currentTime: 150, isPaused: true })).toBe("skip");
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(8);
    expect(el.play).not.toHaveBeenCalled();

    // O browser conclui a busca assíncrona; reaplicar o último estado não dá play.
    fake.seeking = false;
    expect(applyVideoState(el, { currentTime: 150, isPaused: true })).toBe("seek");
    expect(el.currentTime).toBe(150);
    expect(applyVideoState(el, { currentTime: 150, isPaused: true })).toBe("ok");
    expect(el.paused).toBe(true);
    expect(el.play).not.toHaveBeenCalled();
  });

  it("retoma um vídeo pausado se o estado mais recente for tocando", () => {
    const fake = {
      readyState: 4,
      seeking: false,
      currentTime: 10,
      duration: 200,
      playbackRate: 1,
      paused: true,
      pause: vi.fn(() => { fake.paused = true; }),
      play: vi.fn(() => { fake.paused = false; return Promise.resolve(); }),
    };
    const el = fake as unknown as HTMLVideoElement;

    applyVideoState(el, { currentTime: 10, isPaused: false });
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.paused).toBe(false);
  });
});

describe("constantes", () => {
  it("o ajuste de velocidade é imperceptível e a busca só serve para erros grandes", () => {
    expect(CATCH_UP).toBeLessThanOrEqual(0.1);
    expect(RATE_SYNC_S).toBeLessThan(HARD_SEEK_S);
    expect(HARD_SEEK_S).toBeLessThanOrEqual(0.6);
  });
});
