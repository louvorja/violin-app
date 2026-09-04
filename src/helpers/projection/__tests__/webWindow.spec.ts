import { describe, expect, it, vi } from "vitest";
import {
  WEB_WINDOW_FEATURES,
  featuresForRect,
  nudgeIntoRect,
} from "@/helpers/projection/webWindow";

describe("featuresForRect", () => {
  it("posiciona a janela na tela pedida", () => {
    const features = featuresForRect({ x: 1920, y: 0, width: 1920, height: 1080 });
    expect(features).toContain("left=1920");
    expect(features).toContain("top=0");
    expect(features).toContain("width=1920");
    expect(features).toContain("height=1080");
  });

  it("aceita coordenadas negativas", () => {
    // Monitor à esquerda (ou acima) do principal tem origem negativa; fazer
    // clamp em zero jogaria a projeção de volta na tela do operador.
    const features = featuresForRect({ x: -1920, y: -200, width: 1920, height: 1080 });
    expect(features).toContain("left=-1920");
    expect(features).toContain("top=-200");
  });

  it("arredonda valores fracionários", () => {
    // Telas com densidade fracionária produzem coordenadas quebradas, que o
    // navegador rejeita.
    const features = featuresForRect({ x: 1706.66, y: 0.5, width: 1280.4, height: 720.6 });
    expect(features).toContain("left=1707");
    expect(features).toContain("top=1");
    expect(features).toContain("width=1280");
    expect(features).toContain("height=721");
  });

  it("sem geometria, deixa o navegador decidir", () => {
    expect(featuresForRect(null)).toBe(WEB_WINDOW_FEATURES);
  });

  it("nunca inclui noopener, que anularia o handle da janela", () => {
    // Com noopener o window.open devolve null e close()/isOpen() param de funcionar.
    expect(featuresForRect({ x: 0, y: 0, width: 800, height: 600 })).not.toContain("noopener");
    expect(WEB_WINDOW_FEATURES).not.toContain("noopener");
  });
});

describe("nudgeIntoRect", () => {
  const rect = { x: 1920, y: 0, width: 1920, height: 1050 };

  function fakeWindow(over: Record<string, unknown> = {}) {
    return {
      closed: false,
      screenX: 0,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 720,
      moveTo: vi.fn(),
      resizeTo: vi.fn(),
      ...over,
    } as unknown as Window & {
      moveTo: ReturnType<typeof vi.fn>;
      resizeTo: ReturnType<typeof vi.fn>;
    };
  }

  it("move e redimensiona para preencher o monitor", () => {
    // A janela precisa OCUPAR a tela, não só estar dentro dela: no navegador
    // não há tela cheia automática, então preencher o monitor é o que mais se
    // aproxima de uma projeção limpa.
    vi.useFakeTimers();
    const win = fakeWindow();
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(600);
    expect(win.moveTo).toHaveBeenCalledWith(1920, 0);
    expect(win.resizeTo).toHaveBeenCalledWith(1920, 1050);
    vi.useRealTimers();
  });

  it("não mexe na janela que já preenche o monitor", () => {
    vi.useFakeTimers();
    const win = fakeWindow({ screenX: 1920, screenY: 0, outerWidth: 1920, outerHeight: 1050 });
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(600);
    expect(win.moveTo).not.toHaveBeenCalled();
    expect(win.resizeTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("corrige o tamanho mesmo se a posição já estiver certa", () => {
    vi.useFakeTimers();
    const win = fakeWindow({ screenX: 1920, screenY: 0, outerWidth: 1686, outerHeight: 1050 });
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(600);
    expect(win.resizeTo).toHaveBeenCalledWith(1920, 1050);
    vi.useRealTimers();
  });

  it("tolera diferença de poucos pixels", () => {
    // Bordas do gerenciador de janelas causam desvios de 1-2px; insistir aí
    // vira cabo de guerra com o sistema.
    vi.useFakeTimers();
    const win = fakeWindow({ screenX: 1921, screenY: 1, outerWidth: 1919, outerHeight: 1049 });
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(600);
    expect(win.moveTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ignora janela já fechada", () => {
    vi.useFakeTimers();
    const win = fakeWindow({ closed: true });
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(600);
    expect(win.moveTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("não faz nada sem janela ou sem geometria", () => {
    expect(() => nudgeIntoRect(null, rect)).not.toThrow();
    expect(() => nudgeIntoRect(fakeWindow(), null)).not.toThrow();
  });
});
