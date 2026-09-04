import { afterEach, describe, expect, it } from "vitest";
import { h } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjField from "../LjField.vue";
import LjInput from "../LjInput.vue";
import { mountUi } from "./mountUi";

/**
 * LjField é a moldura do rótulo: ele não controla valor nem tem tamanho
 * próprio. A garantia que importa é a ligação rótulo → campo: um <label>
 * cujo `for` não cai em elemento nenhum é decoração, não acessibilidade.
 * Por isso os testes centrais montam LjField junto com o LjInput de verdade,
 * anexados ao document, e conferem a associação pelo DOM real.
 */

const montados: VueWrapper[] = [];

/** Monta preso ao document — `for`/`id` só se resolvem em um documento real. */
function montarNoDocumento(options: Record<string, unknown> = {}) {
  const w = mountUi(LjField, { attachTo: document.body, ...options }) as VueWrapper;
  montados.push(w);
  return w;
}

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

describe("LjField", () => {
  it("liga o rótulo ao campo real quando htmlFor casa com o id do LjInput", () => {
    montarNoDocumento({
      props: { label: "Nome do culto", htmlFor: "culto-nome" },
      slots: { default: () => h(LjInput, { id: "culto-nome", modelValue: "" }) },
    });

    const label = document.querySelector("label") as HTMLLabelElement;
    const alvo = document.getElementById("culto-nome");

    expect(label.getAttribute("for")).toBe("culto-nome");
    // O alvo precisa existir e ser o campo, não a moldura do LjInput.
    expect(alvo).not.toBeNull();
    expect(alvo?.tagName).toBe("INPUT");
    // Ligação vista do lado do campo: é assim que o leitor de tela a enxerga.
    expect(Array.from((alvo as HTMLInputElement).labels ?? [])).toContain(label);
    expect(label.textContent).toContain("Nome do culto");
  });

  it("com dois campos na tela, cada rótulo aponta para o seu próprio input", () => {
    montarNoDocumento({
      props: { label: "Título", htmlFor: "campo-titulo" },
      slots: { default: () => h(LjInput, { id: "campo-titulo", modelValue: "" }) },
    });
    montarNoDocumento({
      props: { label: "Autor", htmlFor: "campo-autor" },
      slots: { default: () => h(LjInput, { id: "campo-autor", modelValue: "" }) },
    });

    const [labelTitulo, labelAutor] = Array.from(document.querySelectorAll("label"));
    expect(labelTitulo.getAttribute("for")).toBe("campo-titulo");
    expect(labelAutor.getAttribute("for")).toBe("campo-autor");
    expect((document.getElementById("campo-titulo") as HTMLInputElement).labels?.[0]).toBe(
      labelTitulo
    );
    expect((document.getElementById("campo-autor") as HTMLInputElement).labels?.[0]).toBe(
      labelAutor
    );
  });

  it("liga rótulo e campo sozinho, sem o chamador passar id", () => {
    // A ligação já foi opt-in, e ninguém optava — todo rótulo ficava órfão.
    // Agora o LjField gera o id e o controle o adota pelo contexto.
    montarNoDocumento({
      props: { label: "Observações" },
      slots: { default: () => h(LjInput, { modelValue: "" }) },
    });

    const label = document.querySelector("label") as HTMLLabelElement;
    const input = document.querySelector("input") as HTMLInputElement;
    expect(label.getAttribute("for")).toBeTruthy();
    expect(label.getAttribute("for")).toBe(input.id);
    // o navegador enxerga a associação, não só os atributos
    expect(Array.from(input.labels || [])).toContain(label);
  });

  it("anuncia a mensagem de erro pelo próprio campo", () => {
    montarNoDocumento({
      props: { label: "Versículo", error: "Informe um capítulo válido." },
      slots: { default: () => h(LjInput, { modelValue: "" }) },
    });

    const input = document.querySelector("input") as HTMLInputElement;
    const erro = document.querySelector(".lj-field__error") as HTMLElement;
    expect(input.getAttribute("aria-describedby")).toBe(erro.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(erro.getAttribute("role")).toBe("alert");
  });

  it("não renderiza <label> quando não há rótulo", () => {
    const w = montarNoDocumento({
      slots: { default: () => h(LjInput, { modelValue: "" }) },
    });
    expect(w.find("label").exists()).toBe(false);
  });

  it("usa o layout row por padrão e troca para column quando pedido", () => {
    expect(mountUi(LjField).classes()).toContain("lj-field--row");
    expect(mountUi(LjField, { props: { layout: "column" } }).classes()).toContain(
      "lj-field--column"
    );
    expect(mountUi(LjField, { props: { layout: "column" } }).classes()).not.toContain(
      "lj-field--row"
    );
  });

  it("renderiza o conteúdo do slot dentro do controle", () => {
    const w = mountUi(LjField, {
      props: { label: "Volume" },
      slots: { default: "<button>controle</button>" },
    });
    const controle = w.find(".lj-field__control");
    expect(controle.exists()).toBe(true);
    expect(controle.find("button").text()).toBe("controle");
  });

  it("mostra o hint quando não há erro", () => {
    const w = mountUi(LjField, {
      props: { label: "Fonte", hint: "Aplica-se a todas as telas de projeção." },
    });
    expect(w.text()).toContain("Aplica-se a todas as telas de projeção.");
  });

  it("mostra a mensagem de erro", () => {
    const w = mountUi(LjField, {
      props: { label: "Versículo", error: "Informe um capítulo válido." },
    });
    expect(w.text()).toContain("Informe um capítulo válido.");
  });

  it("o erro tem precedência sobre o hint — só uma mensagem aparece", () => {
    const w = mountUi(LjField, {
      props: {
        label: "Versículo",
        hint: "Ex.: Salmos 23",
        error: "Informe um capítulo válido.",
      },
    });
    expect(w.text()).toContain("Informe um capítulo válido.");
    expect(w.text()).not.toContain("Ex.: Salmos 23");
    expect(w.findAll(".lj-field__hint, .lj-field__error")).toHaveLength(1);
  });

  it("volta a mostrar o hint quando o erro é resolvido", async () => {
    const w = mountUi(LjField, {
      props: { label: "Versículo", hint: "Ex.: Salmos 23", error: "Capítulo inválido." },
    });
    await w.setProps({ error: "" });
    expect(w.text()).toContain("Ex.: Salmos 23");
    expect(w.text()).not.toContain("Capítulo inválido.");
  });

  it("a mensagem vem depois do controle na ordem de leitura", () => {
    const w = mountUi(LjField, {
      props: { label: "Versículo", error: "Informe um capítulo válido." },
      slots: { default: "<input id='v' />" },
    });
    const filhos = Array.from(w.find(".lj-field__control").element.children);
    const iCampo = filhos.findIndex((el) => el.tagName === "INPUT");
    const iErro = filhos.findIndex((el) => el.classList.contains("lj-field__error"));
    expect(iCampo).toBeGreaterThanOrEqual(0);
    expect(iErro).toBeGreaterThan(iCampo);
  });

  it("o asterisco de obrigatório fica fora do nome anunciado", () => {
    const w = mountUi(LjField, { props: { label: "Nome do culto", required: true } });
    const marca = w.find(".lj-field__required");
    expect(marca.exists()).toBe(true);
    expect(marca.text()).toBe("*");
    // Marca visual: precisa ser ignorada pelo leitor de tela, senão o campo
    // passa a se chamar "Nome do culto asterisco".
    expect(marca.attributes("aria-hidden")).toBe("true");

    const opcional = mountUi(LjField, { props: { label: "Nome do culto" } });
    expect(opcional.find(".lj-field__required").exists()).toBe(false);
  });
});

/*
 * Fora deste arquivo, de propósito:
 *
 * - Contrato de tamanho (lj-ui-size-*): LjField não tem prop `size`; quem
 *   carrega o tamanho é o controle no slot (LjInput/LjSelect).
 * - v-model e estado desabilitado: LjField não guarda valor nem tem prop
 *   `disabled` — delega os dois ao controle que embrulha.
 * - i18n PT/ES: LjField não traduz nada; `label`, `hint` e `error` chegam
 *   prontos de quem o usa. Não há chave própria para travar com
 *   expectKeyExists.
 * - Layout de fato (rótulo à esquerda no row, acima no column): é geometria
 *   de CSS externo, e jsdom não calcula layout. Aqui só dá para travar a
 *   classe que seleciona cada arranjo.
 * - Clicar no rótulo para focar o campo: jsdom não implementa a ativação de
 *   <label>, então o clique não move o foco nem no melhor dos casos. A mesma
 *   ligação está travada acima pelo `input.labels`, que é o que o navegador
 *   usa para esse comportamento.
 */
