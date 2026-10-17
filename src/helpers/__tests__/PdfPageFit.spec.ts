import { describe, expect, it } from "vitest";
import { pdfPageFit } from "@/helpers/PdfPageFit";

const PAGINA = { pageWidth: 1920, pageHeight: 1080 };

describe("pdfPageFit", () => {
  it("em tela cheia 1:1 o canvas é exatamente a página", () => {
    const fit = pdfPageFit({
      ...PAGINA,
      parentWidth: 1920,
      parentHeight: 1080,
      devicePixelRatio: 1,
    });

    expect(fit).toEqual({
      scale: 1,
      pixelWidth: 1920,
      pixelHeight: 1080,
      cssWidth: 1920,
      cssHeight: 1080,
    });
  });

  it("encaixa preservando a proporção (página retrato num palco paisagem)", () => {
    const fit = pdfPageFit({
      pageWidth: 595,
      pageHeight: 842,
      parentWidth: 1920,
      parentHeight: 1080,
      devicePixelRatio: 1,
    });

    expect(fit).not.toBeNull();
    /* Altura manda: 842 × 1,28… = 1080. */
    expect(fit!.cssHeight).toBe(1080);
    expect(fit!.cssWidth).toBeLessThan(1920);
    /* Não estoura o palco. */
    expect(fit!.cssWidth).toBeLessThanOrEqual(1920);
  });

  it("em telão 2× o backing store dobra e o CSS fica igual", () => {
    const um = pdfPageFit({ ...PAGINA, parentWidth: 1920, parentHeight: 1080, devicePixelRatio: 1 })!;
    const dois = pdfPageFit({ ...PAGINA, parentWidth: 1920, parentHeight: 1080, devicePixelRatio: 2 })!;

    expect(dois.pixelWidth).toBe(um.pixelWidth * 2);
    expect(dois.pixelHeight).toBe(um.pixelHeight * 2);
    expect(dois.cssWidth).toBe(um.cssWidth);
    expect(dois.cssHeight).toBe(um.cssHeight);
    expect(dois.scale).toBe(um.scale * 2);
  });

  it("escala do Windows (1,25 / 1,5) também amplia o desenho", () => {
    const fit = pdfPageFit({ ...PAGINA, parentWidth: 1920, parentHeight: 1080, devicePixelRatio: 1.5 })!;

    expect(fit.pixelWidth).toBe(2880);
    expect(fit.cssWidth).toBe(1920);
  });

  it("devicePixelRatio ausente ou inválido não derruba o cálculo", () => {
    const semDpr = pdfPageFit({ ...PAGINA, parentWidth: 800, parentHeight: 600 });
    const dprZero = pdfPageFit({
      ...PAGINA,
      parentWidth: 800,
      parentHeight: 600,
      devicePixelRatio: 0,
    });

    expect(semDpr).not.toBeNull();
    expect(dprZero).toEqual(semDpr);
    expect(semDpr!.pixelWidth).toBe(semDpr!.cssWidth);
  });

  it("palco não medido → null, para não pintar viewport de zero", () => {
    expect(pdfPageFit({ ...PAGINA, parentWidth: 0, parentHeight: 1080 })).toBeNull();
    expect(pdfPageFit({ ...PAGINA, parentWidth: 1920, parentHeight: 0 })).toBeNull();
    expect(pdfPageFit({ ...PAGINA, parentWidth: NaN, parentHeight: 1080 })).toBeNull();
  });

  it("página sem medida → null", () => {
    expect(
      pdfPageFit({ pageWidth: 0, pageHeight: 1080, parentWidth: 1920, parentHeight: 1080 })
    ).toBeNull();
  });

  it("o backing store nunca chega a 0 (mesmo palco minúsculo)", () => {
    const fit = pdfPageFit({
      pageWidth: 1920,
      pageHeight: 1080,
      parentWidth: 2,
      parentHeight: 1,
      devicePixelRatio: 1,
    })!;

    expect(fit.pixelWidth).toBeGreaterThanOrEqual(1);
    expect(fit.pixelHeight).toBeGreaterThanOrEqual(1);
    expect(fit.cssWidth).toBeGreaterThanOrEqual(1);
    expect(fit.cssHeight).toBeGreaterThanOrEqual(1);
  });
});
