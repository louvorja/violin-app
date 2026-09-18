import { describe, it, expect } from "vitest";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import SelectFont from "@/components/inputs/SelectFont.vue";
import { FONT } from "@/config/Fonts";

/**
 * O id tem de chegar ao <button role="combobox"> lá dentro.
 *
 * Enquanto não era prop declarada, ele caía em $attrs e pousava na <div>
 * invólucro — que não é elemento rotulável. Os cinco `<label for>` da tela de
 * Opções apontavam para essa div: clicar no rótulo não focava nada e o campo
 * ficava sem nome acessível, sem nada acusar.
 */
describe("SelectFont", () => {
  it("repassa o id ao gatilho, não ao invólucro", () => {
    const w = mountUi(SelectFont, { props: { id: "opt-font" } });
    const gatilho = w.get('[role="combobox"]');
    expect(gatilho.attributes("id")).toBe("opt-font");
    expect(w.get(".select-font").attributes("id")).toBeUndefined();
  });

  it("o gatilho é elemento rotulável", () => {
    const w = mountUi(SelectFont, { props: { id: "opt-font" } });
    expect(w.get("#opt-font").element.tagName).toBe("BUTTON");
  });

  it("mantém o valor fechado na fonte da interface", () => {
    const w = mountUi(SelectFont, {
      props: { id: "opt-font", modelValue: "DINCondensedBold" },
    });

    const value = w.get(".select-font__value");
    expect(value.text()).toBe("DIN Condensed Bold");
    expect(value.attributes("style")).toBeUndefined();
  });

  it("exibe o fallback como Padrão quando ainda não há escolha salva", () => {
    const w = mountUi(SelectFont, {
      props: { id: "opt-font", modelValue: FONT.UI.FALLBACK, defaultFont: FONT.UI.FALLBACK },
    });

    expect(w.get(".select-font__value").text()).toBe("Padrão");
  });

  it("mantém o nome da fonte de projeção quando ela é concreta", () => {
    const w = mountUi(SelectFont, {
      props: {
        id: "opt-projection-font",
        modelValue: FONT.PROJECTION.FALLBACK,
        defaultFont: FONT.PROJECTION.FALLBACK,
      },
    });

    expect(w.get(".select-font__value").text()).toBe("DIN Condensed Bold");
  });
});
