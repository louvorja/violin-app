import { describe, it, expect } from "vitest";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import SelectFont from "@/components/inputs/SelectFont.vue";

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
});
