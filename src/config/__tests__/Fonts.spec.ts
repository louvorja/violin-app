import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONT,
  resolveDefaultFont,
  resolveFont,
} from "@/config/Fonts";

describe("Fonts", () => {
  it("mantém famílias CSS concretas", () => {
    expect(resolveFont("RobotoVariable", FONT.PROJECTION.FALLBACK)).toBe("RobotoVariable");
    expect(resolveDefaultFont("OpenSans", FONT.UI.FALLBACK)).toBe("OpenSans");
  });

  it("resolve Padrão da Interface pela variável global", () => {
    expect(resolveFont(FONT.UI.INHERIT, FONT.PROJECTION.FALLBACK)).toBe(
      `var(${FONT.UI.CSS_VAR}, ${FONT.UI.FALLBACK})`,
    );
    expect(resolveFont("__UI_FONT__", FONT.PROJECTION.FALLBACK)).toBe(
      `var(${FONT.UI.CSS_VAR}, ${FONT.UI.FALLBACK})`,
    );
  });

  it("resolve Padrão da Projecão pela variável global", () => {
    expect(resolveFont(FONT.PROJECTION.INHERIT, FONT.UI.FALLBACK)).toBe(
      `var(${FONT.PROJECTION.CSS_VAR}, ${FONT.PROJECTION.FALLBACK})`,
    );
  });

  it("resolve Padrão local pelo default informado", () => {
    expect(resolveFont(FONT.DEFAULT, "fallback", "LocalDefault")).toBe("LocalDefault");
  });

  it("declara a mesma fonte de interface que o token do CSS", () => {
    // O token pinta o primeiro frame; main.js substitui a variável pelo valor
    // daqui assim que o UserData hidrata. Se as duas listas divergirem, todo
    // boot troca a fonte da interface inteira no meio do caminho — um reflow
    // visível, sem nada no console.
    const css = readFileSync(
      resolve(__dirname, "../../assets/styles/tokens.css"),
      "utf8",
    );
    const declared = css.match(/--lj-font-shell:\s*([^;]+);/);
    expect(declared).not.toBeNull();

    const normalize = (v: string) => v.replace(/\s+/g, " ").trim();
    expect(normalize(declared![1])).toBe(normalize(FONT.UI.FALLBACK));
  });

  it("devolve ao padrão quem tem a stack do sistema gravada", () => {
    // Default de um ciclo de versão, gravado literalmente em options.font pelo
    // seed. Sem reconhecê-lo, quem abriu o app naquele ciclo ficaria presa nele.
    const systemStack =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    expect(resolveDefaultFont(systemStack, FONT.UI.FALLBACK)).toBe(FONT.UI.FALLBACK);
  });

  it("não permite marcadores contextuais nos padrões de Geral", () => {
    expect(resolveDefaultFont(FONT.DEFAULT, FONT.UI.FALLBACK)).toBe(FONT.UI.FALLBACK);
    expect(resolveDefaultFont(FONT.UI.INHERIT, FONT.UI.FALLBACK)).toBe(FONT.UI.FALLBACK);
    expect(resolveDefaultFont(FONT.PROJECTION.INHERIT, FONT.PROJECTION.FALLBACK)).toBe(
      FONT.PROJECTION.FALLBACK,
    );
  });
});
