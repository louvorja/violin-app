import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import LjPopover from "../LjPopover.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/**
 * O painel é posicionado pelo floating-ui, que observa o tamanho dos elementos.
 * O jsdom não tem ResizeObserver — sem este dublê nenhum popover chega a abrir.
 * Ele não mede nada; só evita o crash.
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
 * O painel sai do wrapper por um portal e o Reka registra listeners no
 * documento. Desmontar antes de limpar o body evita que um host sobrevivente
 * mexa num DOM que já não existe.
 */
const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

type Props = {
  title?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

/** Ancora no body porque o conteúdo é teletransportado para fora do wrapper. */
function montar(props: Props = {}, locale: "pt" | "es" = "pt") {
  const wrapper = mountUi(
    LjPopover,
    {
      attachTo: document.body,
      props,
      slots: {
        trigger: () => h("button", { type: "button" }, "Formatar"),
        default: () => h("div", { "data-test": "corpo" }, "tamanho da letra"),
      },
      global: { stubs: { Icon: true } },
    },
    locale
  );
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}

/** O gatilho é o próprio elemento do slot (as-child). */
function gatilho(): HTMLElement {
  const el = document.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
  if (!el) throw new Error("gatilho do popover não encontrado no documento");
  return el;
}

function painel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".lj-popover");
}

function botaoFechar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".lj-popover__close");
}

/** Deixa o Reka concluir portal, posicionamento e foco. */
async function assentar() {
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  await new Promise((r) => setTimeout(r, 20));
}

async function abrir() {
  gatilho().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await assentar();
}

describe("LjPopover", () => {
  it("usa o elemento do slot como gatilho, sem embrulhar em outro", () => {
    montar({ title: "Formatação" });

    const botoes = document.body.querySelectorAll("button");
    expect(botoes).toHaveLength(1);
    expect(botoes[0].textContent).toBe("Formatar");
    expect(botoes[0].getAttribute("aria-haspopup")).toBe("dialog");
    expect(botoes[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("não monta o conteúdo enquanto está fechado", () => {
    montar({ title: "Formatação" });

    expect(painel()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("tamanho da letra");
  });

  it("abre no clique do gatilho e mostra o conteúdo", async () => {
    montar({ title: "Formatação" });
    await abrir();

    expect(painel()).not.toBeNull();
    expect(painel()?.textContent).toContain("tamanho da letra");
    expect(gatilho().getAttribute("aria-expanded")).toBe("true");
  });

  it("o painel aberto é um diálogo ligado ao gatilho", async () => {
    montar({ title: "Formatação" });
    await abrir();

    expect(painel()?.getAttribute("role")).toBe("dialog");
    expect(gatilho().getAttribute("aria-controls")).toBe(painel()?.id);
  });

  it("o painel tem nome acessível apontando para um elemento existente", async () => {
    montar({ title: "Formatação" });
    await abrir();

    const id = painel()?.getAttribute("aria-labelledby");
    expect(id).toBeTruthy();
    const rotulo = document.getElementById(id as string);
    expect(rotulo).not.toBeNull();
    expect(rotulo?.textContent?.trim()).not.toBe("");
  });

  it("o conteúdo é teletransportado para fora do wrapper", async () => {
    const w = montar({ title: "Formatação" });
    await abrir();

    const painelAberto = painel();
    expect(painelAberto).not.toBeNull();
    expect(document.body.contains(painelAberto)).toBe(true);
    expect(w.element.contains(painelAberto as Node)).toBe(false);
  });

  it("mostra o título quando informado", async () => {
    montar({ title: "Formatação" });
    await abrir();

    expect(document.querySelector(".lj-popover__title")?.textContent).toBe("Formatação");
  });

  it("sem título não há cabeçalho nem botão de fechar", async () => {
    montar();
    await abrir();

    expect(document.querySelector(".lj-popover__header")).toBeNull();
    expect(botaoFechar()).toBeNull();
    expect(painel()?.textContent).toContain("tamanho da letra");
  });

  it("o botão de fechar fecha o painel", async () => {
    montar({ title: "Formatação" });
    await abrir();

    const fechar = botaoFechar();
    expect(fechar?.tagName).toBe("BUTTON");
    // type=button: dentro de um <form> um botão sem type submeteria o formulário.
    expect(fechar?.getAttribute("type")).toBe("button");

    fechar?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await assentar();

    expect(painel()).toBeNull();
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
  });

  it("o botão de fechar se chama Fechar em PT", async () => {
    expectKeyExists("actions.close");
    montar({ title: "Formatação" }, "pt");
    await abrir();

    expect(botaoFechar()?.getAttribute("aria-label")).toBe("Fechar");
  });

  it("o botão de fechar se chama Cerrar em ES", async () => {
    expectKeyExists("actions.close");
    montar({ title: "Formato" }, "es");
    await abrir();

    expect(botaoFechar()?.getAttribute("aria-label")).toBe("Cerrar");
  });

  it("Escape fecha o painel", async () => {
    montar({ title: "Formatação" });
    await abrir();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    await assentar();

    expect(painel()).toBeNull();
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
  });

  it("clique fora fecha o painel", async () => {
    montar({ title: "Formatação" });
    await abrir();

    const fora = document.createElement("button");
    document.body.appendChild(fora);
    fora.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
      })
    );
    await assentar();

    expect(painel()).toBeNull();
    expect(gatilho().getAttribute("aria-expanded")).toBe("false");
  });

  it("leva o foco para dentro do painel ao abrir", async () => {
    montar({ title: "Formatação" });
    await abrir();

    expect(document.activeElement).not.toBe(gatilho());
    expect(painel()?.contains(document.activeElement)).toBe(true);
  });

  it("volta a mostrar o conteúdo quando reabre", async () => {
    montar({ title: "Formatação" });
    await abrir();
    botaoFechar()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await assentar();
    expect(painel()).toBeNull();

    await abrir();
    expect(painel()?.textContent).toContain("tamanho da letra");
  });

  it("respeita o lado e o alinhamento informados", async () => {
    montar({ title: "Formatação", side: "right", align: "end" });
    await abrir();

    expect(painel()?.getAttribute("data-side")).toBe("right");
    expect(painel()?.getAttribute("data-align")).toBe("end");
  });

  it("abre embaixo e alinhado ao início quando não é informado", async () => {
    montar({ title: "Formatação" });
    await abrir();

    expect(painel()?.getAttribute("data-side")).toBe("bottom");
    expect(painel()?.getAttribute("data-align")).toBe("start");
  });
});

/*
 * Fora do alcance do jsdom (não vale escrever teste falso):
 * - Posicionamento real (side/align viram só data-attrs; sem layout não há
 *   colisão, flip nem sideOffset de 4px para medir).
 * - Devolução do foco ao gatilho ao fechar: no jsdom o foco cai no <body>.
 * - LjPopover não expõe `size` nem `v-model:open` — o estado aberto é um ref
 *   interno, então não há contrato de tamanho nem de modelo para testar.
 */
