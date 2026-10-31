// @vitest-environment node
/**
 * Geometria da janela comum (a tela do operador).
 *
 * O estado vem do disco e não é confiável: pode ter sido gravado por outra
 * versão, por um monitor que não existe mais ou com números inválidos. Abrir
 * com lixo de `setBounds` joga a janela para fora da tela — e o operador não
 * tem como trazê-la de volta sem editar arquivo.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizarEstadoJanela, resolverPosicaoJanela } = require("../windowState.js");

const TELA = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const TELA2 = { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } };
const PADRAO = { x: 0, y: 0, width: 800, height: 600 };

describe("normalizarEstadoJanela", () => {
  it("aceita estado bem formado", () => {
    expect(
      normalizarEstadoJanela({ maximized: true, bounds: { x: 10, y: 20, width: 900, height: 700 } })
    ).toEqual({ maximized: true, bounds: { x: 10, y: 20, width: 900, height: 700 } });
  });

  it("recusa lixo, números inválidos e tamanho abaixo do mínimo", () => {
    expect(normalizarEstadoJanela(null)).toBeNull();
    expect(normalizarEstadoJanela("maximized")).toBeNull();
    expect(normalizarEstadoJanela([1, 2, 3])).toBeNull();
    expect(normalizarEstadoJanela({ maximized: false })).toBeNull();
    expect(
      normalizarEstadoJanela({ bounds: { x: 0, y: 0, width: Number.NaN, height: 600 } })
    ).toBeNull();
    expect(normalizarEstadoJanela({ bounds: { x: 0, y: 0, width: 200, height: 150 } })).toBeNull();
  });

  it("maximizado sem bounds continua válido", () => {
    expect(normalizarEstadoJanela({ maximized: true })).toEqual({ maximized: true, bounds: null });
  });
});

describe("resolverPosicaoJanela", () => {
  it("primeira abertura: maximizada, com o padrão como base", () => {
    expect(resolverPosicaoJanela({ estado: null, displayDestino: TELA, displays: [TELA], padrao: PADRAO }))
      .toEqual({ maximized: true, bounds: PADRAO });
  });

  it("maximizada: nasce nos bounds salvos para desmaximizar voltar ao lugar", () => {
    const estado = { maximized: true, bounds: { x: 100, y: 80, width: 1200, height: 800 } };
    expect(resolverPosicaoJanela({ estado, displayDestino: TELA, displays: [TELA], padrao: PADRAO }))
      .toEqual({ maximized: true, bounds: { x: 100, y: 80, width: 1200, height: 800 } });
  });

  it("normal: restaura posição e tamanho na mesma tela", () => {
    const estado = { maximized: false, bounds: { x: 300, y: 200, width: 1000, height: 700 } };
    expect(resolverPosicaoJanela({ estado, displayDestino: TELA, displays: [TELA], padrao: PADRAO }))
      .toEqual({ maximized: false, bounds: { x: 300, y: 200, width: 1000, height: 700 } });
  });

  it("normal no segundo monitor continua no segundo monitor", () => {
    const estado = { maximized: false, bounds: { x: 2100, y: 100, width: 900, height: 700 } };
    expect(
      resolverPosicaoJanela({ estado, displayDestino: TELA, displays: [TELA, TELA2], padrao: PADRAO })
    ).toEqual({ maximized: false, bounds: { x: 2100, y: 100, width: 900, height: 700 } });
  });

  it("monitor sumiu: mantém o tamanho e centraliza na tela de destino", () => {
    const estado = { maximized: false, bounds: { x: 2100, y: 100, width: 900, height: 700 } };
    expect(resolverPosicaoJanela({ estado, displayDestino: TELA, displays: [TELA], padrao: PADRAO }))
      .toEqual({ maximized: false, bounds: { x: 510, y: 170, width: 900, height: 700 } });
  });

  it("tamanho maior que a área útil é cortado", () => {
    const estado = { maximized: false, bounds: { x: 0, y: 0, width: 4000, height: 3000 } };
    expect(resolverPosicaoJanela({ estado, displayDestino: TELA, displays: [TELA], padrao: PADRAO }))
      .toEqual({ maximized: false, bounds: { x: 0, y: 0, width: 1920, height: 1040 } });
  });

  it("estado ilegível cai na primeira abertura (maximizada)", () => {
    expect(
      resolverPosicaoJanela({
        estado: { maximized: false, bounds: { x: "a", y: 0, width: 900, height: 700 } },
        displayDestino: TELA,
        displays: [TELA],
        padrao: PADRAO,
      })
    ).toEqual({ maximized: true, bounds: PADRAO });
  });
});
