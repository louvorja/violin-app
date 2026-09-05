import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import LjInput from "../LjInput.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * Fora do alcance do jsdom (e por isso sem teste):
 * - o anel de foco do wrapper (`:focus-within`) e o esmaecimento do estado
 *   desabilitado são só CSS — jsdom não calcula estilo de folha scoped.
 *
 * Sem teste porque hoje FALHARIA — são defeitos do componente, não do teste:
 * - `inheritAttrs: false` sem nenhum `v-bind="$attrs"`: name, maxlength,
 *   autocomplete, aria-describedby e listeners (@focus/@blur/@keydown) são
 *   descartados e nunca chegam ao <input>;
 * - o botão de limpar continua habilitado e focável com `disabled`; só o CSS
 *   `pointer-events: none` o neutraliza, e isso não barra teclado.
 */
describe("LjInput", () => {
  it("coloca o id no <input> real, não no wrapper — é o alvo do rótulo do LjField", () => {
    const w = mountUi(LjInput, { props: { id: "campo-busca" } });

    // O <label for="campo-busca"> do LjField só encontra o campo se o id
    // estiver no <input>; no wrapper, o clique no rótulo não foca nada.
    expect(w.get("input").attributes("id")).toBe("campo-busca");
    expect(w.element.getAttribute("id")).toBeNull();
  });

  it("renderiza um <input> de verdade dentro do wrapper", () => {
    const w = mountUi(LjInput);
    expect(w.element.tagName).toBe("DIV");
    expect(w.find("input").exists()).toBe(true);
  });

  it("aplica a classe de tamanho do contrato", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const w = mountUi(LjInput, { props: { size } });
      expect(w.classes()).toContain(`lj-ui-size-${size}`);
    }
  });

  it("usa md quando o tamanho não é informado", () => {
    expect(mountUi(LjInput).classes()).toContain("lj-ui-size-md");
  });

  it("mostra o valor recebido no campo", () => {
    const w = mountUi(LjInput, { props: { modelValue: "Ana" } });
    expect(w.get("input").element.value).toBe("Ana");
  });

  it("aceita valor numérico sem imprimir vazio", () => {
    const w = mountUi(LjInput, { props: { modelValue: 0 } });
    expect(w.get("input").element.value).toBe("0");
  });

  it("v-model: digitar emite update:modelValue com o texto digitado", async () => {
    const w = mountUi(LjInput, { props: { modelValue: "" } });
    await w.get("input").setValue("louvor");

    expect(w.emitted("update:modelValue")).toEqual([["louvor"]]);
  });

  it("v-model: o valor devolvido pelo pai volta para o campo", async () => {
    const w = mountUi(LjInput, { props: { modelValue: "" } });
    await w.get("input").setValue("hino");

    const [[novo]] = w.emitted("update:modelValue") as string[][];
    await w.setProps({ modelValue: novo });

    expect(w.get("input").element.value).toBe("hino");
  });

  it("é text por padrão e respeita o tipo pedido", () => {
    expect(mountUi(LjInput).get("input").attributes("type")).toBe("text");
    expect(
      mountUi(LjInput, { props: { type: "password" } })
        .get("input")
        .attributes("type")
    ).toBe("password");
  });

  it("repassa o placeholder para o campo", () => {
    const w = mountUi(LjInput, { props: { placeholder: "Buscar..." } });
    expect(w.get("input").attributes("placeholder")).toBe("Buscar...");
  });

  it("desabilitado bloqueia o campo e marca o wrapper", () => {
    const w = mountUi(LjInput, { props: { disabled: true } });

    expect(w.get("input").attributes("disabled")).toBeDefined();
    expect(w.classes()).toContain("is-disabled");
  });

  it("inválido anuncia aria-invalid e não deixa o atributo sujar o campo válido", () => {
    const invalido = mountUi(LjInput, { props: { invalid: true } });
    expect(invalido.get("input").attributes("aria-invalid")).toBe("true");
    expect(invalido.classes()).toContain("is-invalid");

    const valido = mountUi(LjInput);
    expect(valido.get("input").attributes("aria-invalid")).toBeUndefined();
    expect(valido.classes()).not.toContain("is-invalid");
  });

  it("só mostra o botão de limpar quando clearable e há algo para limpar", () => {
    const semProp = mountUi(LjInput, { props: { modelValue: "algo" } });
    expect(semProp.find(".lj-input__clear").exists()).toBe(false);

    const vazio = mountUi(LjInput, { props: { clearable: true, modelValue: "" } });
    expect(vazio.find(".lj-input__clear").exists()).toBe(false);

    const comValor = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } });
    expect(comValor.find(".lj-input__clear").exists()).toBe(true);
  });

  it("limpar emite update:modelValue com string vazia", async () => {
    const w = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } });
    await w.get(".lj-input__clear").trigger("click");

    expect(w.emitted("update:modelValue")).toEqual([[""]]);
  });

  it("o botão de limpar é type=button — não envia o formulário em volta", () => {
    const w = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } });
    expect(w.get(".lj-input__clear").attributes("type")).toBe("button");
  });

  it("o botão de limpar tem nome acessível traduzido em PT e ES", () => {
    expectKeyExists("components.ui.clear");

    const pt = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } });
    expect(pt.get(".lj-input__clear").attributes("aria-label")).toBe("Limpar");

    const es = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } }, "es");
    expect(es.get(".lj-input__clear").attributes("aria-label")).toBe("Limpiar");
  });

  it("o botão de limpar some assim que o campo fica vazio", async () => {
    const w = mountUi(LjInput, { props: { clearable: true, modelValue: "algo" } });
    await w.setProps({ modelValue: "" });

    expect(w.find(".lj-input__clear").exists()).toBe(false);
  });

  it("renderiza o slot de sufixo", () => {
    const w = mountUi(LjInput, { slots: { suffix: '<span class="marca">un</span>' } });
    expect(w.find(".marca").exists()).toBe(true);
  });
});

