import { describe, expect, it } from "vitest";
import LjButton from "../LjButton.vue";
import { mountUi } from "./mountUi";

describe("LjButton", () => {
  it("renderiza um <button> real, não uma div clicável", () => {
    const w = mountUi(LjButton, { slots: { default: "Salvar" } });
    expect(w.element.tagName).toBe("BUTTON");
    expect(w.attributes("type")).toBe("button");
  });

  it("aplica a classe de tamanho do contrato", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const w = mountUi(LjButton, { props: { size } });
      expect(w.classes()).toContain(`lj-ui-size-${size}`);
    }
  });

  it("usa md quando o tamanho não é informado", () => {
    expect(mountUi(LjButton).classes()).toContain("lj-ui-size-md");
  });

  it("emite click e não emite quando desabilitado", async () => {
    const w = mountUi(LjButton);
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);

    const d = mountUi(LjButton, { props: { disabled: true } });
    expect(d.attributes("disabled")).toBeDefined();
  });

  it("carregando bloqueia o clique e anuncia aria-busy", () => {
    const w = mountUi(LjButton, { props: { loading: true } });
    expect(w.attributes("disabled")).toBeDefined();
    expect(w.attributes("aria-busy")).toBe("true");
  });

  it("troca o ícone pelo spinner enquanto carrega", () => {
    const parado = mountUi(LjButton, { props: { icon: "mdi-plus" } });
    expect(parado.find(".lj-spinner").exists()).toBe(false);

    const carregando = mountUi(LjButton, { props: { icon: "mdi-plus", loading: true } });
    expect(carregando.find(".lj-spinner").exists()).toBe(true);
  });

  it("icon-only não renderiza rótulo — o nome acessível vem de fora", () => {
    const w = mountUi(LjButton, {
      props: { icon: "mdi-pencil", iconOnly: true, "aria-label": "Editar" },
      slots: { default: "Editar" },
    });
    expect(w.find(".lj-btn__label").exists()).toBe(false);
    expect(w.attributes("aria-label")).toBe("Editar");
  });

  it("cobre todas as variantes anunciadas", () => {
    for (const variant of ["default", "primary", "ghost", "danger", "subtle"] as const) {
      expect(mountUi(LjButton, { props: { variant } }).classes()).toContain(`lj-btn--${variant}`);
    }
  });
});
