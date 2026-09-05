import { afterEach, describe, expect, it } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { TabsContent } from "reka-ui";
import Icon from "@/components/Icon.vue";
import LjChip from "../LjChip.vue";
import LjTabs, { type LjTab } from "../LjTabs.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * As abas do Reka reagem a foco e a mousedown (não a click). Focar de verdade
 * só funciona com a árvore ligada ao documento — por isso todo mount aqui vai
 * para o document.body, e as consultas são feitas no documento.
 */
const ABAS: LjTab[] = [
  { value: "geral", label: "Geral" },
  { value: "biblia", label: "Bíblia", badge: 3 },
  { value: "slides", label: "Slides", icon: "photo", badge: 0 },
];

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function montar(options: any = {}, locale: "pt" | "es" = "pt") {
  const wrapper = mountUi(LjTabs, { attachTo: document.body, ...options }, locale);
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function abas(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function texto(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

/** O Reka ativa a aba no mousedown com o botão esquerdo, não no click. */
async function clicar(el: Element) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  await nextTick();
}

async function teclar(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await nextTick();
}

const estados = () => abas().map((t) => t.getAttribute("data-state"));

describe("LjTabs", () => {
  it("renderiza uma lista de abas com um botão por aba", () => {
    montar({ props: { modelValue: "geral", tabs: ABAS } });

    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    const t = abas();
    expect(t).toHaveLength(3);
    expect(t.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    // Sem type=button uma aba dentro de <form> submeteria o formulário.
    expect(t.map((el) => el.getAttribute("type"))).toEqual(["button", "button", "button"]);
    expect(t.map(texto)).toEqual(["Geral", "Bíblia 3", "Slides 0"]);
  });

  it("nomeia a lista de abas quando o rótulo é informado, e só então", () => {
    montar({ props: { modelValue: "geral", tabs: ABAS, ariaLabel: "Seções das opções" } });
    expect(document.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
      "Seções das opções"
    );

    document.body.innerHTML = "";
    montar({ props: { modelValue: "geral", tabs: ABAS } });
    expect(document.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBeNull();
  });

  it("marca como ativa só a aba do modelValue", () => {
    montar({ props: { modelValue: "biblia", tabs: ABAS } });

    expect(estados()).toEqual(["inactive", "active", "inactive"]);
    expect(abas().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  it("segue o modelValue quando ele muda por fora", async () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });
    expect(estados()).toEqual(["active", "inactive", "inactive"]);

    await w.setProps({ modelValue: "slides" });
    expect(estados()).toEqual(["inactive", "inactive", "active"]);
  });

  it("clicar numa aba emite update:modelValue com o valor dela", async () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    await clicar(abas()[2]);

    expect(w.emitted("update:modelValue")).toHaveLength(1);
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["slides"]);
  });

  it("não troca a aba ativa por conta própria — quem manda é o v-model", async () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    await clicar(abas()[1]);
    // O pai ainda não respondeu: a aba ativa não pode ter se mexido.
    expect(estados()).toEqual(["active", "inactive", "inactive"]);

    await w.setProps({ modelValue: "biblia" });
    expect(estados()).toEqual(["inactive", "active", "inactive"]);
  });

  it("sem v-model, começa na primeira aba e a clicada assume o estado ativo", async () => {
    // Sem v-model o componente se vira sozinho — mas o TabsRoot ainda nasce com
    // um valor definido, que é o que evita ele travar em modo não controlado.
    const w = montar({ props: { tabs: ABAS } });
    expect(estados()).toEqual(["active", "inactive", "inactive"]);

    await clicar(abas()[1]);

    expect(w.emitted("update:modelValue")?.[0]).toEqual(["biblia"]);
    expect(estados()).toEqual(["inactive", "active", "inactive"]);
  });

  it("Enter na aba focada emite o valor dela", async () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    await teclar(abas()[1], "Enter");

    expect(w.emitted("update:modelValue")?.[0]).toEqual(["biblia"]);
  });

  it("seta para a direita move o foco e ativa a aba seguinte", async () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    abas()[0].focus();
    await nextTick();
    // Focar a aba já ativa não pode emitir nada.
    expect(w.emitted("update:modelValue")).toBeUndefined();

    await teclar(abas()[0], "ArrowRight");

    expect(document.activeElement).toBe(abas()[1]);
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["biblia"]);
  });

  it("mostra o badge da aba, inclusive quando é zero", () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    const selos = w.findAllComponents(LjChip);
    expect(selos).toHaveLength(2);
    expect(selos.map((c) => c.text())).toEqual(["3", "0"]);
    // Badge 0 é uma contagem legítima — some se a condição virar truthiness.
    expect(texto(abas()[2])).toBe("Slides 0");
  });

  it("aba sem badge não ganha selo", () => {
    const w = montar({
      props: { modelValue: "geral", tabs: [{ value: "geral", label: "Geral" }] },
    });

    expect(w.findAllComponents(LjChip)).toHaveLength(0);
    expect(texto(abas()[0])).toBe("Geral");
  });

  it("mostra o ícone só nas abas que pedem ícone", () => {
    const w = montar({ props: { modelValue: "geral", tabs: ABAS } });

    const icones = w.findAllComponents(Icon);
    expect(icones).toHaveLength(1);
    expect(icones[0].props("icon")).toBe("photo");
  });

  it("liga cada aba ao seu painel e mostra só o conteúdo ativo", async () => {
    montar({
      props: { modelValue: "biblia", tabs: ABAS },
      slots: {
        default: () => [
          h(TabsContent, { value: "geral" }, () => "Conteúdo Geral"),
          h(TabsContent, { value: "biblia" }, () => "Conteúdo Bíblia"),
        ],
      },
    });
    await nextTick();

    const paineis = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    expect(paineis).toHaveLength(2);

    const [geral, biblia] = paineis;
    expect(abas()[0].getAttribute("aria-controls")).toBe(geral.id);
    expect(abas()[1].getAttribute("aria-controls")).toBe(biblia.id);
    expect(geral.getAttribute("aria-labelledby")).toBe(abas()[0].id);
    expect(biblia.getAttribute("aria-labelledby")).toBe(abas()[1].id);

    expect(biblia.hasAttribute("hidden")).toBe(false);
    expect(texto(biblia)).toBe("Conteúdo Bíblia");
    expect(geral.hasAttribute("hidden")).toBe(true);
    expect(document.body.textContent).not.toContain("Conteúdo Geral");
  });

  it("não quebra quando a lista de abas está vazia", () => {
    montar({ props: { modelValue: "geral", tabs: [] } });

    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(abas()).toHaveLength(0);
  });

  /**
   * LjTabs não traduz nada por conta própria — os rótulos vêm do chamador.
   * O que estes dois casos travam é que o rótulo traduzido chega intacto até a
   * aba nos dois idiomas, sem interferência do primitivo.
   */
  function montarComRotulosTraduzidos(locale: "pt" | "es") {
    const Host = defineComponent({
      setup() {
        const { t } = useI18n({ useScope: "global" });
        return () =>
          h(LjTabs, {
            modelValue: "slides",
            tabs: [
              { value: "slides", label: t("options.slides.title") },
              { value: "storage", label: t("options.storage.title") },
            ],
          });
      },
    });
    const wrapper = mountUi(Host, { attachTo: document.body }, locale);
    montados.push(wrapper as unknown as VueWrapper);
    return wrapper;
  }

  it("mostra os rótulos traduzidos pelo chamador em PT", () => {
    expectKeyExists("options.slides.title");
    expectKeyExists("options.storage.title");
    montarComRotulosTraduzidos("pt");

    expect(abas().map(texto)).toEqual(["Slides de Músicas", "Armazenamento"]);
  });

  it("mostra os rótulos traduzidos pelo chamador em ES", () => {
    expectKeyExists("options.slides.title");
    expectKeyExists("options.storage.title");
    montarComRotulosTraduzidos("es");

    expect(abas().map(texto)).toEqual(["Diapositivas de Músicas", "Almacenamiento"]);
  });

  /**
   * Cuidado ao ler este caso: ele garante só o que afirma — que a aba passa a
   * refletir um modelValue que chega depois do primeiro render (v-model ligado
   * a um ref carregado de forma assíncrona). Ele não garante que, a partir daí,
   * o pai volte a mandar na aba ativa; ver a nota de defeito no fim do arquivo.
   */
  it("segue mandando no v-model que só chega depois do primeiro render", async () => {
    const w = montar({ props: { tabs: ABAS } });
    expect(estados()).toEqual(["active", "inactive", "inactive"]);

    await w.setProps({ modelValue: "slides" });
    await nextTick();
    expect(estados()).toEqual(["inactive", "inactive", "active"]);

    // O pai continua sendo a autoridade: se ele ignorar a troca, a aba visível
    // não pode andar sozinha.
    await clicar(abas()[1]);
    await nextTick();
    expect(estados()).toEqual(["inactive", "inactive", "active"]);
  });
});

