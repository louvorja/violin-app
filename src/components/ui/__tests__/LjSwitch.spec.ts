import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import LjSwitch from "../LjSwitch.vue";
import { mountUi } from "./mountUi";

/**
 * Fora do alcance do jsdom (e por isso sem teste):
 * - o trilho, o polegar e a transição do polegar são só CSS (`:checked + .track`),
 *   e o jsdom não aplica folha scoped nem calcula transform — o que dá para
 *   afirmar é o estado do controle nativo, que é o que o leitor de tela lê;
 * - o esmaecimento e o `pointer-events: none` do estado desabilitado, idem;
 * - a ativação por teclado (Espaço) do checkbox nativo: o jsdom não executa o
 *   comportamento padrão da tecla, então um teste disso mediria o dublê. O que
 *   dá para garantir aqui é que o controle é um <input> nativo e focável — é
 *   dele que vem o Espaço no navegador de verdade.
 *
 * O primitivo não tem contrato de tamanho (não existe prop `size` nem classe
 * `lj-ui-size-*`) e não traduz nenhum rótulo próprio — o texto vem inteiro do
 * consumidor. Por isso não há teste de tamanho nem `expectKeyExists` aqui; o
 * que se garante em PT e ES é que o rótulo do consumidor sai intacto.
 *
 * Sem teste porque hoje FALHARIA — são defeitos do componente, não do teste:
 * - o `:checked` não volta a ser aplicado quando o pai recusa a mudança: se o
 *   usuário liga o switch e o pai mantém `modelValue: false`, o input continua
 *   marcado no DOM e o switch passa a mentir sobre o estado real;
 * - a raiz é o <label> e o componente não usa `v-bind="$attrs"` no input, então
 *   `aria-label`, `id`, `name` e afins caem no <label> e nunca chegam ao
 *   controle: um switch sem texto fica sem nome acessível, e um
 *   `<LjField html-for>` não tem como apontar para ele.
 */
