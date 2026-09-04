import { describe, expect, it } from "vitest";
import LjDivider from "../LjDivider.vue";
import { mountUi } from "./mountUi";

describe("LjDivider", () => {
  it("é um <hr> na horizontal e um <span> na vertical", () => {
    expect(mountUi(LjDivider).element.tagName).toBe("HR");
    expect(mountUi(LjDivider, { props: { vertical: true } }).element.tagName).toBe("SPAN");
  });

  it("some da árvore de acessibilidade por padrão", () => {
    // Um leitor de tela não ganha nada anunciando "separador" entre cada par de
    // itens de uma lista — por isso o padrão é decorativo.
    const w = mountUi(LjDivider);
    expect(w.attributes("role")).toBe("presentation");
    expect(w.attributes("aria-hidden")).toBe("true");
  });

  it("vira separador de verdade quando marcado como semântico", () => {
    const w = mountUi(LjDivider, { props: { semantic: true } });
    expect(w.attributes("role")).toBe("separator");
    expect(w.attributes("aria-hidden")).toBeUndefined();
  });

  it("a vertical declara a própria orientação", () => {
    const w = mountUi(LjDivider, { props: { vertical: true, semantic: true } });
    expect(w.attributes("aria-orientation")).toBe("vertical");
    expect(w.classes()).toContain("lj-divider--vertical");
  });

  it("inset recua as pontas", () => {
    expect(mountUi(LjDivider, { props: { inset: true } }).classes()).toContain("lj-divider--inset");
    expect(mountUi(LjDivider).classes()).not.toContain("lj-divider--inset");
  });
});
