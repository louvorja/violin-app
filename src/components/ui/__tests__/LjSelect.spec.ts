import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjSelect from "../LjSelect.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * O painel do LjSelect vai para um portal no <body>, então os testes montam com
 * `attachTo` e consultam o document, não o wrapper.
 *
 * O Reka captura o ponteiro ao abrir e o jsdom não implementa essa API — sem os
 * stubs abaixo o painel nem chega a abrir. Eles substituem o navegador, não o
 * componente.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

type Props = Record<string, unknown>;

let atual: VueWrapper | null = null;

function montar(props: Props = {}, locale: "pt" | "es" = "pt", extra: Props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  atual = mountUi(LjSelect, { attachTo: host, props, ...extra }, locale) as unknown as VueWrapper;
  return atual;
}

/** Desmonta antes da hora para o mesmo teste montar outra variante. */
function desmontar() {
  atual?.unmount();
  atual = null;
  document.body.innerHTML = "";
}

afterEach(desmontar);

function ponteiro(el: Element, type: string) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
}

/** Duas microtarefas + uma macrotarefa: o Reka adia seleção e posicionamento. */
async function assentar() {
  await nextTick();
  await new Promise((r) => setTimeout(r, 30));
  await nextTick();
}

const gatilho = () => document.querySelector('[role="combobox"]') as HTMLButtonElement;
const opcoes = () => Array.from(document.querySelectorAll('[role="option"]'));
const rotulo = () => document.querySelector(".lj-select__value") as HTMLElement;

/**
 * Abre o painel como o usuário abre: pressiona o gatilho e solta. O pointerup
 * de abertura é engolido pelo próprio Reka (guarda de clique-e-solta no mesmo
 * lugar), por isso ele vem aqui e não junto do clique no item.
 */
async function abrir() {
  ponteiro(gatilho(), "pointerdown");
  await assentar();
  ponteiro(gatilho(), "pointerup");
  await assentar();
}

async function escolher(opcao: Element) {
  ponteiro(opcao, "pointerup");
  await assentar();
}

const MONITORES = [
  { value: "", label: "Mesma janela" },
  { value: "m1", label: "Monitor 1" },
];

