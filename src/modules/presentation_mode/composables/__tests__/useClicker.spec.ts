import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";

const registered = vi.hoisted(() => new Map<string, (e?: KeyboardEvent) => void>());
vi.mock("@/helpers/Hotkeys", () => ({
  default: {
    register: (combo: string, handler: (e?: KeyboardEvent) => void) => registered.set(combo, handler),
    unregister: (combo: string) => registered.delete(combo),
  },
}));
vi.mock("@/helpers/AppData", async () => {
  const { ref } = await import("vue");
  const active = ref("presentation_mode");
  return { default: { get: () => active.value, __set: (v: string) => (active.value = v) } };
});

import $appdata from "@/helpers/AppData";
import { useClicker } from "../useClicker";

describe("useClicker", () => {
  beforeEach(() => registered.clear());
  afterEach(() => ($appdata as unknown as { __set: (v: string) => void }).__set("presentation_mode"));

  it("passador: PageDown/setas/Espaço andam, B e . alternam a tela preta", () => {
    const navigate = vi.fn();
    const toggleBlack = vi.fn();
    mount(defineComponent({ setup: () => (useClicker({ navigate, toggleBlack }), () => h("div")) }));
    registered.get("PageDown")!();
    registered.get("ArrowRight")!();
    registered.get("Space")!();
    registered.get("PageUp")!();
    registered.get("ArrowLeft")!();
    expect(navigate.mock.calls.map((c) => c[0])).toEqual(["next", "next", "next", "prev", "prev"]);
    registered.get("b")!();
    registered.get(".")!();
    expect(toggleBlack).toHaveBeenCalledTimes(2);
  });

  it("a tecla é só do passador: nenhum outro ouvinte passa o slide de novo", () => {
    const navigate = vi.fn();
    mount(defineComponent({ setup: () => (useClicker({ navigate, toggleBlack: vi.fn() }), () => h("div")) }));
    const event = { stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
    registered.get("ArrowRight")!(event);
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("solta as teclas quando outra aba fica à vista, e ao fechar o módulo", async () => {
    const wrapper = mount(
      defineComponent({ setup: () => (useClicker({ navigate: vi.fn(), toggleBlack: vi.fn() }), () => h("div")) })
    );
    expect(registered.has("PageDown")).toBe(true);
    ($appdata as unknown as { __set: (v: string) => void }).__set("musics");
    await nextTick();
    expect(registered.size).toBe(0);
    ($appdata as unknown as { __set: (v: string) => void }).__set("presentation_mode");
    await nextTick();
    expect(registered.has("PageDown")).toBe(true);
    wrapper.unmount();
    expect(registered.size).toBe(0);
  });
});
