import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjMenu, { type LjMenuItem } from "../LjMenu.vue";
import { mountUi } from "./mountUi";

/**
 * O conteúdo do LjMenu é teleportado para fora do wrapper (portal do Reka UI),
 * então todo assert olha para o `document`, não para o wrapper. As interações
 * também são despachadas direto no DOM: o menu aberto não pertence à árvore do
 * componente montado.
 */

const montados: VueWrapper[] = [];

afterEach(() => {
  // Desmontar antes de limpar o body: o portal do menu vive fora da árvore do
  // wrapper e o Vue precisa do DOM intacto para removê-lo.
  while (montados.length) montados.pop()!.unmount();
  document.body.innerHTML = "";
});

const flush = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

const clickOn = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

const pressKey = (target: EventTarget, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

function mountMenu(items: LjMenuItem[], props: Record<string, unknown> = {}) {
  const wrapper = mountUi(LjMenu, {
    attachTo: document.body,
    props: { items, ...props },
    slots: { trigger: () => h("button", { type: "button" }, "Abrir menu") },
    global: { stubs: { Icon: true } },
  });
  montados.push(wrapper as unknown as VueWrapper);
  return { wrapper, trigger: document.querySelector("button") as HTMLButtonElement };
}

const menu = () => document.querySelector('[role="menu"]');
const itemsOf = (role = "menuitem") => Array.from(document.querySelectorAll(`[role="${role}"]`));
const byText = (text: string, role = "menuitem") =>
  itemsOf(role).find((el) => el.textContent?.includes(text));

describe("LjMenu", () => {
  it("não renderiza o conteúdo do menu enquanto está fechado", () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    expect(trigger).toBeTruthy();
    expect(menu()).toBeNull();
    expect(document.body.textContent).not.toContain("Projetar");
  });

  it("o gatilho anuncia que abre um menu e reflete o estado aberto", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    clickOn(trigger);
    await flush();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu()).not.toBeNull();
  });

  it("abre pelo teclado com ArrowDown", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    pressKey(trigger, "ArrowDown");
    await flush();
    expect(menu()).not.toBeNull();
  });

  it("o menu aberto é rotulado pelo próprio gatilho", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    clickOn(trigger);
    await flush();
    expect(menu()?.getAttribute("aria-labelledby")).toBe(trigger.id);
  });

  it("item marcável expõe role menuitemcheckbox e aria-checked", async () => {
    const { trigger } = mountMenu([
      { label: "Mostrar letra", checked: true, action: () => {} },
      { label: "Mostrar acordes", checked: false, action: () => {} },
      { label: "Fechar", action: () => {} },
    ]);
    clickOn(trigger);
    await flush();

    const marcado = byText("Mostrar letra", "menuitemcheckbox");
    const desmarcado = byText("Mostrar acordes", "menuitemcheckbox");
    expect(marcado?.getAttribute("aria-checked")).toBe("true");
    expect(desmarcado?.getAttribute("aria-checked")).toBe("false");

    // Item sem estado marcável segue menuitem simples, sem aria-checked
    // inventando uma seleção que não existe.
    const simples = byText("Fechar");
    expect(simples).toBeTruthy();
    expect(simples?.hasAttribute("aria-checked")).toBe(false);
  });

  it("seleção não vive só no ícone: a marca chega ao leitor de tela", async () => {
    const { trigger } = mountMenu([{ label: "Repetir", checked: true, action: () => {} }]);
    clickOn(trigger);
    await flush();

    const item = byText("Repetir", "menuitemcheckbox");
    expect(item).toBeTruthy();
    // A marca visual é decorativa; quem carrega o estado é o aria-checked.
    expect(item?.getAttribute("aria-checked")).toBe("true");
    expect(itemsOf("menuitem")).toHaveLength(0);
  });

  it("separador e rótulo de seção não viram item clicável", async () => {
    const { trigger } = mountMenu([
      { label: "Ações" },
      { label: "Editar", action: () => {} },
      { separator: true },
      { label: "Excluir", action: () => {} },
    ]);
    clickOn(trigger);
    await flush();

    expect(itemsOf("menuitem")).toHaveLength(2);

    const separadores = Array.from(document.querySelectorAll('[role="separator"]'));
    expect(separadores).toHaveLength(1);
    expect(separadores[0].textContent?.trim()).toBe("");

    const rotulos = Array.from(document.querySelectorAll(".lj-menu__label"));
    expect(rotulos).toHaveLength(1);
    expect(rotulos[0].textContent?.trim()).toBe("Ações");
    expect(rotulos[0].hasAttribute("role")).toBe(false);
  });

  it("chama a ação do item e fecha o menu ao selecionar", async () => {
    const action = vi.fn();
    const { trigger } = mountMenu([{ label: "Projetar", action }]);
    clickOn(trigger);
    await flush();

    clickOn(byText("Projetar")!);
    await flush();

    expect(action).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("chama a ação do item marcável ao selecionar", async () => {
    const action = vi.fn();
    const { trigger } = mountMenu([{ label: "Tela cheia", checked: false, action }]);
    clickOn(trigger);
    await flush();

    clickOn(byText("Tela cheia", "menuitemcheckbox")!);
    await flush();

    expect(action).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("item desabilitado se anuncia como tal, não dispara a ação e não fecha o menu", async () => {
    const action = vi.fn();
    const { trigger } = mountMenu([{ label: "Indisponível", disabled: true, action }]);
    clickOn(trigger);
    await flush();

    const item = byText("Indisponível")!;
    expect(item.getAttribute("aria-disabled")).toBe("true");

    clickOn(item);
    await flush();

    expect(action).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it("a marca de seleção é controlada de fora: selecionar não a inverte sozinha", async () => {
    const action = vi.fn();
    const { trigger } = mountMenu([{ label: "Repetir", checked: true, action }]);
    clickOn(trigger);
    await flush();
    clickOn(byText("Repetir", "menuitemcheckbox")!);
    await flush();

    clickOn(trigger);
    await flush();

    expect(byText("Repetir", "menuitemcheckbox")?.getAttribute("aria-checked")).toBe("true");
  });

  it("acompanha o estado marcável quando os itens mudam", async () => {
    const { wrapper, trigger } = mountMenu([
      { label: "Repetir", checked: false, action: () => {} },
    ]);
    clickOn(trigger);
    await flush();
    expect(byText("Repetir", "menuitemcheckbox")?.getAttribute("aria-checked")).toBe("false");

    await wrapper.setProps({ items: [{ label: "Repetir", checked: true, action: () => {} }] });
    await flush();

    expect(byText("Repetir", "menuitemcheckbox")?.getAttribute("aria-checked")).toBe("true");
  });

  it("fecha no Escape", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    clickOn(trigger);
    await flush();
    expect(menu()).not.toBeNull();

    pressKey(document, "Escape");
    await flush();

    expect(menu()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("mostra dica e atalho do item", async () => {
    const { trigger } = mountMenu([
      { label: "Salvar", hint: "somente esta liturgia", shortcut: "Ctrl+S", action: () => {} },
    ]);
    clickOn(trigger);
    await flush();

    const item = byText("Salvar")!;
    expect(item.textContent).toContain("somente esta liturgia");
    expect(item.querySelector("kbd")?.textContent).toBe("Ctrl+S");
  });

  it("encaminha lado e alinhamento pedidos para o conteúdo", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }], {
      side: "top",
      align: "end",
    });
    clickOn(trigger);
    await flush();

    expect(menu()?.getAttribute("data-side")).toBe("top");
    expect(menu()?.getAttribute("data-align")).toBe("end");
  });

  it("usa baixo/início quando lado e alinhamento não são informados", async () => {
    const { trigger } = mountMenu([{ label: "Projetar", action: () => {} }]);
    clickOn(trigger);
    await flush();

    expect(menu()?.getAttribute("data-side")).toBe("bottom");
    expect(menu()?.getAttribute("data-align")).toBe("start");
  });

  it("conteúdo do slot padrão vai para dentro do menu", async () => {
    const wrapper = mountUi(LjMenu, {
      attachTo: document.body,
      props: { items: [{ label: "Projetar", action: () => {} }] },
      slots: {
        trigger: () => h("button", { type: "button" }, "Abrir menu"),
        default: () => h("div", { "data-test": "extra" }, "Conteúdo livre"),
      },
      global: { stubs: { Icon: true } },
    });
    montados.push(wrapper as unknown as VueWrapper);
    clickOn(document.querySelector("button")!);
    await flush();

    const extra = document.querySelector('[data-test="extra"]');
    expect(extra).not.toBeNull();
    expect(menu()?.contains(extra!)).toBe(true);
  });

  it("menu sem itens ainda abre e continua sendo um menu", async () => {
    const { trigger } = mountMenu([]);
    clickOn(trigger);
    await flush();

    expect(menu()).not.toBeNull();
    expect(itemsOf("menuitem")).toHaveLength(0);
  });
});
