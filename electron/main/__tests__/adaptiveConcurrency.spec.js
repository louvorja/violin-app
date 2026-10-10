// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createAdaptiveConcurrency } from "../download/adaptiveConcurrency.mjs";

/** Simula janelas de 3 s em que cada arquivo leva `fileMs` e rende `bytes`. */
function feed(ctl, clock, { files, bytes = 1000, ok = true, stepMs = 1000 }) {
  for (let i = 0; i < files; i++) {
    clock.t += stepMs;
    ctl.report({ bytes, ok });
  }
}

function setup(opts = {}) {
  const clock = { t: 0 };
  const ctl = createAdaptiveConcurrency({ min: 2, start: 4, max: 8, now: () => clock.t, ...opts });
  return { clock, ctl };
}

describe("createAdaptiveConcurrency", () => {
  it("começa no ponto de partida e respeita min/max", () => {
    expect(setup().ctl.limit()).toBe(4);
    expect(setup({ start: 99 }).ctl.limit()).toBe(8);
    expect(setup({ start: 0 }).ctl.limit()).toBe(2);
  });

  it("sobe um passo na primeira janela e continua enquanto a vazão melhora", () => {
    const { clock, ctl } = setup();
    feed(ctl, clock, { files: 4, bytes: 1000 });
    expect(ctl.limit()).toBe(5);
    feed(ctl, clock, { files: 5, bytes: 2000 });
    expect(ctl.limit()).toBe(6);
  });

  it("volta ao limite anterior quando subir não melhora a vazão", () => {
    const { clock, ctl } = setup();
    feed(ctl, clock, { files: 4, bytes: 1000 });
    expect(ctl.limit()).toBe(5);
    feed(ctl, clock, { files: 5, bytes: 1000 });
    expect(ctl.limit()).toBe(4);
  });

  it("corta o limite quando muitas falhas aparecem na janela", () => {
    const { clock, ctl } = setup({ start: 8 });
    feed(ctl, clock, { files: 8, ok: false });
    expect(ctl.limit()).toBe(4);
    feed(ctl, clock, { files: 4, ok: false });
    expect(ctl.limit()).toBe(2);
  });

  it("reduz um passo quando a rede piora com o limite estável", () => {
    const { clock, ctl } = setup();
    feed(ctl, clock, { files: 4, bytes: 1000 });
    feed(ctl, clock, { files: 5, bytes: 1000 });
    expect(ctl.limit()).toBe(4);
    feed(ctl, clock, { files: 4, bytes: 100 });
    expect(ctl.limit()).toBe(3);
  });

  it("não passa do máximo", () => {
    const { clock, ctl } = setup({ max: 5 });
    for (let i = 0; i < 10; i++) feed(ctl, clock, { files: 6, bytes: 1000 * 2 ** i });
    expect(ctl.limit()).toBe(5);
  });
});
