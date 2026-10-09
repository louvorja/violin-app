import { describe, expect, it } from "vitest";
import { levelFromPeak } from "../useAudioMeter";

describe("levelFromPeak", () => {
  it("põe o pico na escala de -60 dB a 0 dB", () => {
    expect(levelFromPeak(1)).toBe(1);
    expect(levelFromPeak(0.001)).toBeCloseTo(0); // -60 dB
    expect(levelFromPeak(0.1)).toBeCloseTo(2 / 3); // -20 dB
  });

  it("silêncio, valor inválido e abaixo do piso ficam no zero", () => {
    expect(levelFromPeak(0)).toBe(0);
    expect(levelFromPeak(Number.NaN)).toBe(0);
    expect(levelFromPeak(0.00001)).toBe(0);
  });

  it("acima de 0 dB (clipping) fica no topo", () => {
    expect(levelFromPeak(1.5)).toBe(1);
  });
});
