import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import DrawWheel from "../DrawWheel.vue";

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("DrawWheel", () => {
  it("centraliza o número alvo e mantém as opções vizinhas", async () => {
    wrapper = mount(DrawWheel, {
      props: {
        wheel: {
          run_id: "1",
          mode: "number",
          target: "7",
          duration: 2_000,
          min: 1,
          max: 10,
        },
      },
    });
    await nextTick();

    expect(wrapper.find(".draw-wheel__row--center").text()).toBe("7");
    const rows = wrapper.findAll(".draw-wheel__row").map((row) => row.text());
    expect(rows).toContain("6");
    expect(rows).toContain("8");
  });

  it("mantém o número anterior como origem ao reiniciar", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    wrapper = mount(DrawWheel, {
      props: {
        wheel: {
          run_id: "3",
          mode: "number",
          target: "7",
          duration: 2_000,
          min: 1,
          max: 10,
          settled: true,
        },
      },
    });
    await nextTick();
    expect(wrapper.find(".draw-wheel__row--center").text()).toBe("7");

    await wrapper.setProps({
      wheel: {
        run_id: "4",
        mode: "number",
        target: "3",
        duration: 2_000,
        items: ["1", "2", "3", "4", "5", "6", "8", "9", "10"],
        settled: false,
      },
    });
    await nextTick();

    expect(wrapper.get(".draw-wheel").classes()).toContain("draw-wheel--restarting");
    expect(wrapper.get(".draw-wheel").classes()).toContain("draw-wheel--restart-overlay");
    expect(wrapper.get(".draw-wheel__origin-text").text()).toBe("7");
    expect(wrapper.findAll(".draw-wheel__row-text").map((row) => row.text())).not.toContain("7");
  });

  it("atualiza a origem do reinício quando o nome sorteado é editado", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    wrapper = mount(DrawWheel, {
      props: {
        wheel: {
          run_id: "6",
          mode: "names",
          target: "Beatriz",
          duration: 2_000,
          items: ["Ana", "Beatriz", "Carlos"],
          settled: true,
        },
      },
    });
    await nextTick();

    await wrapper.setProps({
      wheel: {
        run_id: "6",
        mode: "names",
        target: "Beatriz Maria",
        duration: 2_000,
        items: ["Ana", "Beatriz Maria", "Carlos"],
        settled: true,
      },
    });
    await nextTick();

    await wrapper.setProps({
      wheel: {
        run_id: "7",
        mode: "names",
        target: "Ana",
        duration: 2_000,
        items: ["Ana", "Carlos"],
        settled: false,
      },
    });
    await nextTick();

    expect(wrapper.get(".draw-wheel__origin-text").text()).toBe("Beatriz Maria");
  });

  it("aceita números não contíguos na roda", async () => {
    wrapper = mount(DrawWheel, {
      props: {
        wheel: {
          run_id: "5",
          mode: "number",
          target: "3",
          duration: 2_000,
          items: ["1", "3", "5"],
        },
      },
    });
    await nextTick();

    expect(wrapper.find(".draw-wheel__row--center").text()).toBe("3");
    const values = wrapper.findAll(".draw-wheel__row-text").map((row) => row.text());
    expect(values).toContain("1");
    expect(values).toContain("5");
    expect(values).not.toContain("2");
    expect(values).not.toContain("4");
  });

  it("centraliza o nome alvo na lista", async () => {
    wrapper = mount(DrawWheel, {
      props: {
        wheel: {
          run_id: "2",
          mode: "names",
          target: "Beatriz",
          duration: 2_000,
          items: ["Ana", "Beatriz", "Carlos"],
        },
      },
    });
    await nextTick();

    expect(wrapper.find(".draw-wheel__row--center").text()).toBe("Beatriz");
  });
});
