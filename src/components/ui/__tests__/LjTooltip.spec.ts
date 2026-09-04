import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type VNodeChild } from "vue";
import { useI18n } from "vue-i18n";
import { TooltipProvider } from "reka-ui";
import LjTooltip from "../LjTooltip.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * O conteúdo do tooltip é posicionado pelo floating-ui, que observa o tamanho
 * dos elementos. O jsdom não tem ResizeObserver — sem este dublê nenhum tooltip
 * chega a abrir. Ele não mede nada; só evita o crash.
 */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

/**
 * Abrir um tooltip manda todos os outros fecharem (evento global do Reka). Um
 * host de teste anterior que continuasse montado tentaria mexer num DOM que já
 * não existe — por isso o desmonte é explícito, não uma limpeza do body.
 */
const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

type Props = {
  text: string;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
};

/** Assinatura do `t` do i18n (nomes com _ por causa do lint de args não usados). */
type Traduzir = (_key: string) => string;

const gatilhoPadrao = () => h("button", { type: "button" }, "Projetar");

/**
 * LjTooltip só funciona sob um TooltipProvider (que mora no App.vue). O host
 * abaixo reproduz esse contexto e ancora tudo no document.body, porque o
 * conteúdo sai do wrapper por um portal e não fica dentro do wrapper do teste.
 *
 * `props` pode ser uma função: ela roda dentro do render, então continua
 * reativa e recebe o `t` do i18n no locale montado.
 */
function mountTooltip(
  props: Props | ((_t: Traduzir) => Props),
  options: {
    trigger?: () => VNodeChild;
    locale?: "pt" | "es";
    provider?: Record<string, unknown>;
  } = {}
) {
  const { trigger = gatilhoPadrao, locale = "pt", provider = {} } = options;

  const Host = defineComponent({
    setup() {
      const { t } = useI18n({ useScope: "global" });
      return () =>
        h(TooltipProvider, { delayDuration: 0, ...provider }, () =>
          h(LjTooltip, typeof props === "function" ? props(t) : props, { default: trigger })
        );
    },
  });

  const wrapper = mountUi(Host, { attachTo: document.body }, locale);
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}

/** O gatilho é o próprio elemento do slot (as-child). */
function gatilho(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-grace-area-trigger]");
  if (!el) throw new Error("gatilho do tooltip não encontrado no documento");
  return el;
}

/**
 * O Presence do Reka decide montar/desmontar depois de um tick próprio, então
 * um único nextTick não basta para o DOM refletir a mudança.
 */
async function assentar() {
  for (let i = 0; i < 4; i++) await nextTick();
}

/** Abre pelo foco: é o caminho instantâneo do Reka, sem depender de timers. */
async function abrirPorFoco() {
  gatilho().dispatchEvent(new FocusEvent("focus"));
  await assentar();
}

function conteudo(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".lj-tooltip");
}

/**
 * O balão carrega um duplo escondido do próprio texto (o elemento role=tooltip
 * que descreve o gatilho). Para falar do que o usuário vê, ele é descartado.
 */
function textoVisivel(): string {
  const el = conteudo();
  if (!el) return "";
  const copia = el.cloneNode(true) as HTMLElement;
  copia.querySelector('[role="tooltip"]')?.remove();
  return (copia.textContent || "").replace(/\s+/g, " ").trim();
}

