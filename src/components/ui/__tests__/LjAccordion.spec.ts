import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import Icon from "@/components/Icon.vue";
import LjAccordion, { type LjAccordionItem } from "../LjAccordion.vue";
import { mountUi } from "./mountUi";

/**
 * A sanfona da Reka reage a `click` e às setas do teclado, e move o foco de
 * verdade — o que só funciona com a árvore ligada ao documento. Por isso todo
 * mount aqui vai para o document.body e as consultas são feitas no documento.
 */
const ITENS: LjAccordionItem[] = [
  { value: "hinario", label: "Hinário" },
  { value: "corais", label: "Corais", icon: "music" },
  { value: "infantil", label: "Infantil" },
];

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function montar(options: any = {}) {
  const props = { items: ITENS, ...(options.props || {}) };
  const wrapper = mountUi(LjAccordion, { attachTo: document.body, ...options, props });
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Monta a sanfona sob um pai que liga v-model de verdade. Passar só a prop
 * `modelValue` não é a mesma coisa: o Vue só considera o pai como autoridade
 * quando `modelValue` E `onUpdate:modelValue` estão no vnode.
 */
function montarComVModel(multiple: boolean, inicial?: string | string[]) {
  const valor = ref<string | string[] | undefined>(inicial);
  const Host = defineComponent({
    setup: () => () =>
      h(LjAccordion, {
        items: ITENS,
        multiple,
        modelValue: valor.value,
        "onUpdate:modelValue": (v: string | string[] | undefined) => {
          valor.value = v;
        },
      }),
  });
  const wrapper = mountUi(Host, { attachTo: document.body });
  montados.push(wrapper as unknown as VueWrapper);
  return { wrapper, valor };
}

function gatilhos(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".lj-accordion__trigger"));
}

function paineis(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="region"]'));
}

/** Estado de cada painel lido pela ARIA, que é o que o leitor de tela anuncia. */
const expandidos = () => gatilhos().map((g) => g.getAttribute("aria-expanded"));

