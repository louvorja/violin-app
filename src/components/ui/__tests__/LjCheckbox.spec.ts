import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import LjCheckbox from "../LjCheckbox.vue";
import { mountUi } from "./mountUi";

/**
 * O primitivo esconde um <input type="checkbox"> nativo atrás de uma caixinha
 * desenhada. Todo o valor dessa escolha (foco por teclado, estado misto real,
 * rótulo clicável, leitor de tela) depende de o input continuar existindo e
 * continuar associado ao rótulo — é isso que estes testes prendem.
 *
 * Tudo é montado preso ao documento: no jsdom, o comportamento de ativação de
 * um checkbox (alternar `checked` e disparar `change`) só roda em elemento
 * conectado. Montado solto, clicar não marcaria nada e o teste de v-model
 * viraria um falso negativo.
 *
 * Fora do alcance do jsdom (e por isso sem teste):
 * - a caixinha visível só ganha cor pelas regras `:checked + .lj-check__box` e
 *   `:focus-visible + .lj-check__box` do CSS scoped; jsdom não resolve folha de
 *   estilo scoped, então "parece marcado" não é observável aqui;
 * - o ícone de check/menos dentro da caixinha cai num <v-icon> do Vuetify, que
 *   não está registrado nesta montagem — afirmar a presença dele mediria o
 *   dublê, não o primitivo;
 * - o esmaecimento e o `pointer-events: none` do estado desabilitado também são
 *   só CSS. O que dá para garantir (e está garantido abaixo) é o `disabled` no
 *   input, que é o que de fato barra teclado e leitor de tela.
 *
 * Sem teste porque hoje FALHARIA — é defeito do componente, não do teste:
 * - o input é controlado só por `:checked`, sem resincronizar depois do change.
 *   Se o pai recusar a mudança (validação, confirmação, limite de seleção) e
 *   mantiver `modelValue` em false, o input segue `checked === true` para
 *   sempre — nem um `setProps({ modelValue: false })` explícito o traz de
 *   volta, porque o valor ligado não mudou e o Vue não repinta a propriedade.
 *   Resultado: a caixinha desenhada mostra desmarcado e o input diz marcado.
 *
 * Sem teste de i18n e sem teste de tamanho porque o primitivo não tem nem um
 * nem outro: o rótulo vem inteiro de fora (prop `label` ou slot) e não existe
 * prop `size`, logo não há chave a travar com expectKeyExists nem classe
 * `lj-ui-size-*` a conferir.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let montado: VueWrapper<any> | null = null;

function montar(options: any = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  montado = mountUi(LjCheckbox, { ...options, attachTo: host }) as VueWrapper<any>;
  return montado;
}

function inputDe(w: VueWrapper<any>): HTMLInputElement {
  return w.get("input").element as HTMLInputElement;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  montado?.unmount();
  montado = null;
  document.body.innerHTML = "";
});

describe("LjCheckbox", () => {
  it("renderiza um <input type=checkbox> real dentro de um <label>", () => {
    const w = montar({ props: { label: "Repetir" } });

    expect(w.element.tagName).toBe("LABEL");
    expect(w.get("input").attributes("type")).toBe("checkbox");
  });

  it("o input escondido continua focável pelo teclado", () => {
    const w = montar({ props: { label: "Repetir" } });
    const input = inputDe(w);

    // Esconder por CSS é legítimo; tirar do fluxo de foco não seria.
    expect(input.hidden).toBe(false);
    expect(input.hasAttribute("tabindex")).toBe(false);
    expect(input.getAttribute("aria-hidden")).toBeNull();

    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("o rótulo da prop fica associado ao input clicável", () => {
    const w = montar({ props: { label: "Repetir faixa" } });
    const input = inputDe(w);

    // Sem essa associação o leitor de tela anuncia "caixa de seleção" sem nome
    // e o clique no texto não marca nada.
    expect(Array.from(input.labels ?? [])).toEqual([w.element]);
    expect(input.labels?.[0].textContent).toContain("Repetir faixa");
  });

  it("o rótulo por slot fica igualmente associado ao input", () => {
    const w = montar({ slots: { default: "Tocar em sequência" } });
    const input = inputDe(w);

    expect(Array.from(input.labels ?? [])).toEqual([w.element]);
    expect(input.labels?.[0].textContent).toContain("Tocar em sequência");
  });

  it("clicar no texto do rótulo marca o campo", async () => {
    const w = montar({ props: { modelValue: false, label: "Repetir" } });

    await w.get(".lj-check__label").trigger("click");

    expect(w.emitted("update:modelValue")).toEqual([[true]]);
  });

  it("sem rótulo e sem slot não imprime texto algum", () => {
    expect(montar().text()).toBe("");
  });

  it("reflete modelValue no estado marcado do input", async () => {
    const w = montar({ props: { modelValue: true } });
    expect(inputDe(w).checked).toBe(true);

    await w.setProps({ modelValue: false });
    expect(inputDe(w).checked).toBe(false);
  });

  it("sem modelValue começa desmarcado", () => {
    expect(inputDe(montar()).checked).toBe(false);
  });

  it("v-model: marcar emite update:modelValue com true", async () => {
    const w = montar({ props: { modelValue: false } });

    await w.get("input").trigger("click");

    // Booleano, não o Event — é o que o v-model do pai vai guardar.
    expect(w.emitted("update:modelValue")).toEqual([[true]]);
  });

  it("v-model: desmarcar emite update:modelValue com false", async () => {
    const w = montar({ props: { modelValue: true } });

    await w.get("input").trigger("click");

    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("v-model: o valor devolvido pelo pai volta para o input", async () => {
    const w = montar({ props: { modelValue: false } });
    await w.get("input").trigger("click");

    const [[novo]] = w.emitted("update:modelValue") as boolean[][];
    await w.setProps({ modelValue: novo });

    expect(inputDe(w).checked).toBe(true);
  });

  it("desabilitado marca o input como disabled e não emite ao ser clicado", async () => {
    const w = montar({ props: { modelValue: false, disabled: true } });

    expect(inputDe(w).disabled).toBe(true);

    await w.get("input").trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("desabilitado também ignora o clique no rótulo", async () => {
    const w = montar({ props: { modelValue: false, disabled: true, label: "Repetir" } });

    await w.get(".lj-check__label").trigger("click");

    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("habilitado não carrega disabled residual", () => {
    expect(inputDe(montar({ props: { modelValue: false } })).disabled).toBe(false);
  });

  it("indeterminate põe o input em estado misto sem marcá-lo", () => {
    const w = montar({ props: { modelValue: false, indeterminate: true } });
    const input = inputDe(w);

    // Estado misto é propriedade do DOM, não atributo: se a ligação virar
    // atributo (`indeterminate="true"`), esta asserção cai.
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);
  });

  it("indeterminate sai quando o pai resolve o estado", async () => {
    const w = montar({ props: { modelValue: false, indeterminate: true } });

    await w.setProps({ indeterminate: false, modelValue: true });

    expect(inputDe(w).indeterminate).toBe(false);
    expect(inputDe(w).checked).toBe(true);
  });

  it("indeterminate não bloqueia o clique: continua emitindo o novo valor", async () => {
    const w = montar({ props: { modelValue: false, indeterminate: true } });

    await w.get("input").trigger("click");

    // Clicar num "misto" resolve para marcado — é o que o pai precisa ouvir
    // para desfazer o estado parcial.
    expect(w.emitted("update:modelValue")).toEqual([[true]]);
  });
});

describe("LjCheckbox — regressões", () => {
  it("volta ao estado do modelo quando o pai recusa a mudança", async () => {
    const w = mountUi(LjCheckbox, { props: { modelValue: false } });
    const input = w.get("input");
    await input.setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([true]);

    // o pai ignorou o evento e manteve false — o controle não pode mentir
    await w.setProps({ modelValue: false });
    await nextTick();
    expect((input.element as HTMLInputElement).checked).toBe(false);
  });
});
