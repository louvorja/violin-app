import { describe, expect, it } from "vitest";
import { corComAlfa, larguraDeBorda, raioDeBorda } from "@/helpers/ColorAlpha";

/**
 * Cor + transparência é o par do painel de formatação: o `<input type="color">`
 * só devolve `#RRGGBB`, então a transparência chega em outro controle (0–100).
 */
describe("corComAlfa", () => {
  it("aplica a opacidade sobre um hex de 6 dígitos", () => {
    expect(corComAlfa("#000000", 50)).toBe("rgba(0, 0, 0, 0.5)");
    expect(corComAlfa("#FFFFFF", 100)).toBe("rgba(255, 255, 255, 1)");
    expect(corComAlfa("#1A2B3C", 0)).toBe("rgba(26, 43, 60, 0)");
  });

  it("entende o hex curto", () => {
    expect(corComAlfa("#fff", 50)).toBe("rgba(255, 255, 255, 0.5)");
    expect(corComAlfa("#000", 0)).toBe("rgba(0, 0, 0, 0)");
  });

  it("multiplica o alfa que a cor já tinha", () => {
    /* Uma cor semitransparente não pode ficar mais opaca que estava. */
    expect(corComAlfa("#00000080", 50)).toBe("rgba(0, 0, 0, 0.251)");
    expect(corComAlfa("rgba(10, 20, 30, 0.8)", 50)).toBe("rgba(10, 20, 30, 0.4)");
  });

  it("aceita rgb(), rgba() e porcentagem", () => {
    expect(corComAlfa("rgb(1, 2, 3)", 100)).toBe("rgba(1, 2, 3, 1)");
    expect(corComAlfa("rgba(0,0,0,0.5)", 100)).toBe("rgba(0, 0, 0, 0.5)");
    expect(corComAlfa("rgb(100%, 0%, 50%)", 100)).toBe("rgba(255, 0, 128, 1)");
  });

  it("preserva transparent e vazio", () => {
    expect(corComAlfa("transparent", 100)).toBe("transparent");
    expect(corComAlfa("", 50)).toBe("transparent");
    expect(corComAlfa(null, 50)).toBe("transparent");
    expect(corComAlfa(undefined, 50)).toBe("transparent");
  });

  it("cor irreconhecível volta como veio, nunca vira undefined", () => {
    /* Um valor inválido não pode desaparecer do estilo da tela. */
    expect(corComAlfa("var(--lj-algo)", 50)).toBe("var(--lj-algo)");
    expect(corComAlfa("#12345", 50)).toBe("#12345");
  });

  it("opacidade fora da faixa é limitada, e número quebrado vale 100", () => {
    expect(corComAlfa("#000000", 150)).toBe("rgba(0, 0, 0, 1)");
    expect(corComAlfa("#000000", -20)).toBe("rgba(0, 0, 0, 0)");
    expect(corComAlfa("#000000", Number.NaN)).toBe("rgba(0, 0, 0, 1)");
  });
});

describe("medidas de borda", () => {
  it("largura fica entre 0 e 20", () => {
    expect(larguraDeBorda(2)).toBe(2);
    expect(larguraDeBorda(0)).toBe(0);
    expect(larguraDeBorda(999)).toBe(20);
    expect(larguraDeBorda(Number.NaN)).toBe(2);
  });

  it("raio fica entre 0 e 50", () => {
    expect(raioDeBorda(12)).toBe(12);
    expect(raioDeBorda(-5)).toBe(0);
    expect(raioDeBorda(999)).toBe(50);
    expect(raioDeBorda(undefined as unknown as number)).toBe(0);
  });
});
