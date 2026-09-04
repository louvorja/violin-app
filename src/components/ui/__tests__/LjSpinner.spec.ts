import { describe, expect, it } from "vitest";
import LjSpinner from "../LjSpinner.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * O spinner é o único feedback de "estou trabalhando" em telas que travam por
 * segundos (download de coletâneas, abertura de música). Se ele for mudo para o
 * leitor de tela, o operador cego fica sem saber se o app parou ou está lento —
 * daí o peso dos testes de rótulo aqui.
 */
describe("LjSpinner", () => {
  it("anuncia-se como status para o leitor de tela", () => {
    const w = mountUi(LjSpinner);
    expect(w.attributes("role")).toBe("status");
    // Um status escondido não é anunciado; o spinner não pode se auto-ocultar.
    expect(w.attributes("aria-hidden")).toBeUndefined();
  });

  it("tem nome acessível traduzido em PT", () => {
    expectKeyExists("components.ui.loading");
    const w = mountUi(LjSpinner, {}, "pt");
    expect(w.attributes("aria-label")).toBe("Carregando");
  });

  it("tem nome acessível traduzido em ES", () => {
    const w = mountUi(LjSpinner, {}, "es");
    expect(w.attributes("aria-label")).toBe("Cargando");
  });

  it("não vaza a chave crua de i18n como rótulo", () => {
    for (const locale of ["pt", "es"] as const) {
      const rotulo = mountUi(LjSpinner, {}, locale).attributes("aria-label");
      expect(rotulo).toBeTruthy();
      expect(rotulo).not.toContain("components.ui");
    }
  });

  it("a prop label sobrescreve o rótulo traduzido, em qualquer idioma", () => {
    const pt = mountUi(LjSpinner, { props: { label: "Baixando músicas" } }, "pt");
    expect(pt.attributes("aria-label")).toBe("Baixando músicas");

    const es = mountUi(LjSpinner, { props: { label: "Descargando" } }, "es");
    expect(es.attributes("aria-label")).toBe("Descargando");
  });

  it("volta ao rótulo traduzido quando a label some", async () => {
    const w = mountUi(LjSpinner, { props: { label: "Sincronizando" } }, "es");
    expect(w.attributes("aria-label")).toBe("Sincronizando");

    await w.setProps({ label: undefined });
    expect(w.attributes("aria-label")).toBe("Cargando");
  });

  it("desenha 15px quando o tamanho não é informado", () => {
    const w = mountUi(LjSpinner);
    expect(w.attributes("style")).toContain("width: 15px");
    expect(w.attributes("style")).toContain("height: 15px");

    const svg = w.find("svg");
    expect(svg.attributes("width")).toBe("15");
    expect(svg.attributes("height")).toBe("15");
  });

  it("respeita o tamanho pedido na caixa e no desenho", () => {
    const w = mountUi(LjSpinner, { props: { size: 32 } });
    expect(w.attributes("style")).toContain("width: 32px");
    expect(w.attributes("style")).toContain("height: 32px");

    const svg = w.find("svg");
    expect(svg.attributes("width")).toBe("32");
    expect(svg.attributes("height")).toBe("32");
    // Sem viewBox fixo o traço engrossaria junto com o tamanho.
    expect(svg.attributes("viewBox")).toBe("0 0 24 24");
  });

  it("usa a mesma espessura de traço nos dois arcos", () => {
    const padrao = mountUi(LjSpinner);
    expect(padrao.findAll("circle").map((c) => c.attributes("stroke-width"))).toEqual(["3", "3"]);

    const grosso = mountUi(LjSpinner, { props: { strokeWidth: 6 } });
    expect(grosso.findAll("circle").map((c) => c.attributes("stroke-width"))).toEqual(["6", "6"]);
  });

  it("é apenas um indicador: não expõe controle nem texto visível", () => {
    const w = mountUi(LjSpinner);
    expect(w.text()).toBe("");
    expect(w.find("button").exists()).toBe(false);
  });

  /*
   * Fora do alcance do jsdom, de propósito:
   * - a animação de giro (`@keyframes lj-spin`) e o arco de ~1/4 via
   *   stroke-dasharray vivem em CSS scoped: jsdom não roda animação nem calcula
   *   estilo de folha embutida, então qualquer asserção seria sobre string de
   *   CSS, não sobre comportamento;
   * - `stroke: currentColor` herdar a cor do contexto depende de layout/cascata
   *   reais, também indisponíveis aqui.
   * Não há contrato de tamanho sm/md/lg neste primitivo — `size` é um número em
   * pixels, coberto acima —, nem v-model ou estado desabilitado a testar.
   *
   * Não testado de propósito: `label=""` hoje produz `aria-label=""` (o
   * componente usa `label ?? t(...)`, e string vazia não é nullish), deixando o
   * status sem nome acessível. Um teste aqui congelaria o defeito; ele está
   * relatado para o dono do componente.
   */
});

describe("LjSpinner — regressões", () => {
  it("rótulo vazio cai no traduzido em vez de virar nome acessível vazio", () => {
    const w = mountUi(LjSpinner, { props: { label: "" } });
    expect(w.attributes("aria-label")).toBe("Carregando");
  });
});