describe("LjTooltip", () => {
  it("usa o elemento do slot como gatilho, sem embrulhar em outro", () => {
    mountTooltip({ text: "Projetar na tela principal" });

    const botoes = document.body.querySelectorAll("button");
    expect(botoes).toHaveLength(1);
    expect(botoes[0].textContent).toBe("Projetar");
    expect(botoes[0].hasAttribute("data-grace-area-trigger")).toBe(true);
  });

  it("não mostra o texto enquanto está fechado", () => {
    mountTooltip({ text: "Projetar na tela principal" });

    expect(conteudo()).toBeNull();
    expect(document.body.textContent).not.toContain("Projetar na tela principal");
  });

  it("mostra o texto quando o gatilho recebe foco pelo teclado", async () => {
    mountTooltip({ text: "Projetar na tela principal" });
    await abrirPorFoco();

    expect(conteudo()?.textContent).toContain("Projetar na tela principal");
  });

  it("esconde o texto quando o gatilho perde o foco", async () => {
    mountTooltip({ text: "Projetar na tela principal" });
    await abrirPorFoco();
    expect(conteudo()).not.toBeNull();

    gatilho().dispatchEvent(new FocusEvent("blur"));
    await assentar();

    expect(conteudo()).toBeNull();
  });

  it("fecha no Escape", async () => {
    mountTooltip({ text: "Projetar na tela principal" });
    await abrirPorFoco();
    expect(conteudo()).not.toBeNull();

    gatilho().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await assentar();

    expect(conteudo()).toBeNull();
  });

  it("mostra o atalho quando informado", async () => {
    mountTooltip({ text: "Projetar", shortcut: "F5" });
    await abrirPorFoco();

    const kbd = conteudo()?.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toBe("F5");
    expect(textoVisivel()).toBe("Projetar F5");
  });

  it("não inventa atalho quando não é informado", async () => {
    mountTooltip({ text: "Projetar" });
    await abrirPorFoco();

    expect(conteudo()?.querySelector("kbd")).toBeNull();
  });

  it("acompanha a troca do texto com o tooltip aberto", async () => {
    // Caso real do ShellTools: o rótulo alterna entre Ativar/Desativar.
    const texto = ref("Ativar projeção de fundo");
    mountTooltip(() => ({ text: texto.value }));
    await abrirPorFoco();
    expect(textoVisivel()).toBe("Ativar projeção de fundo");

    texto.value = "Desativar projeção de fundo";
    await assentar();

    expect(textoVisivel()).toBe("Desativar projeção de fundo");
  });

  it("descreve o gatilho por um elemento com papel de tooltip", async () => {
    mountTooltip({ text: "Alternar tema" });
    await abrirPorFoco();

    const id = gatilho().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const descricao = document.getElementById(id as string);
    expect(descricao?.getAttribute("role")).toBe("tooltip");
    expect(descricao?.textContent).toContain("Alternar tema");
  });

  it("não descreve o gatilho enquanto está fechado", () => {
    mountTooltip({ text: "Alternar tema" });

    expect(gatilho().getAttribute("aria-describedby")).toBeNull();
  });

  it("abre no lado pedido", async () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      mountTooltip({ text: "Projetar", side });
      await abrirPorFoco();
      expect(conteudo()?.getAttribute("data-side")).toBe(side);

      montados.pop()?.unmount();
      document.body.innerHTML = "";
    }
  });

  it("abre em cima quando o lado não é informado", async () => {
    mountTooltip({ text: "Projetar" });
    await abrirPorFoco();

    expect(conteudo()?.getAttribute("data-side")).toBe("top");
  });

  it("mostra o rótulo traduzido pelo chamador em PT", async () => {
    expectKeyExists("shell.quick_search");
    mountTooltip((t) => ({ text: t("shell.quick_search") }), { locale: "pt" });
    await abrirPorFoco();

    expect(conteudo()?.textContent).toContain("Busca rápida (Ctrl+K)");
  });

  it("mostra o rótulo traduzido pelo chamador em ES", async () => {
    expectKeyExists("shell.quick_search");
    mountTooltip((t) => ({ text: t("shell.quick_search") }), { locale: "es" });
    await abrirPorFoco();

    expect(conteudo()?.textContent).toContain("Búsqueda rápida (Ctrl+K)");
  });

  it("espera o delay informado antes de abrir pelo ponteiro", async () => {
    vi.useFakeTimers();
    try {
      // O provider pede 5s; o delay do componente é que vale.
      mountTooltip({ text: "Projetar", delay: 400 }, { provider: { delayDuration: 5000 } });

      gatilho().dispatchEvent(new Event("pointermove"));
      await nextTick();
      expect(conteudo()).toBeNull();

      vi.advanceTimersByTime(399);
      await nextTick();
      expect(conteudo()).toBeNull();

      vi.advanceTimersByTime(1);
      await assentar();
      expect(conteudo()?.textContent).toContain("Projetar");
    } finally {
      vi.useRealTimers();
    }
  });

  it("usa 400ms de delay quando não é informado", async () => {
    vi.useFakeTimers();
    try {
      mountTooltip({ text: "Projetar" }, { provider: { delayDuration: 5000 } });

      gatilho().dispatchEvent(new Event("pointermove"));
      vi.advanceTimersByTime(399);
      await nextTick();
      expect(conteudo()).toBeNull();

      vi.advanceTimersByTime(1);
      await assentar();
      expect(conteudo()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * Fora do alcance do jsdom, de propósito:
 *
 * - Aparência do balão (fundo, borda e cor vindos de --lj-ui-tooltip-*): o
 *   jsdom não carrega o CSS do componente nem resolve custom properties, então
 *   asserção de cor seria teatro. O que dá para travar — o gatilho receber o
 *   slot, o texto aparecer ao abrir e o atalho aparecer quando informado — está
 *   coberto acima.
 * - Posição real do balão (offset de 5px, colisão com a borda da tela): sem
 *   layout, todo getBoundingClientRect é zero e o floating-ui não tem o que
 *   calcular. Só o lado pedido (data-side) é verificável.
 * - Fechar ao mover o ponteiro para fora passando pela "grace area": depende de
 *   coordenadas reais de ponteiro e das medidas dos elementos.
 *
 * Defeito visto de fora e não consertado aqui: se o `text` muda com o balão
 * aberto, o texto visível acompanha, mas o elemento role=tooltip que descreve o
 * gatilho continua com o rótulo antigo — o Reka lê o textContent uma única vez
 * ao montar o conteúdo. Quem usa leitor de tela ouve o rótulo velho até o
 * tooltip fechar e abrir de novo. Está descrito aqui em vez de virar um teste
 * vermelho; o teste acima trava o comportamento que hoje é correto.
 */
