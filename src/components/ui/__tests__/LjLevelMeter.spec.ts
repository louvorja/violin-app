import { describe, expect, it } from "vitest";
import LjLevelMeter from "../LjLevelMeter.vue";
import { mountUi } from "./mountUi";

const meter = (w: ReturnType<typeof mountUi>) => w.get('[role="meter"]');
const widths = (w: ReturnType<typeof mountUi>) =>
  w.findAll(".lj-level-meter__cover").map((c) => (c.element as HTMLElement).style.width);

describe("LjLevelMeter", () => {
  it("desenha uma barra por canal, apagando o que falta do nível", () => {
    const w = mountUi(LjLevelMeter, { props: { levels: [0.6, 0.25] } });
    expect(widths(w)).toEqual(["40%", "75%"]);
  });

  it("anuncia o canal mais alto como valor do medidor", () => {
    const w = mountUi(LjLevelMeter, { props: { levels: [0.3, 0.72], ariaLabel: "Saída" } });
    expect(meter(w).attributes("aria-valuenow")).toBe("72");
    expect(meter(w).attributes("aria-label")).toBe("Saída");
  });

  it("prende valores fora da faixa e ignora NaN", () => {
    const w = mountUi(LjLevelMeter, { props: { levels: [1.4, -0.2, Number.NaN] } });
    expect(widths(w)).toEqual(["0%", "100%", "100%"]);
  });

  it("marca o pico só quando há pico", () => {
    const w = mountUi(LjLevelMeter, { props: { levels: [0.5, 0.5], peaks: [0.8] } });
    const peaks = w.findAll(".lj-level-meter__peak");
    expect(peaks).toHaveLength(1);
    expect((peaks[0].element as HTMLElement).style.left).toBe("80%");
  });

  it("na vertical enche de baixo para cima", () => {
    const w = mountUi(LjLevelMeter, {
      props: { orientation: "vertical", levels: [0.6], peaks: [0.9] },
    });
    expect(meter(w).attributes("aria-orientation")).toBe("vertical");
    expect((w.get(".lj-level-meter__cover").element as HTMLElement).style.height).toBe("40%");
    expect((w.get(".lj-level-meter__peak").element as HTMLElement).style.bottom).toBe("90%");
  });

  it("desabilitado apaga as barras e esconde o pico", () => {
    const w = mountUi(LjLevelMeter, { props: { levels: [0.9], peaks: [0.95], disabled: true } });
    expect(widths(w)).toEqual(["100%"]);
    expect(w.find(".lj-level-meter__peak").exists()).toBe(false);
    expect(meter(w).attributes("aria-valuenow")).toBe("0");
  });
});
