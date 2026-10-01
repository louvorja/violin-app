import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjContextMenu from "../LjContextMenu.vue";
import type { LjMenuItem } from "../LjMenu.vue";
import { mountUi } from "./mountUi";

/** Como no LjMenu, o conteúdo vai para um portal: os asserts olham o `document`. */

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()!.unmount();
  document.body.innerHTML = "";
});

const flush = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

function mountMenu(items: LjMenuItem[]) {
  const wrapper = mountUi(LjContextMenu, {
    attachTo: document.body,
    props: { items },
    slots: { default: () => h("div", { class: "alvo" }, "Arquivo") },
    global: { stubs: { Icon: true } },
  });
  montados.push(wrapper as unknown as VueWrapper);
  return document.querySelector(".alvo") as HTMLElement;
}

const openAt = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }));

describe("LjContextMenu", () => {
  it("fica fechado até o clique direito no elemento", async () => {
    const alvo = mountMenu([{ label: "Reproduzir", action: () => {} }]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    openAt(alvo);
    await flush();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Reproduzir");
  });

  it("escolher um item chama a ação dele", async () => {
    const action = vi.fn();
    const alvo = mountMenu([{ label: "Detalhes", action }]);
    openAt(alvo);
    await flush();
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.includes("Detalhes")
    ) as HTMLElement;
    item.click();
    await flush();
    expect(action).toHaveBeenCalledOnce();
  });
});
