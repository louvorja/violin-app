import { describe, expect, it } from "vitest";
import { createBoomerangPlan } from "../boomerang";

describe("createBoomerangPlan", () => {
  it("é determinístico para o mesmo run_id", () => {
    expect(createBoomerangPlan("run-123")).toEqual(createBoomerangPlan("run-123"));
  });

  it("desativa o bumerangue quando a animação final aleatória está off", () => {
    expect(createBoomerangPlan("run-off", false)).toEqual({
      positions: [0],
      durations: [],
      totalMs: 0,
    });
  });

  it("muda quantidade e duração entre sorteios diferentes", () => {
    const plans = ["a", "b", "c", "d"].map((seed) => createBoomerangPlan(seed));
    expect(new Set(plans.map((plan) => JSON.stringify(plan))).size).toBeGreaterThan(1);
  });

  it("sorteia de 0 até 3 bounces, sem trechos rápidos demais", () => {
    const counts = new Set<number>();

    for (let index = 0; index < 300; index++) {
      const plan = createBoomerangPlan(`seed-${index}`);
      counts.add(plan.durations.length);

      expect(plan.durations.length).toBeLessThanOrEqual(3);
      expect(plan.durations.length).toBe(plan.positions.length - 1);
      expect(plan.positions.at(-1)).toBe(0);
      expect(plan.totalMs).toBe(plan.durations.reduce((total, duration) => total + duration, 0));

      if (!plan.durations.length) {
        expect(plan.positions).toEqual([0]);
        expect(plan.totalMs).toBe(0);
        continue;
      }

      expect(plan.positions[0]).toBeLessThan(0);
      for (let durationIndex = 0; durationIndex < plan.durations.length; durationIndex++) {
        const duration = plan.durations[durationIndex];
        expect(duration).toBeGreaterThanOrEqual(860);
        expect(duration).toBeLessThanOrEqual(1200);
        if (durationIndex < plan.durations.length - 1) {
          expect(Math.sign(plan.positions[durationIndex + 1])).toBe(
            durationIndex % 2 === 0 ? 1 : -1
          );
        }
      }
    }

    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
  });
});
