import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { TooltipProvider } from "reka-ui";
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
    const parado = mountUi(LjButton, { props: { icon: "plus" } });
    expect(parado.find(".lj-spinner").exists()).toBe(false);

    const carregando = mountUi(LjButton, { props: { icon: "plus", loading: true } });
    expect(carregando.find(".lj-spinner").exists()).toBe(true);
  });

  it("icon-only não renderiza rótulo — o nome acessível vem de fora", () => {
    const w = mountUi(LjButton, {
      props: { icon: "pencil", iconOnly: true, "aria-label": "Editar" },
      slots: { default: "Editar" },
    });
    expect(w.find(".lj-btn__label").exists()).toBe(false);
    expect(w.attributes("aria-label")).toBe("Editar");
  });

  it("title em botão só-ícone vira tooltip do design system, não o do sistema", () => {
    // O tooltip do Reka exige o provider único que a shell monta na raiz.
    const host = defineComponent({
      components: { TooltipProvider, LjButton },
      template: `<TooltipProvider><LjButton icon="pencil" icon-only title="Editar" /></TooltipProvider>`,
    });
    const btn = mountUi(host).find("button");

    // O nativo apareceria empilhado com o do design system — e só depois de um
    // segundo parado, tarde demais para quem opera ao vivo.
    expect(btn.attributes("title")).toBeUndefined();
    expect(btn.attributes("aria-label")).toBe("Editar");
  });

  it("botão com rótulo visível mantém o title nativo — o texto já diz o que faz", () => {
    const w = mountUi(LjButton, {
      slots: { default: "Salvar" },
      attrs: { title: "Salva e fecha" },
    });
    expect(w.attributes("title")).toBe("Salva e fecha");
    expect(w.findComponent({ name: "LjTooltip" }).exists()).toBe(false);
  });

  it("cobre todas as variantes anunciadas", () => {
    for (const variant of ["default", "primary", "ghost", "danger", "subtle"] as const) {
      expect(mountUi(LjButton, { props: { variant } }).classes()).toContain(`lj-btn--${variant}`);
    }
  });
});

describe("LjButton — tamanho de toque", () => {
  it("aceita o tamanho touch, para superfícies operadas com o dedo", () => {
    // Existe porque o controle remoto roda no celular: 32px (lg) é alvo curto
    // demais para o dedo. Na shell continua sm/md/lg.
    expect(mountUi(LjButton, { props: { size: "touch" } }).classes()).toContain("lj-ui-size-touch");
  });
});
