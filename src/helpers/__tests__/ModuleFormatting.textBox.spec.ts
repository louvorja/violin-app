import { describe, expect, it } from "vitest";
import { textBoxStyle, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";

/**
 * A "caixa de texto" dos módulos utilitários — fundo com alfa e borda.
 *
 * É o MESMO objeto no programa (`useModuleBodyStyle`) e na projeção
 * (`ModuleProjectionLayer`): se os dois divergirem, o mesmo módulo aparece
 * diferente no telão e no preview.
 */
describe("textBoxStyle", () => {
  it("sem o fundo ligado, nada aparece — nem fundo, nem borda", () => {
    const estilo = textBoxStyle({});
    expect(estilo.backgroundColor).toBe("transparent");
    expect(estilo.border).toBeUndefined();
  });

  it("o fundo usa cor e transparência juntas", () => {
    expect(textBoxStyle({ enabled: true, color: "#000000", opacity: 50 }).backgroundColor).toBe(
      "rgba(0, 0, 0, 0.5)"
    );
  });

  it("com a borda ligada, entra cor, transparência, raio e espessura", () => {
    const estilo = textBoxStyle({
      enabled: true,
      color: "#000000",
      opacity: 60,
      borderEnabled: true,
      borderColor: "#FFFFFF",
      borderOpacity: 40,
      borderRadius: 12,
      borderWidth: 3,
    });

    expect(estilo.border).toBe("3px solid rgba(255, 255, 255, 0.4)");
    expect(estilo.borderRadius).toBe("12px");
    expect(estilo.boxSizing).toBe("border-box");
  });

  it("borda desligada não deixa resto de raio", () => {
    const estilo = textBoxStyle({
      enabled: true,
      color: "#000000",
      borderEnabled: false,
      borderRadius: 20,
    });

    expect(estilo.border).toBeUndefined();
    expect(estilo.borderRadius).toBeUndefined();
  });

  it("borda só vale com o fundo ligado", () => {
    /* Fundo desligado = nada desenhado; a borda é parte da mesma caixa. */
    const estilo = textBoxStyle({ enabled: false, borderEnabled: true, borderColor: "#FFF" });
    expect(estilo.border).toBeUndefined();
  });

  it("raio 0 não vira 'border-radius: 0px' inútil", () => {
    const estilo = textBoxStyle({
      enabled: true,
      color: "#000",
      borderEnabled: true,
      borderRadius: 0,
    });
    expect(estilo.borderRadius).toBeUndefined();
  });
});

describe("manifestos com o contrato do fundo do texto", () => {
  const MODULOS = ["timer", "timer_worship", "stopwatch", "clock"] as const;
  const ESPERADOS: Array<[string, unknown]> = [
    ["text_background_enabled", false],
    ["text_background_color", "transparent"],
    ["text_background_opacity", 100],
    ["text_border_enabled", false],
    ["text_border_color", "#FFFFFF"],
    ["text_border_opacity", 100],
    ["text_border_radius", 0],
    ["text_border_width", 2],
  ];

  for (const modulo of MODULOS) {
    it(`${modulo} declara as chaves com padrões neutros`, () => {
      for (const [chave, esperado] of ESPERADOS) {
        expect(moduleCustomizationDefault(modulo, chave, undefined), `${modulo}.${chave}`).toBe(
          esperado
        );
      }
    });
  }
});
