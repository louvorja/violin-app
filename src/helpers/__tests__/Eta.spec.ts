import { describe, expect, it } from "vitest";
import { createEtaEstimator, formatEta } from "@/helpers/Eta";

describe("createEtaEstimator", () => {
  it("não chuta antes de ter base suficiente", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(1_000, 2);
    expect(eta.eta(1_000)).toBeNull();
  });

  it("estima pelo ritmo: 25% em 10 s deixam 30 s para os 75% restantes", () => {
    const eta = createEtaEstimator();
    for (let s = 0; s <= 10; s++) eta.push(s * 1_000, s * 2.5);
    expect(eta.eta(10_000)).toBe(30);
  });

  it("reage a uma rede que acelera, sem esquecer a média", () => {
    const slow = createEtaEstimator();
    const speedup = createEtaEstimator();
    for (let s = 0; s <= 20; s++) {
      slow.push(s * 1_000, s * 1);
      speedup.push(s * 1_000, s < 10 ? s * 1 : 10 + (s - 10) * 4);
    }
    expect(speedup.eta(20_000)!).toBeLessThan(slow.eta(20_000)!);
  });

  it("some quando a tarefa para de andar", () => {
    const eta = createEtaEstimator();
    for (let s = 0; s <= 10; s++) eta.push(s * 1_000, s * 2);
    expect(eta.eta(10_000)).not.toBeNull();
    expect(eta.eta(10_000 + 25_000)).toBeNull();
  });

  it("recomeça a estimativa quando o progresso recua", () => {
    const eta = createEtaEstimator();
    for (let s = 0; s <= 10; s++) eta.push(s * 1_000, 50 + s * 2);
    eta.push(11_000, 0);
    expect(eta.eta(11_000)).toBeNull();
  });

  it("zero quando terminou", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(5_000, 100);
    expect(eta.eta(5_000)).toBe(0);
  });

  it("marca calculando abaixo do percentual mínimo depois do tempo mínimo", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(5_000, 0.02);
    expect(eta.eta(5_000)).toBeNull();
    expect(eta.calculating(5_000)).toBe(true);
  });

  it("não marca calculando antes do tempo mínimo", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(1_000, 0.02);
    expect(eta.calculating(1_000)).toBe(false);
  });

  it("para de calcular quando atinge o percentual mínimo", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(5_000, 1);
    expect(eta.calculating(5_000)).toBe(false);
    expect(eta.eta(5_000)).not.toBeNull();
  });

  it("deixa de calcular quando a tarefa para de andar", () => {
    const eta = createEtaEstimator();
    eta.push(0, 0);
    eta.push(5_000, 0.02);
    expect(eta.calculating(5_000 + 25_000)).toBe(false);
  });
});

describe("formatEta", () => {
  it.each([
    [3, "< 10 s"],
    [45, "45 s"],
    [125, "2 min 05 s"],
    [900, "15 min"],
    [3900, "1 h 05 min"],
  ])("%i s -> %s", (seconds, text) => {
    expect(formatEta(seconds)).toBe(text);
  });
});
