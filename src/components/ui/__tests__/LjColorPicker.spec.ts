import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { ColorFieldRoot } from "reka-ui";
import LjColorPicker from "../LjColorPicker.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/** O Slider do Reka (matiz) mede o thumb com ResizeObserver, ausente no jsdom. */
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver = g.ResizeObserver || ResizeObserverStub;
  /* O Listbox rola até o item destacado; no jsdom só precisa existir. */
  Element.prototype.scrollIntoView = () => {};
});

const PRESETS = ["#4CAF50", "#2196F3", "#F44336"];

const montados: VueWrapper[] = [];

function montar(options: Record<string, unknown> = {}) {
  const wrapper = mountUi(LjColorPicker, {
    props: { modelValue: "#4caf50", presets: PRESETS, ...options },
  }) as VueWrapper;
  montados.push(wrapper);
  return wrapper;
}

const painel = (wrapper: VueWrapper) => wrapper.find('[id^="v-"]');
const gatilhoPersonalizado = (wrapper: VueWrapper) =>
  wrapper.findAll("button").find((botao) => botao.text().includes("Personalizada"))!;

const ultimoValor = (wrapper: VueWrapper) => {
  const eventos = wrapper.emitted("update:modelValue") as unknown[][] | undefined;
  return eventos?.at(-1)?.[0];
};

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
});

describe("LjColorPicker", () => {
  it("lista as cores rápidas com o item atual marcado", () => {
    const wrapper = montar();
    expect(wrapper.findAll("[data-color]")).toHaveLength(PRESETS.length);
    expect(wrapper.find('[data-color="#4caf50"]').classes()).toContain("is-active");
    /* O listbox do Reka continua sendo o contêiner focável da lista. */
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    expect(wrapper.find('[role="listbox"]').attributes("aria-label")).toBe("Cores");
    expect(wrapper.find(".lj-color-picker__presets").exists()).toBe(true);
  });

  it("clique numa cor rápida devolve o hex no v-model", async () => {
    const wrapper = montar();
    await wrapper.find('[data-color="#2196f3"]').trigger("click");
    expect(ultimoValor(wrapper)).toBe("#2196f3");
  });

  it("valor inválido não marca preset nem emite na montagem", () => {
    const wrapper = montar({ modelValue: "roxo" });
    expect(wrapper.findAll(".lj-color-picker__item.is-active")).toHaveLength(0);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("normaliza a cor recebida (#RGB e maiúsculas) para comparar com os presets", () => {
    const wrapper = montar({ modelValue: "#4CAF50" });
    expect(wrapper.find('[data-color="#4caf50"]').classes()).toContain("is-active");
  });

  it("o botão Personalizada abre área, matiz e campo HEX", async () => {
    const wrapper = montar();
    expect(painel(wrapper).exists()).toBe(false);

    await gatilhoPersonalizado(wrapper).trigger("click");
    await nextTick();

    expect(wrapper.find('[role="application"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="slider"]').length).toBeGreaterThan(0);
    expect(wrapper.find(".lj-color-picker__hex").exists()).toBe(true);
  });

  it("o campo HEX devolve uma cor personalizada em hex", async () => {
    const wrapper = montar();
    await gatilhoPersonalizado(wrapper).trigger("click");
    await nextTick();

    wrapper.findComponent(ColorFieldRoot).vm.$emit("update:modelValue", "#123456");
    await nextTick();

    expect(ultimoValor(wrapper)).toBe("#123456");
  });

  it("desabilitado não abre o seletor nem emite", async () => {
    const wrapper = montar({ disabled: true });
    expect(gatilhoPersonalizado(wrapper).attributes("disabled")).toBeDefined();

    await wrapper.find('[data-color="#2196f3"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(painel(wrapper).exists()).toBe(false);
  });

  it("tem rótulos i18n em pt e es", () => {
    expectKeyExists("components.color_picker.custom");
    expectKeyExists("components.color_picker.hex");
  });
});
