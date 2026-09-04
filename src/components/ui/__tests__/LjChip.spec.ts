import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import LjChip from "../LjChip.vue";
import { expectKeyExists, mountUi } from "./mountUi";

const VARIANTES = ["neutral", "primary", "success", "warning", "danger"] as const;

describe("LjChip", () => {
  it("é um rótulo, não um controle: renderiza um <span> com o conteúdo do slot", () => {
    const w = mountUi(LjChip, { slots: { default: "ao vivo" } });
    expect(w.element.tagName).toBe("SPAN");
    expect(w.text()).toBe("ao vivo");
  });

  it("aplica a classe de tamanho do contrato", () => {
    for (const size of ["sm", "md"] as const) {
      expect(mountUi(LjChip, { props: { size } }).classes()).toContain(`lj-chip--${size}`);
    }
  });

  it("usa md quando o tamanho não é informado", () => {
    expect(mountUi(LjChip).classes()).toContain("lj-chip--md");
  });

  it("cobre todas as variantes anunciadas", () => {
    for (const variant of VARIANTES) {
      expect(mountUi(LjChip, { props: { variant } }).classes()).toContain(`lj-chip--${variant}`);
    }
  });

  it("usa neutral quando a variante não é informada", () => {
    expect(mountUi(LjChip).classes()).toContain("lj-chip--neutral");
  });

  it("só oferece algo clicável quando é removível", () => {
    expect(mountUi(LjChip, { slots: { default: "fixo" } }).findAll("button")).toHaveLength(0);
    expect(mountUi(LjChip, { props: { removable: true } }).findAll("button")).toHaveLength(1);
  });

  it("o remover é um <button> de verdade e não submete formulário", () => {
    const btn = mountUi(LjChip, { props: { removable: true } }).find("button");
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.attributes("type")).toBe("button");
  });

  it("emite remove uma única vez ao clicar no botão", async () => {
    const w = mountUi(LjChip, { props: { removable: true }, slots: { default: "tag" } });
    await w.find("button").trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
  });

  it("clicar no corpo do chip não remove nada", async () => {
    const w = mountUi(LjChip, { props: { removable: true }, slots: { default: "tag" } });
    await w.trigger("click");
    expect(w.emitted("remove")).toBeUndefined();
  });

  it("o remover se anuncia como Remover em PT e Quitar em ES", () => {
    // Trava o defeito conhecido: o nome acessível vem de components.ui.remove,
    // e some (vira a chave crua) se a chave for renomeada ou removida.
    expectKeyExists("components.ui.remove");

    const pt = mountUi(LjChip, { props: { removable: true } });
    expect(pt.find("button").attributes("aria-label")).toBe("Remover");

    const es = mountUi(LjChip, { props: { removable: true } }, "es");
    expect(es.find("button").attributes("aria-label")).toBe("Quitar");
  });

  it("o botão remover não fica sem nome acessível — não tem texto visível", () => {
    const btn = mountUi(LjChip, { props: { removable: true } }).find("button");
    expect(btn.text()).toBe("");
    expect(btn.attributes("aria-label")).toBeTruthy();
  });

  it("mostra o ícone sem engolir o rótulo", () => {
    const comIcone = mountUi(LjChip, {
      props: { icon: "mdi-music" },
      slots: { default: "áudio" },
    });
    expect(comIcone.find(".lj-icon").exists()).toBe(true);
    expect(comIcone.text()).toContain("áudio");

    const semIcone = mountUi(LjChip, { slots: { default: "áudio" } });
    expect(semIcone.find(".lj-icon").exists()).toBe(false);
  });

  it("repassa atributos do consumidor ao chip", () => {
    const w = mountUi(LjChip, {
      attrs: { title: "Coletânea baixada", "data-testid": "chip-status" },
      slots: { default: "baixada" },
    });
    expect(w.attributes("title")).toBe("Coletânea baixada");
    expect(w.attributes("data-testid")).toBe("chip-status");
  });
});

// Fora do alcance do jsdom / do componente:
// - Altura, padding e cor de cada variante e tamanho: só existem no CSS scoped,
//   que o jsdom não resolve — o que dá para afirmar é a classe aplicada.
// - LjChip não tem prop disabled nem estado de foco visível próprio: não há
//   estado desabilitado a testar.
// - v-model: o chip não tem valor próprio, é puramente apresentacional.

describe("LjChip — regressões", () => {
  it("clique em remover não escapa para o elemento clicável ao redor", async () => {
    const noPai = vi.fn();
    const Pai = defineComponent({
      components: { LjChip },
      setup: () => ({ noPai }),
      template: `<div @click="noPai"><LjChip removable>tag</LjChip></div>`,
    });
    const w = mountUi(Pai);
    await w.get(".lj-chip__remove").trigger("click");
    expect(noPai).not.toHaveBeenCalled();
  });
});
