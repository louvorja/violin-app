import { describe, expect, it } from "vitest";
import { clampTextScale, TEXT_SCALE } from "../useScreenTextScale";

describe("clampTextScale", () => {
  it("anda de 5 em 5 e fica entre 50% e 200%", () => {
    expect(clampTextScale(112)).toBe(110);
    expect(clampTextScale(20)).toBe(TEXT_SCALE.MIN);
    expect(clampTextScale(500)).toBe(TEXT_SCALE.MAX);
  });

  it("valor estragado volta ao padrão", () => {
    expect(clampTextScale(Number.NaN)).toBe(TEXT_SCALE.DEFAULT);
  });
});