/*
 * Fora do alcance do jsdom / do primitivo:
 *
 * - O sublinhado deslizante (.lj-tabs__indicator) nunca aparece aqui: o Reka só
 *   o renderiza depois de medir offsetWidth/offsetLeft da aba ativa e de receber
 *   um ResizeObserver. No jsdom todo elemento mede 0 e não há ResizeObserver, de
 *   modo que qualquer asserção sobre ele seria sobre o dublê, não sobre o
 *   componente. Posição e animação do traço só se verificam em navegador.
 * - Não há contrato de tamanho (sm/md/lg) nem estado desabilitado: LjTabs não
 *   expõe `size` e LjTab não tem `disabled`. Se um dia existirem, o teste de
 *   tamanho e o de aba desabilitada (não emite ao clicar, é pulada pelas setas)
 *   entram aqui.
 *
 * Defeito conhecido, deliberadamente NÃO travado por um teste (travá-lo exigiria
 * um caso vermelho): se o primeiro render acontece com modelValue undefined, o
 * TabsRoot decide ali, de uma vez, que é não controlado. Quando o v-model chega
 * depois, a aba passa a acompanhá-lo (caso acima), mas um clique volta a mexer
 * na aba ativa por conta própria — mesmo que o pai ignore o update:modelValue.
 * A partir daí a aba mostrada e o v-model podem divergir. Some se o LjTabs
 * segurar o valor (ex.: um ref interno espelhando a prop) em vez de repassar
 * undefined ao TabsRoot.
 */
