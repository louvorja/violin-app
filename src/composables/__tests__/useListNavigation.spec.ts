import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useListNavigation } from "../useListNavigation";

function setup(items: string[], start?: () => number) {
  const list = ref(items);
  const container = ref<HTMLElement | null>(document.createElement("div"));
  const scroll = vi.fn();
  const active = document.createElement("div");
  active.className = "is-active";
  active.scrollIntoView = scroll;
  container.value!.append(active);
  const nav = useListNavigation({
    items: () => list.value,
    container,
    activeSelector: ".is-active",
    start,
  });
  return { list, nav, scroll };
}

describe("useListNavigation", () => {
  it("começa no primeiro e as setas param nas pontas", () => {
    const { nav } = setup(["a", "b", "c"]);
    expect(nav.active.value).toBe("a");
    nav.move(-1);
    expect(nav.index.value).toBe(0);
    nav.move(1);
    nav.move(1);
    nav.move(1);
    expect(nav.active.value).toBe("c");
  });

  it("com start -1 nada fica destacado até a primeira seta", () => {
    const { nav } = setup(["a", "b"], () => -1);
    expect(nav.active.value).toBeNull();
    nav.move(1);
    expect(nav.active.value).toBe("a");
    nav.reset();
    expect(nav.active.value).toBeNull();
  });

  it("lista vazia: a seta não destaca nada", () => {
    const { nav } = setup([]);
    nav.move(1);
    expect(nav.active.value).toBeNull();
  });

  it("a seta rola o destacado até a vista; o mouse não", async () => {
    const { nav, scroll } = setup(["a", "b", "c"]);
    nav.setActive(2);
    await nextTick();
    expect(scroll).not.toHaveBeenCalled();
    nav.move(-1);
    await nextTick();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("subindo, a linha não para atrás do cabeçalho fixo da tabela", async () => {
    const box = document.createElement("div");
    const thead = document.createElement("thead");
    const row = document.createElement("tr");
    row.className = "is-active";
    row.scrollIntoView = () => {};
    box.append(thead, row);
    let scrollTop = 200;
    Object.defineProperty(box, "scrollTop", {
      get: () => scrollTop,
      set: (value) => (scrollTop = value),
    });
    Object.defineProperty(box, "clientTop", { value: 1 });
    const rect = (top: number, height = 0) => () => ({ top, height }) as DOMRect;
    box.getBoundingClientRect = rect(100);
    thead.getBoundingClientRect = rect(101, 40);
    // `nearest` deixou a linha colada no topo da caixa, embaixo do cabeçalho.
    row.getBoundingClientRect = rect(101);

    const nav = useListNavigation({
      items: () => ["a", "b"],
      container: ref(box),
      activeSelector: ".is-active",
    });
    nav.move(1);
    await nextTick();
    expect(scrollTop).toBe(160);
  });

  it("o mouse fora da lista não muda o destaque", () => {
    const { nav } = setup(["a", "b"]);
    nav.setActive(5);
    nav.setActive(-1);
    expect(nav.index.value).toBe(0);
  });
});
