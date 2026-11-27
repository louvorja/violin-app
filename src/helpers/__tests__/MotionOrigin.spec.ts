// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyMotionOrigin, getMotionOrigin, resetMotionOrigin } from "@/helpers/MotionOrigin";

/**
 * De onde uma camada nasce. O ponto é o do último toque — desde que tenha sido
 * mesmo o toque que a abriu.
 */
const pointer = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y }));
const key = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

function boxAt(left: number, top: number, width = 400, height = 300): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  resetMotionOrigin();
  document.body.innerHTML = "";
});

describe("getMotionOrigin", () => {
  it("sem toque nenhum não há origem", () => {
    expect(getMotionOrigin()).toBeNull();
  });

  it("devolve o ponto do toque recente", () => {
    pointer(120, 48);
    expect(getMotionOrigin()).toEqual({ x: 120, y: 48 });
  });

  it("um toque antigo já não é a causa do que está abrindo", () => {
    pointer(120, 48);
    expect(getMotionOrigin(performance.now() + 5000)).toBeNull();
  });

  it("tecla depois do toque: quem abriu foi o teclado", async () => {
    pointer(120, 48);
    await new Promise((resolve) => setTimeout(resolve, 5));
    key();
    expect(getMotionOrigin()).toBeNull();
  });
});

describe("applyMotionOrigin", () => {
  it("ancora a escala no toque, relativo à caixa em repouso", () => {
    pointer(150, 90);
    const el = boxAt(100, 50);
    applyMotionOrigin(el);
    expect(el.style.transformOrigin).toBe("50px 40px");
  });

  it("o ponto pode ficar fora da caixa — o diálogo vem de lá", () => {
    pointer(20, 10);
    const el = boxAt(400, 250);
    applyMotionOrigin(el);
    expect(el.style.transformOrigin).toBe("-380px -240px");
  });

  it("sem toque fica com a origem do CSS", () => {
    const el = boxAt(100, 50);
    el.style.transformOrigin = "10px 10px";
    applyMotionOrigin(el);
    expect(el.style.transformOrigin).toBe("");
  });

  it("devolve os estilos que desligou para medir", () => {
    pointer(150, 90);
    const el = boxAt(100, 50);
    el.style.transition = "opacity 1s";
    applyMotionOrigin(el, "none");
    expect(el.style.transition).toBe("opacity 1s");
    expect(el.style.animation).toBe("");
    expect(el.style.transform).toBe("");
  });

  it("ignora o que não é elemento", () => {
    expect(() => applyMotionOrigin(null)).not.toThrow();
    expect(() => applyMotionOrigin(window)).not.toThrow();
  });
});
