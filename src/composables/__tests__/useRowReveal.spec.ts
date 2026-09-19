import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useRowReveal } from "@/composables/useRowReveal";

const Probe = defineComponent({
  setup() {
    const anchor = ref<HTMLElement | null>(null);
    const revealed = useRowReveal(anchor);
    return () =>
      h("tr", { "data-row": "" }, [
        h("td", [h("div", { ref: anchor }, revealed.value ? "revelado" : "escondido")]),
        h("td", { "data-other": "" }, "outra célula"),
      ]);
  },
});

let wrapper: VueWrapper | null = null;

function montar() {
  wrapper = mount(Probe, { attachTo: document.body });
  return wrapper.element as HTMLElement;
}

function pointer(el: Element, type: string, pointerType: string) {
  const event = new Event(type, { bubbles: !type.endsWith("enter") && !type.endsWith("leave") });
  Object.assign(event, { pointerType });
  el.dispatchEvent(event);
}

function tocar(el: Element) {
  pointer(el, "pointerdown", "touch");
  el.dispatchEvent(new Event("click", { bubbles: true }));
}

const texto = () => wrapper!.text().split("outra")[0].trim();

function focoVisivel(valor: boolean) {
  const original = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    seletor: string
  ) {
    return seletor === ":focus-visible" ? valor : original.call(this, seletor);
  });
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRowReveal", () => {
  it("começa escondido", () => {
    montar();
    expect(texto()).toBe("escondido");
  });

  it("revela com o mouse em qualquer ponto da linha e esconde ao sair", async () => {
    const row = montar();

    pointer(row, "pointerenter", "mouse");
    await nextTick();
    expect(texto()).toBe("revelado");

    pointer(row, "pointerleave", "mouse");
    await nextTick();
    expect(texto()).toBe("escondido");
  });

  it("revela com o foco de teclado dentro da linha", async () => {
    focoVisivel(true);
    const row = montar();

    row.querySelector("div")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await nextTick();
    expect(texto()).toBe("revelado");
  });

  it("foco que veio do mouse (o menu devolvendo o foco ao ⋮) não revela", async () => {
    focoVisivel(false);
    const row = montar();

    row.querySelector("div")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await nextTick();
    expect(texto()).toBe("escondido");
  });

  it("mover o foco entre elementos da mesma linha não esconde", async () => {
    focoVisivel(true);
    const row = montar();
    const dentro = row.querySelector("div")!;
    const outro = row.querySelector("[data-other]")!;

    dentro.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    dentro.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outro }));
    await nextTick();

    expect(texto()).toBe("revelado");
  });

  it("o pointerenter de um dedo não revela; o toque completo sim e fica", async () => {
    const row = montar();

    pointer(row, "pointerenter", "touch");
    await nextTick();
    expect(texto()).toBe("escondido");

    tocar(row);
    pointer(row, "pointerleave", "touch");
    await nextTick();
    expect(texto()).toBe("revelado");
  });

  it("o toque fora da linha esconde", async () => {
    const row = montar();
    tocar(row);
    await nextTick();

    pointer(document.body, "pointerdown", "touch");
    await nextTick();

    expect(texto()).toBe("escondido");
  });

  it("um clique de mouse não deixa a linha revelada depois que o mouse sai", async () => {
    const row = montar();

    pointer(row, "pointerdown", "mouse");
    row.dispatchEvent(new Event("click", { bubbles: true }));
    pointer(row, "pointerleave", "mouse");
    await nextTick();

    expect(texto()).toBe("escondido");
  });

  it("em tela sem hover fica sempre revelado", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    montar();

    expect(texto()).toBe("revelado");
  });
});
