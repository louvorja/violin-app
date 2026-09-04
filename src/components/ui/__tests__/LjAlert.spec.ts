import { describe, expect, it } from "vitest";
import LjAlert from "../LjAlert.vue";
import { expectKeyExists, mountUi } from "./mountUi";

describe("LjAlert", () => {
  it("mostra o texto pela prop ou pelo slot", () => {
    expect(mountUi(LjAlert, { props: { text: "Sem conexão" } }).text()).toContain("Sem conexão");
    expect(mountUi(LjAlert, { slots: { default: "Conteúdo rico" } }).text()).toContain(
      "Conteúdo rico"
    );
  });

  it("título aparece só quando informado", () => {
    expect(
      mountUi(LjAlert, { props: { text: "x" } })
        .find(".lj-alert__title")
        .exists()
    ).toBe(false);
    expect(
      mountUi(LjAlert, { props: { title: "Atenção", text: "x" } })
        .get(".lj-alert__title")
        .text()
    ).toBe("Atenção");
  });

  it("erro é anunciado como alerta; o resto, como status", () => {
    expect(mountUi(LjAlert, { props: { variant: "danger" } }).attributes("role")).toBe("alert");
    for (const variant of ["info", "success", "warning"] as const) {
      expect(mountUi(LjAlert, { props: { variant } }).attributes("role")).toBe("status");
    }
  });

  it("aplica a classe da variante", () => {
    for (const variant of ["info", "success", "warning", "danger"] as const) {
      expect(mountUi(LjAlert, { props: { variant } }).classes()).toContain(`lj-alert--${variant}`);
    }
  });

  it("usa info quando a variante não é informada", () => {
    expect(mountUi(LjAlert).classes()).toContain("lj-alert--info");
  });

  it("icon false remove o ícone; string própria substitui o padrão", () => {
    expect(
      mountUi(LjAlert, { props: { icon: false } })
        .find(".lj-alert__icon")
        .exists()
    ).toBe(false);
    expect(
      mountUi(LjAlert, { props: { text: "x" } })
        .find(".lj-alert__icon")
        .exists()
    ).toBe(true);
  });

  it("botão de dispensar só existe quando pedido, e emite o evento", async () => {
    expect(mountUi(LjAlert).find(".lj-alert__close").exists()).toBe(false);

    const w = mountUi(LjAlert, { props: { dismissible: true } });
    await w.get(".lj-alert__close").trigger("click");
    expect(w.emitted("dismiss")).toHaveLength(1);
  });

  it("nomeia o botão de dispensar nos dois idiomas", () => {
    expectKeyExists("actions.close");
    expect(
      mountUi(LjAlert, { props: { dismissible: true } })
        .get(".lj-alert__close")
        .attributes("aria-label")
    ).toBe("Fechar");
    expect(
      mountUi(LjAlert, { props: { dismissible: true } }, "es")
        .get(".lj-alert__close")
        .attributes("aria-label")
    ).toBe("Cerrar");
  });
});