describe("LjSelect", () => {
  it("expõe um combobox fechado, com nome acessível e sem lista no DOM", () => {
    montar({ items: ["a", "b"], ariaLabel: "Monitor" });
    expect(gatilho().tagName).toBe("BUTTON");
    expect(gatilho().getAttribute("type")).toBe("button");
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
    expect(gatilho().getAttribute("aria-label")).toBe("Monitor");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("aplica a classe de tamanho do contrato", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      montar({ items: ["a"], size });
      expect(gatilho().classList.contains(`lj-ui-size-${size}`)).toBe(true);
      desmontar();
    }
  });

  it("usa md quando o tamanho não é informado", () => {
    montar({ items: ["a"] });
    expect(gatilho().classList.contains("lj-ui-size-md")).toBe(true);
  });

  it("leva atributos do consumidor para o gatilho visível, não para o nada", () => {
    // SelectRoot não emite DOM: sem inheritAttrs:false + v-bind no gatilho,
    // id e class do chamador se perderiam.
    montar({ items: ["a"] }, "pt", { attrs: { id: "monitor-projecao", class: "campo-largo" } });
    expect(gatilho().id).toBe("monitor-projecao");
    expect(gatilho().classList.contains("campo-largo")).toBe(true);
  });

  it("mostra o rótulo do item selecionado, não o valor cru", () => {
    montar({ items: MONITORES, modelValue: "m1" });
    expect(rotulo().textContent).toBe("Monitor 1");
  });

  it("respeita item-value e item-label customizados", () => {
    montar({
      items: [
        { role: "main", name: "Principal" },
        { role: "aux", name: "Auxiliar" },
      ],
      itemValue: "role",
      itemLabel: "name",
      modelValue: "aux",
    });
    expect(rotulo().textContent).toBe("Auxiliar");
  });

  it("abre a lista com role listbox e opções ligadas ao gatilho", async () => {
    montar({ items: ["Tema claro", "Tema escuro"] });
    await abrir();

    const lista = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(lista).not.toBeNull();
    expect(gatilho().getAttribute("aria-expanded")).toBe("true");
    expect(gatilho().getAttribute("aria-controls")).toBe(lista.id);
    expect(opcoes().map((o) => o.textContent?.trim())).toEqual(["Tema claro", "Tema escuro"]);
  });

  it("v-model: escolher um item emite o valor do item", async () => {
    const w = montar({ items: ["a", "b"], modelValue: "a" });
    await abrir();
    await escolher(opcoes()[1]);

    expect(w.emitted("update:modelValue")).toEqual([["b"]]);
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
  });

  it("string vazia é valor de negócio: o item existe, aparece marcado e não vira placeholder", async () => {
    // O Reka reserva "" para "sem seleção" e um <SelectItem value=""> lança
    // erro. Este teste quebra se a sentinela interna sumir.
    const w = montar({ items: MONITORES, modelValue: "" });

    expect(rotulo().textContent).toBe("Mesma janela");
    expect(gatilho().hasAttribute("data-placeholder")).toBe(false);

    await abrir();
    const [vazio, m1] = opcoes();
    expect(vazio.getAttribute("aria-selected")).toBe("true");
    expect(vazio.getAttribute("data-state")).toBe("checked");
    expect(m1.getAttribute("aria-selected")).toBe("false");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("escolher o item de valor vazio devolve string vazia, nunca a sentinela", async () => {
    const w = montar({ items: MONITORES, modelValue: "m1" });
    await abrir();
    await escolher(opcoes()[0]);

    const emitido = w.emitted("update:modelValue");
    expect(emitido).toHaveLength(1);
    expect(emitido?.[0]).toEqual([""]);
    expect(String(emitido?.[0][0])).not.toContain("lj-empty");
  });

  it("sem valor nenhum o gatilho se anuncia como placeholder", () => {
    montar({ items: MONITORES });
    expect(gatilho().hasAttribute("data-placeholder")).toBe(true);
  });

  it("zero é valor de negócio: fica marcado e volta como número", async () => {
    const items = [
      { value: 0, label: "Sem atraso" },
      { value: 1, label: "1 segundo" },
    ];
    const w = montar({ items, modelValue: 0 });
    expect(rotulo().textContent).toBe("Sem atraso");
    expect(gatilho().hasAttribute("data-placeholder")).toBe(false);

    await abrir();
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");

    await escolher(opcoes()[1]);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([1]);
    expect(typeof w.emitted("update:modelValue")?.[0][0]).toBe("number");
  });

  it("leva o placeholder traduzido ao gatilho em PT e em ES", () => {
    expectKeyExists("components.ui.select_placeholder");

    // O texto chega ao gatilho pelo data-placeholder do SelectValue — é o que o
    // componente estiliza. Ver bug relatado: o texto visível fica vazio.
    montar({ items: MONITORES });
    expect(rotulo().getAttribute("data-placeholder")).toBe("Selecione...");
    desmontar();

    montar({ items: MONITORES }, "es");
    expect(rotulo().getAttribute("data-placeholder")).toBe("Seleccione...");
  });

  it("placeholder explícito ganha da tradução", () => {
    montar({ items: MONITORES, placeholder: "Escolha o monitor" });
    expect(rotulo().getAttribute("data-placeholder")).toBe("Escolha o monitor");
  });

  it("desabilitado não abre e se anuncia como desabilitado", async () => {
    const w = montar({ items: MONITORES, disabled: true });
    expect(gatilho().hasAttribute("disabled")).toBe(true);
    expect(gatilho().hasAttribute("data-disabled")).toBe(true);

    await abrir();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("seleciona pelo teclado com Enter", async () => {
    const w = montar({ items: MONITORES, modelValue: "" });
    await abrir();
    opcoes()[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    await assentar();

    expect(w.emitted("update:modelValue")).toEqual([["m1"]]);
  });

  it("o slot item customiza o conteúdo de cada opção", async () => {
    montar({ items: MONITORES }, "pt", {
      slots: { item: `<template #item="{ item }">[{{ item.label }}]</template>` },
    });

    await abrir();
    expect(opcoes().map((o) => o.textContent?.trim())).toEqual(["[Mesma janela]", "[Monitor 1]"]);
  });
});

/*
 * Fora do alcance do jsdom (não foram escritos testes falsos para isto):
 * - posição, largura (--reka-select-trigger-width) e rolagem do painel, além
 *   dos botões de scroll: dependem de layout real, que o jsdom não calcula.
 * - navegação por setas e typeahead do Reka, que exigem foco/rolagem reais.
 * - foco de retorno ao gatilho ao fechar: o FocusScope depende de foco de
 *   navegador de verdade.
 */
