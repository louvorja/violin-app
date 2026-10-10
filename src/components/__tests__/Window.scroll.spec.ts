import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Window from "../Window.vue";

vi.mock("@/components/ui", () => ({ LjIcon: { template: "<span />" } }));
vi.mock("@/composables/useViewport", async () => {
  const { ref } = await import("vue");
  return { useViewport: () => ({ width: ref(1024), height: ref(768) }) };
});

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function openWindow() {
  const onError = vi.fn();
  wrapper = mount(Window, {
    attachTo: document.body,
    props: { modelValue: true, title: "Rolagem" },
    slots: { default: "Conteúdo da janela" },
    global: { config: { errorHandler: onError } },
  });
  await nextTick();
  return { window: wrapper, onError };
}

function scrollElement(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(".lj-window-main");
  expect(element).not.toBeNull();
  return element!;
}

describe("Window — eventos de rolagem", () => {
  it("mantém o payload com as métricas do conteúdo visível", async () => {
    const { window, onError } = await openWindow();
    const element = scrollElement();
    Object.defineProperties(element, {
      scrollTop: { value: 120, configurable: true },
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 900, configurable: true },
    });

    element.dispatchEvent(new Event("scroll"));

    expect(window.emitted("scroll")).toEqual([
      [{ scroll_top: 120, client_height: 300, scroll_height: 900, scroll_bottom: 480 }],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignora um scroll tardio do elemento desmontado ao fechar o diálogo", async () => {
    const { window, onError } = await openWindow();
    const element = scrollElement();
    await window.setProps({ modelValue: false });
    await flushPromises();
    await nextTick();
    expect(element.isConnected).toBe(false);

    // Um evento já enfileirado pelo navegador ainda pode alcançar o listener
    // do nó antigo, depois de o Vue ter limpado a referência de template.
    element.dispatchEvent(new Event("scroll"));

    expect(onError).not.toHaveBeenCalled();
    expect(window.emitted("scroll")).toBeUndefined();
  });
});
