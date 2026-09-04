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
  const rect = { x: 1920, y: 0, width: 1920, height: 1080 };

  function fakeWindow(screenX: number, screenY: number) {
    return {
      closed: false,
      screenX,
      screenY,
      outerWidth: 1280,
      outerHeight: 720,
      moveTo: vi.fn(),
      resizeTo: vi.fn(),
    } as unknown as Window & { moveTo: ReturnType<typeof vi.fn> };
  }

  it("corrige quando o navegador abriu na tela errada", async () => {
    vi.useFakeTimers();
    const win = fakeWindow(0, 0) as never as Window & { moveTo: ReturnType<typeof vi.fn> };
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(20);
    expect(win.moveTo).toHaveBeenCalledWith(1920, 0);
    vi.useRealTimers();
  });

  it("não mexe na janela que já está na tela certa", () => {
    vi.useFakeTimers();
    const win = fakeWindow(2000, 100) as never as Window & { moveTo: ReturnType<typeof vi.fn> };
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(20);
    expect(win.moveTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ignora janela já fechada", () => {
    vi.useFakeTimers();
    const win = fakeWindow(0, 0) as never as Window & { moveTo: ReturnType<typeof vi.fn> };
    (win as unknown as { closed: boolean }).closed = true;
    nudgeIntoRect(win, rect, 10);
    vi.advanceTimersByTime(20);
    expect(win.moveTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("não faz nada sem janela ou sem geometria", () => {
    expect(() => nudgeIntoRect(null, rect)).not.toThrow();
    expect(() => nudgeIntoRect(fakeWindow(0, 0), null)).not.toThrow();
  });
});