describe("LjSwitch", () => {
  it("é um checkbox nativo anunciado como switch", () => {
    const input = mountUi(LjSwitch).get("input");

    expect(input.element.tagName).toBe("INPUT");
    expect(input.attributes("type")).toBe("checkbox");
    expect(input.attributes("role")).toBe("switch");
  });

  it("o rótulo dá nome ao controle — o <input> fica dentro do <label>", () => {
    const w = mountUi(LjSwitch, { props: { label: "Modo escuro" } });
    const input = w.get("input").element as HTMLInputElement;

    expect(input.labels).toHaveLength(1);
    expect(input.labels?.[0].textContent).toContain("Modo escuro");
  });

  it("o desenho do trilho é decorativo — não duplica o controle no leitor de tela", () => {
    const w = mountUi(LjSwitch);
    expect(w.get(".lj-switch__track").attributes("aria-hidden")).toBe("true");
  });

  it("mostra ligado ou desligado conforme o valor recebido", () => {
    const ligado = mountUi(LjSwitch, { props: { modelValue: true } });
    expect((ligado.get("input").element as HTMLInputElement).checked).toBe(true);

    const desligado = mountUi(LjSwitch, { props: { modelValue: false } });
    expect((desligado.get("input").element as HTMLInputElement).checked).toBe(false);
  });

  it("começa desligado quando nenhum valor é informado", () => {
    const w = mountUi(LjSwitch);
    expect((w.get("input").element as HTMLInputElement).checked).toBe(false);
  });

  it("v-model: ligar emite update:modelValue com true", async () => {
    const w = mountUi(LjSwitch, { props: { modelValue: false } });
    await w.get("input").setValue(true);

    expect(w.emitted("update:modelValue")).toEqual([[true]]);
  });

  it("v-model: desligar emite update:modelValue com false", async () => {
    const w = mountUi(LjSwitch, { props: { modelValue: true } });
    await w.get("input").setValue(false);

    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("v-model: alterna nos dois sentidos quando o pai devolve o valor", async () => {
    const w = mountUi(LjSwitch, { props: { modelValue: false } });

    await w.get("input").setValue(true);
    await w.setProps({ modelValue: true });
    await w.get("input").setValue(false);

    expect(w.emitted("update:modelValue")).toEqual([[true], [false]]);
  });

  it("o valor mudado pelo pai chega ao controle sem interação", async () => {
    const w = mountUi(LjSwitch, { props: { modelValue: false } });
    const input = w.get("input").element as HTMLInputElement;

    await w.setProps({ modelValue: true });
    expect(input.checked).toBe(true);

    await w.setProps({ modelValue: false });
    expect(input.checked).toBe(false);
  });

  it("clicar no desenho do switch alterna — o trilho não é enfeite morto", async () => {
    const w = mountUi(LjSwitch, {
      props: { modelValue: false },
      attachTo: document.body,
    });

    await w.get(".lj-switch__track").trigger("click");

    expect(w.emitted("update:modelValue")).toEqual([[true]]);
    w.unmount();
  });

  it("clicar no texto do rótulo alterna", async () => {
    const w = mountUi(LjSwitch, {
      props: { modelValue: false, label: "Projetar automaticamente" },
      attachTo: document.body,
    });

    await w.get(".lj-switch__label").trigger("click");

    expect(w.emitted("update:modelValue")).toEqual([[true]]);
    w.unmount();
  });

  it("desabilitado bloqueia o controle e marca a raiz", () => {
    const w = mountUi(LjSwitch, { props: { disabled: true } });

    expect(w.get("input").attributes("disabled")).toBeDefined();
    expect(w.classes()).toContain("is-disabled");
  });

  it("habilitado não carrega o atributo disabled nem a classe", () => {
    const w = mountUi(LjSwitch);

    expect(w.get("input").attributes("disabled")).toBeUndefined();
    expect(w.classes()).not.toContain("is-disabled");
  });

  it("desabilitado não alterna ao clicar no rótulo nem no trilho", async () => {
    const w = mountUi(LjSwitch, {
      props: { modelValue: false, disabled: true, label: "Modo escuro" },
      attachTo: document.body,
    });

    await w.get(".lj-switch__label").trigger("click");
    await w.get(".lj-switch__track").trigger("click");

    expect(w.emitted("update:modelValue")).toBeUndefined();
    w.unmount();
  });

  it("desabilitado sai da ordem de foco", () => {
    const w = mountUi(LjSwitch, { props: { disabled: true }, attachTo: document.body });
    const input = w.get("input").element as HTMLInputElement;

    input.focus();

    expect(document.activeElement).not.toBe(input);
    w.unmount();
  });

  it("habilitado recebe foco — é por ele que o teclado alterna", () => {
    const w = mountUi(LjSwitch, { attachTo: document.body });
    const input = w.get("input").element as HTMLInputElement;

    input.focus();

    expect(document.activeElement).toBe(input);
    w.unmount();
  });

  it("mostra o rótulo da prop e deixa o slot substituí-lo", () => {
    const porProp = mountUi(LjSwitch, { props: { label: "Modo escuro" } });
    expect(porProp.get(".lj-switch__label").text()).toBe("Modo escuro");

    const porSlot = mountUi(LjSwitch, {
      props: { label: "Modo escuro" },
      slots: { default: "<strong>Projeção</strong>" },
    });
    expect(porSlot.get(".lj-switch__label").text()).toBe("Projeção");
  });

  it("sem rótulo e sem slot não sobra área de texto vazia", () => {
    const w = mountUi(LjSwitch);
    expect(w.find(".lj-switch__label").exists()).toBe(false);
  });

  it("o rótulo é do consumidor — sai igual em PT e em ES", () => {
    const pt = mountUi(LjSwitch, { props: { label: "Modo escuro" } }, "pt");
    const es = mountUi(LjSwitch, { props: { label: "Modo escuro" } }, "es");

    expect(pt.get(".lj-switch__label").text()).toBe("Modo escuro");
    expect(es.get(".lj-switch__label").text()).toBe("Modo escuro");
  });
});

describe("LjSwitch — regressões", () => {
  it("volta ao estado do modelo quando o pai recusa a mudança", async () => {
    const w = mountUi(LjSwitch, { props: { modelValue: false } });
    const input = w.get("input");
    await input.setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([true]);

    await w.setProps({ modelValue: false });
    await nextTick();
    expect((input.element as HTMLInputElement).checked).toBe(false);
  });
});