/**
 * Regressões corrigidas depois da primeira auditoria. Cada caso aqui falharia
 * na versão anterior do componente.
 */
describe("LjInput — regressões", () => {
  it("repassa atributos ao <input>, não ao wrapper", () => {
    const w = mountUi(LjInput, { attrs: { name: "busca", maxlength: "10", autocomplete: "off" } });
    const input = w.get("input");
    expect(input.attributes("name")).toBe("busca");
    expect(input.attributes("maxlength")).toBe("10");
    expect(input.attributes("autocomplete")).toBe("off");
    // o wrapper não deve ficar com os atributos do campo
    expect(w.attributes("name")).toBeUndefined();
  });

  it("entrega listeners ao <input> — sem isso não dá para ouvir Enter", async () => {
    const onKeydown = vi.fn();
    const w = mountUi(LjInput, { attrs: { onKeydown } });
    await w.get("input").trigger("keydown", { key: "Enter" });
    expect(onKeydown).toHaveBeenCalledTimes(1);
  });

  it("botão de limpar fica desabilitado junto com o campo", () => {
    const w = mountUi(LjInput, { props: { clearable: true, modelValue: "x", disabled: true } });
    expect(w.get(".lj-input__clear").attributes("disabled")).toBeDefined();
  });
});

describe("LjInput — foco", () => {
  it("autofocus foca o campo de verdade, não só declara o atributo", async () => {
    // O atributo `autofocus` do HTML é ignorado em elementos inseridos depois
    // do carregamento — que é sempre o caso dentro de um diálogo.
    const w = mountUi(LjInput, { attachTo: document.body, props: { autofocus: true } });
    await nextTick();
    expect(document.activeElement).toBe(w.get("input").element);
    w.unmount();
  });

  it("sem autofocus não rouba o foco", async () => {
    const w = mountUi(LjInput, { attachTo: document.body });
    await nextTick();
    expect(document.activeElement).not.toBe(w.get("input").element);
    w.unmount();
  });

  it("expõe focus() para quem precisa focar depois", async () => {
    const w = mountUi(LjInput, { attachTo: document.body });
    (w.vm as unknown as { focus: () => void }).focus();
    await nextTick();
    expect(document.activeElement).toBe(w.get("input").element);
    w.unmount();
  });
});
