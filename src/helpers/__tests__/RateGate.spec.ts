import { describe, it, expect } from "vitest";
import { createRateGate } from "@/helpers/RateGate";

function fakeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateGate", () => {
  it("deixa a primeira chamada passar", () => {
    const clock = fakeClock();
    const gate = createRateGate(200, clock.now);

    expect(gate()).toBe(true);
  });

  it("bloqueia chamadas dentro do intervalo e libera depois dele", () => {
    const clock = fakeClock();
    const gate = createRateGate(200, clock.now);

    expect(gate()).toBe(true);
    clock.advance(16);
    expect(gate()).toBe(false);
    clock.advance(183);
    expect(gate()).toBe(false);
    clock.advance(1);
    expect(gate()).toBe(true);
  });

  it("limita um loop de 60 quadros por segundo a 5 passagens por segundo", () => {
    const clock = fakeClock();
    const gate = createRateGate(200, clock.now);
    let passes = 0;

    for (let i = 0; i < 60; i++) {
      if (gate()) passes++;
      clock.advance(1000 / 60);
    }

    expect(passes).toBeLessThanOrEqual(5);
    expect(passes).toBeGreaterThanOrEqual(4);
  });

  it("force passa dentro do intervalo e reinicia a janela", () => {
    const clock = fakeClock();
    const gate = createRateGate(200, clock.now);

    expect(gate()).toBe(true);
    clock.advance(50);
    expect(gate(true)).toBe(true);
    clock.advance(150);
    expect(gate()).toBe(false);
    clock.advance(50);
    expect(gate()).toBe(true);
  });
});
