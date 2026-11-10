import { describe, expect, it } from "vitest";
import PlayerGauge from "../PlayerGauge.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

/** Barra de 200px a partir de x=100: cada 2px equivalem a 1% de volume. */
function montar() {
  const w = mountUi(PlayerGauge, { props: { volume: 50 } });
  const el = w.find(".player-gauge__bar").element as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
  el.setPointerCapture = () => {};
  // O jsdom não tem PointerEvent: o MouseEvent com o mesmo tipo chega ao mesmo listener.
  const ponteiro = (type: string, clientX = 0, button = 0) => {
    const e = new MouseEvent(type, { bubbles: true, clientX, button });
    Object.defineProperty(e, "pointerId", { value: 1 });
    el.dispatchEvent(e);
  };
  return { w, ponteiro };
}

const volumes = (w: ReturnType<typeof mountUi>) =>
  ((w.emitted("seek") as number[][] | undefined) ?? []).map(([v]) => v);

describe("PlayerGauge", () => {
  it("acompanha o arrasto em vez de esperar o botão ser solto", () => {
    const { w, ponteiro } = montar();
    ponteiro("pointerdown", 200);
    ponteiro("pointermove", 240);
    ponteiro("pointermove", 280);
    expect(volumes(w)).toEqual([50, 70, 90]);
  });

  it("limita a 0–100 quando o ponteiro sai da barra durante o arrasto", () => {
    const { w, ponteiro } = montar();
    ponteiro("pointerdown", 200);
    ponteiro("pointermove", 900);
    ponteiro("pointermove", -50);
    expect(volumes(w)).toEqual([50, 100, 0]);
  });

  it("não repete o mesmo volume nem reage ao ponteiro que só passa por cima", () => {
    const { w, ponteiro } = montar();
    ponteiro("pointermove", 240);
    ponteiro("pointerdown", 200);
    ponteiro("pointermove", 200.5);
    ponteiro("lostpointercapture");
    ponteiro("pointermove", 280);
    expect(volumes(w)).toEqual([50]);
  });

  it("ignora o botão direito", () => {
    const { w, ponteiro } = montar();
    ponteiro("pointerdown", 200, 2);
    ponteiro("pointermove", 240);
    expect(volumes(w)).toEqual([]);
  });
});
