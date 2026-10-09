import { describe, expect, it } from "vitest";
import { ICONS } from "@/config/Icons";
import { categoryIconSvg } from "../CategoryTile";

describe("categoryIconSvg — toda categoria tem SVG", () => {
  it("cobre todos os nomes de ICONS.CATEGORY", async () => {
    const nomes = Object.values(ICONS.CATEGORY);
    expect(nomes.length).toBeGreaterThan(0);
    for (const nome of nomes) {
      const svg = await categoryIconSvg(nome);
      expect(svg, `falta SVG para "${nome}"`).toBeTruthy();
    }
  });

  it("devolve null para nome desconhecido ou vazio", async () => {
    expect(await categoryIconSvg("nao-existe")).toBeNull();
    expect(await categoryIconSvg(undefined)).toBeNull();
    expect(await categoryIconSvg("")).toBeNull();
  });

  it("renderiza os ícones tabler em branco (o tile pinta sobre a cor)", async () => {
    // O branco vem da prop color: dentro de um <img> o currentColor resolveria
    // para preto. outline pinta por stroke, filled por fill — e a variante é a
    // mesma que o TABLER_ICONS entrega para o desktop (ex.: "bolt" é outline).
    expect(await categoryIconSvg("music-plus")).toContain('stroke="#ffffff"');
    expect(await categoryIconSvg("bolt")).toContain('stroke="#ffffff"');
    // Nem todo nome tem SVG no pacote do tabler — vem do TABLER_ICONS.
    expect(await categoryIconSvg("alert-triangle-filled")).toContain('fill="#ffffff"');
    // A marca "ja" não é tabler e mantém as cores do arquivo.
    expect(await categoryIconSvg("ja")).toBeTruthy();
  });
});
