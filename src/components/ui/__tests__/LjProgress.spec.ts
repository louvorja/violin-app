import { describe, expect, it } from "vitest";
import LjProgress from "../LjProgress.vue";
import { mountUi } from "./mountUi";

/**
 * O LjProgress não traduz nenhum rótulo próprio: `label` chega pronto de fora.
 * Por isso não há caso de i18n aqui — não existe chave para travar com
 * expectKeyExists. Também não há `size`, `v-model` nem estado desabilitado:
 * o primitivo é somente leitura.
 */

/** O elemento que carrega o papel e os valores acessíveis. */
const bar = (w: ReturnType<typeof mountUi>) => w.get('[role="progressbar"]');

describe("LjProgress", () => {
  it("expõe papel de progressbar com a faixa 0..100", () => {
    const w = mountUi(LjProgress, { props: { value: 40 } });
    const track = bar(w);
    expect(track.attributes("aria-valuemin")).toBe("0");
    expect(track.attributes("aria-valuemax")).toBe("100");
  });

  it("publica o valor atual em aria-valuenow", () => {
    const w = mountUi(LjProgress, { props: { value: 42 } });
    expect(bar(w).attributes("aria-valuenow")).toBe("42");
  });

  it("começa em zero quando o valor não é informado", () => {
    const w = mountUi(LjProgress);
    expect(bar(w).attributes("aria-valuenow")).toBe("0");
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("0%");
  });

  it("preenche a barra na proporção do valor", () => {
    const w = mountUi(LjProgress, { props: { value: 40 } });
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("40%");
  });

  // Defeito conhecido: valor fora da faixa vazava para o aria e para a largura.
  it("prende valor negativo em 0", () => {
    const w = mountUi(LjProgress, { props: { value: -10, showValue: true } });
    expect(bar(w).attributes("aria-valuenow")).toBe("0");
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("0%");
    expect(w.text()).toContain("0%");
    expect(w.text()).not.toContain("-10");
  });

  it("prende valor acima de 100 em 100", () => {
    const w = mountUi(LjProgress, { props: { value: 150, showValue: true } });
    expect(bar(w).attributes("aria-valuenow")).toBe("100");
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("100%");
    expect(w.text()).toContain("100%");
    expect(w.text()).not.toContain("150");
  });

  it("arredonda o valor fracionário em vez de vazar decimais", () => {
    const w = mountUi(LjProgress, { props: { value: 33.6, showValue: true } });
    expect(bar(w).attributes("aria-valuenow")).toBe("34");
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("34%");
    expect(w.text()).toContain("34%");
    expect(w.text()).not.toContain("33.6");
  });

  it("arredonda para baixo abaixo da metade", () => {
    const w = mountUi(LjProgress, { props: { value: 33.4 } });
    expect(bar(w).attributes("aria-valuenow")).toBe("33");
  });

  // Defeito conhecido: no indeterminado não pode haver valor anunciado.
  it("não anuncia aria-valuenow quando indeterminado", () => {
    const w = mountUi(LjProgress, { props: { value: 40, indeterminate: true } });
    const track = bar(w);
    expect(track.attributes("aria-valuenow")).toBeUndefined();
    // O papel e a faixa continuam: o leitor de tela sabe que há progresso em curso.
    expect(track.attributes("aria-valuemin")).toBe("0");
    expect(track.attributes("aria-valuemax")).toBe("100");
  });

  it("indeterminado ignora o valor e não fixa a largura da barra", () => {
    const w = mountUi(LjProgress, { props: { value: 40, indeterminate: true } });
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("");
  });

  it("indeterminado não mostra porcentagem mesmo com showValue", () => {
    const w = mountUi(LjProgress, {
      props: { value: 40, indeterminate: true, showValue: true },
    });
    expect(w.text()).not.toContain("%");
  });

  it("showValue mostra a porcentagem e o padrão a esconde", () => {
    const com = mountUi(LjProgress, { props: { value: 75, showValue: true } });
    expect(com.text()).toContain("75%");

    const sem = mountUi(LjProgress, { props: { value: 75 } });
    expect(sem.text()).not.toContain("75%");
  });

  it("mostra o rótulo recebido de fora", () => {
    const w = mountUi(LjProgress, { props: { label: "Baixando coletânea" } });
    expect(w.text()).toContain("Baixando coletânea");
  });

  it("sem rótulo e sem showValue não sobra cabeçalho vazio na tela", () => {
    const w = mountUi(LjProgress, { props: { value: 10 } });
    expect(w.find(".lj-progress__header").exists()).toBe(false);
  });

  it("aplica a altura pedida na trilha", () => {
    const w = mountUi(LjProgress, { props: { height: 12 } });
    expect((bar(w).element as HTMLElement).style.height).toBe("12px");
  });

  it("acompanha a mudança de valor sem remontar", async () => {
    const w = mountUi(LjProgress, { props: { value: 10, showValue: true } });
    expect(bar(w).attributes("aria-valuenow")).toBe("10");

    await w.setProps({ value: 90 });
    expect(bar(w).attributes("aria-valuenow")).toBe("90");
    expect((w.get(".lj-progress__bar").element as HTMLElement).style.width).toBe("90%");
    expect(w.text()).toContain("90%");
  });

  it("volta a anunciar o valor ao sair do modo indeterminado", async () => {
    const w = mountUi(LjProgress, { props: { value: 55, indeterminate: true } });
    expect(bar(w).attributes("aria-valuenow")).toBeUndefined();

    await w.setProps({ indeterminate: false });
    expect(bar(w).attributes("aria-valuenow")).toBe("55");
  });
});

/*
 * Ficou de fora, por limite do jsdom (não por falta de caso):
 * - a animação do modo indeterminado (@keyframes lj-progress-slide) e a
 *   transição de largura — jsdom não roda animação nem CSS de <style scoped>;
 * - a largura renderizada de fato da barra (só o valor inline é observável,
 *   nunca o pixel resultante), pois jsdom não faz layout.
 */
