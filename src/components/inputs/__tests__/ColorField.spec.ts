import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import ColorField from "../ColorField.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

let wrapper: VueWrapper | null = null;

function mountField(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  wrapper = mountUi(ColorField, { attachTo: host, props }) as unknown as VueWrapper;
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("ColorField", () => {
  it("normaliza hex de 3 e 6 dígitos para minúsculo e expõe id e aria-label no gatilho", () => {
    const w = mountField({
      modelValue: "#AbC",
      id: "cor-teste",
      ariaLabel: "Cor do texto",
      showHex: true,
    });
    const btn = w.get("button.lj-color-field");
    expect(btn.attributes("id")).toBe("cor-teste");
    expect(btn.attributes("aria-label")).toBe("Cor do texto");
    expect(w.get(".lj-color-field__hex").text()).toBe("#aabbcc");
  });

  it("abre o popover com LjColorPicker e emite a cor escolhida em minúsculas", async () => {
    const w = mountField({
      modelValue: "#000000",
      presets: ["#FF0000", "#00FF00"],
      ariaLabel: "Cor",
    });

    await w.get("button.lj-color-field").trigger("click");
    await nextTick();

    const preset = document.querySelector('[data-color="#ff0000"]') as HTMLButtonElement | null;
    expect(preset).not.toBeNull();
    preset!.click();
    await nextTick();

    const emitted = w.emitted("update:modelValue") ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.at(-1)).toEqual(["#ff0000"]);
  });

  it("não abre o popover quando desabilitado", async () => {
    const w = mountField({ modelValue: "#123456", disabled: true });
    const btn = w.get("button.lj-color-field");
    expect(btn.attributes("disabled")).toBeDefined();

    await btn.trigger("click");
    await nextTick();

    expect(document.querySelector(".lj-color")).toBeNull();
  });
});