function texto(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

async function clicar(el: Element) {
  (el as HTMLElement).click();
  await flushPromises();
}

async function teclar(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await flushPromises();
}

describe("LjAccordion", () => {
  it("desenha um cabeçalho com botão para cada item", () => {
    montar();

    const g = gatilhos();
    expect(g).toHaveLength(3);
    expect(g.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    // Sem type=button um cabeçalho dentro de <form> submeteria o formulário.
    expect(g.map((el) => el.getAttribute("type"))).toEqual(["button", "button", "button"]);
    expect(g.map(texto)).toEqual(["Hinário", "Corais", "Infantil"]);
  });

  it("envolve cada gatilho num título, para o leitor de tela navegar por seções", () => {
    montar();

    const titulos = Array.from(document.querySelectorAll("h3"));
    expect(titulos).toHaveLength(3);
    expect(titulos.map((t) => t.querySelector(".lj-accordion__trigger") !== null)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("o gatilho carrega a ARIA de sanfona e aponta para o painel que comanda", async () => {
    montar();

    expect(expandidos()).toEqual(["false", "false", "false"]);

    await clicar(gatilhos()[1]);

    expect(expandidos()).toEqual(["false", "true", "false"]);

    const [gatilho, painel] = [gatilhos()[1], paineis()[1]];
    expect(gatilho.getAttribute("aria-controls")).toBe(painel.id);
    expect(painel.getAttribute("aria-labelledby")).toBe(gatilho.id);
    expect(gatilho.id).toBeTruthy();
    expect(painel.id).toBeTruthy();
    expect(painel.getAttribute("role")).toBe("region");
  });

  it("o painel fechado fica escondido e o aberto, visível", async () => {
    montar({ slots: { content: "<p>lista de álbuns</p>" } });

    expect(paineis().map((p) => p.hasAttribute("hidden"))).toEqual([true, true, true]);

    await clicar(gatilhos()[0]);

    expect(paineis().map((p) => p.hasAttribute("hidden"))).toEqual([false, true, true]);
  });

  it("clicar abre; clicar de novo fecha", async () => {
    montar();

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["true", "false", "false"]);

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("com collapsible=false o painel aberto não fecha no clique", async () => {
    montar({ props: { collapsible: false } });

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["true", "false", "false"]);

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["true", "false", "false"]);
  });

  it("no modo de um painel só, abrir o seguinte fecha o anterior", async () => {
    montar();

    await clicar(gatilhos()[0]);
    await clicar(gatilhos()[2]);

    expect(expandidos()).toEqual(["false", "false", "true"]);
  });

  it("no modo multiple, abrir o seguinte mantém o anterior aberto", async () => {
    montar({ props: { multiple: true } });

    await clicar(gatilhos()[0]);
    await clicar(gatilhos()[2]);

    expect(expandidos()).toEqual(["true", "false", "true"]);

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["false", "false", "true"]);
  });

  it("emite o valor do painel aberto e undefined quando ele fecha", async () => {
    const w = montar();

    await clicar(gatilhos()[1]);
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["corais"]);

    await clicar(gatilhos()[1]);
    expect(w.emitted("update:modelValue")?.[1]).toEqual([undefined]);
  });

  it("emite a lista inteira de abertos no modo multiple", async () => {
    const w = montar({ props: { multiple: true } });

    await clicar(gatilhos()[0]);
    await clicar(gatilhos()[2]);
    await clicar(gatilhos()[0]);

    expect(w.emitted("update:modelValue")).toEqual([
      [["hinario"]],
      [["hinario", "infantil"]],
      [["infantil"]],
    ]);
  });

  it("abre o painel que o modelValue indica, e acompanha quando ele muda por fora", async () => {
    const w = montar({ props: { modelValue: "corais" } });
    expect(expandidos()).toEqual(["false", "true", "false"]);

    await w.setProps({ modelValue: "infantil" });
    expect(expandidos()).toEqual(["false", "false", "true"]);

    await w.setProps({ modelValue: undefined });
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("abre todos os painéis que o modelValue de multiple lista", async () => {
    const w = montar({ props: { multiple: true, modelValue: ["hinario", "infantil"] } });
    expect(expandidos()).toEqual(["true", "false", "true"]);

    await w.setProps({ modelValue: [] });
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("v-model de um painel só: o pai manda, e a sanfona segue", async () => {
    const { valor } = montarComVModel(false);

    await clicar(gatilhos()[1]);
    expect(valor.value).toBe("corais");
    expect(expandidos()).toEqual(["false", "true", "false"]);

    await clicar(gatilhos()[2]);
    expect(valor.value).toBe("infantil");
    expect(expandidos()).toEqual(["false", "false", "true"]);

    await clicar(gatilhos()[2]);
    expect(valor.value).toBeUndefined();
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("v-model de vários painéis: a lista cresce e encolhe conforme os cliques", async () => {
    const { valor } = montarComVModel(true, []);

    await clicar(gatilhos()[0]);
    expect(valor.value).toEqual(["hinario"]);

    await clicar(gatilhos()[1]);
    expect(valor.value).toEqual(["hinario", "corais"]);
    expect(expandidos()).toEqual(["true", "true", "false"]);

    await clicar(gatilhos()[0]);
    expect(valor.value).toEqual(["corais"]);
    expect(expandidos()).toEqual(["false", "true", "false"]);
  });

  it("v-model que só chega depois do primeiro render continua mandando", async () => {
    const { valor } = montarComVModel(true);
    expect(expandidos()).toEqual(["false", "false", "false"]);

    valor.value = ["infantil"];
    await flushPromises();
    expect(expandidos()).toEqual(["false", "false", "true"]);

    await clicar(gatilhos()[0]);
    expect(valor.value).toEqual(["infantil", "hinario"]);
  });

  /**
   * Quem liga v-model é a autoridade: se o pai ignorar o evento, o painel não
   * pode se abrir por conta própria — senão a tela e o estado divergem.
   */
  it("com v-model ligado e o pai ignorando o evento, nada se move", async () => {
    const espia = vi.fn();
    montar({ props: { modelValue: "hinario", "onUpdate:modelValue": espia } });

    await clicar(gatilhos()[1]);

    expect(espia).toHaveBeenCalledWith("corais");
    expect(expandidos()).toEqual(["true", "false", "false"]);
  });

  it("o conteúdo do painel só existe quando ele está aberto", async () => {
    montar({ slots: { corais: "<p>Coral Jovem</p>" } });

    expect(document.body.textContent).not.toContain("Coral Jovem");

    await clicar(gatilhos()[1]);
    expect(texto(paineis()[1])).toBe("Coral Jovem");

    await clicar(gatilhos()[1]);
    expect(document.body.textContent).not.toContain("Coral Jovem");
  });

  it("cada slot nomeado pelo valor do item cai no painel daquele item", async () => {
    montar({
      props: { multiple: true, modelValue: ["hinario", "corais"] },
      slots: {
        hinario: "<span>Hinário 1996</span>",
        corais: "<span>Coral Jovem</span>",
      },
    });
    await flushPromises();

    expect(texto(paineis()[0])).toBe("Hinário 1996");
    expect(texto(paineis()[1])).toBe("Coral Jovem");
  });

  it("o slot content atende os itens sem slot próprio e recebe o item", async () => {
    montar({
      props: { multiple: true, modelValue: ["hinario", "corais"] },
      slots: {
        hinario: "<span>próprio</span>",
        content: ({ item, index }: { item: LjAccordionItem; index: number }) =>
          h("span", `${index}:${item.label}`),
      },
    });
    await flushPromises();

    expect(texto(paineis()[0])).toBe("próprio");
    expect(texto(paineis()[1])).toBe("1:Corais");
  });

  it("item desabilitado se anuncia como tal e não abre", async () => {
    montar({ props: { items: [ITENS[0], { ...ITENS[1], disabled: true }, ITENS[2]] } });

    const g = gatilhos();
    expect(g.map((el) => el.getAttribute("aria-disabled"))).toEqual([null, "true", null]);
    expect(g.map((el) => el.hasAttribute("disabled"))).toEqual([false, true, false]);

    await clicar(g[1]);
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("sanfona desabilitada não abre nenhum painel", async () => {
    montar({ props: { disabled: true } });

    expect(gatilhos().map((el) => el.hasAttribute("disabled"))).toEqual([true, true, true]);

    await clicar(gatilhos()[0]);
    expect(expandidos()).toEqual(["false", "false", "false"]);
  });

  it("as setas movem o foco entre os cabeçalhos e pulam os desabilitados", async () => {
    montar({ props: { items: [ITENS[0], { ...ITENS[1], disabled: true }, ITENS[2]] } });

    gatilhos()[0].focus();
    await teclar(gatilhos()[0], "ArrowDown");
    expect(document.activeElement).toBe(gatilhos()[2]);

    await teclar(gatilhos()[2], "ArrowUp");
    expect(document.activeElement).toBe(gatilhos()[0]);

    await teclar(gatilhos()[0], "End");
    expect(document.activeElement).toBe(gatilhos()[2]);
  });

  it("mostra a seta de todos os gatilhos e o ícone só de quem pediu", () => {
    const w = montar();

    const icones = w.findAllComponents(Icon);
    expect(icones.map((i) => i.props("icon"))).toEqual([
      "chevron-right",
      "chevron-right",
      "music",
      "chevron-right",
    ]);
  });

  it("flush tira a moldura externa", () => {
    expect(montar().classes()).not.toContain("lj-accordion--flush");
    expect(montar({ props: { flush: true } }).classes()).toContain("lj-accordion--flush");
  });

  it("não quebra com a lista de itens vazia", () => {
    const w = montar({ props: { items: [] } });

    expect(gatilhos()).toHaveLength(0);
    expect(w.find(".lj-accordion").exists()).toBe(true);
  });
});

/**
 * O componente usa `defineModel`, e não o par computed/ref-interno que o
 * LjTabs adota. A diferença só aparece num caso: v-model ligado, valor inicial
 * indefinido e o pai não devolvendo o evento. Com o padrão do LjTabs a sanfona
 * abre na tela enquanto o estado do pai continua indefinido — tela e modelo
 * divergem, e nenhum outro caso desta suíte acusa isso.
 */
describe("LjAccordion — v-model sem valor inicial", () => {
  it("não abre na tela quando o pai recusa a mudança", async () => {
    const recusado: unknown[] = [];
    const Host = defineComponent({
      setup: () => () =>
        h(LjAccordion, {
          items: ITENS,
          modelValue: undefined,
          "onUpdate:modelValue": (v: unknown) => recusado.push(v),
        }),
    });
    const w = mountUi(Host, { attachTo: document.body });
    montados.push(w as unknown as VueWrapper);

    const gatilho = document.body.querySelectorAll<HTMLElement>(".lj-accordion__trigger")[0];
    gatilho.click();
    await flushPromises();

    expect(recusado).toEqual(["hinario"]);
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
  });
});
