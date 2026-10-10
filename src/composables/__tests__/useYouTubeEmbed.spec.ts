import { describe, expect, it } from "vitest";
import { outranks } from "@/composables/useYouTubeEmbed";

describe("quem manda no relógio do vídeo embutido", () => {
  it("a projeção (sem papel) manda em todos, inclusive na janela principal", () => {
    expect(outranks(undefined, "main")).toBe(true);
    expect(outranks(undefined, "return")).toBe(true);
    expect(outranks(undefined, "operator")).toBe(true);
  });

  it("sem projeção, a janela principal manda no retorno e no operador, não em si mesma", () => {
    expect(outranks("main", "return")).toBe(true);
    expect(outranks("main", "operator")).toBe(true);
    expect(outranks("main", "main")).toBe(false);
  });

  it("retorno e operador nunca mandam em ninguém", () => {
    for (const mine of ["main", "return", "operator"] as const) {
      expect(outranks("return", mine)).toBe(false);
      expect(outranks("operator", mine)).toBe(false);
    }
  });
});
