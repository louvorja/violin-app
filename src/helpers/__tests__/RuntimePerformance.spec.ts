import { describe, expect, it } from "vitest";
import {
  isPersistentModule,
  PERSISTENT_MODULE_IDS,
  RUNTIME_PERFORMANCE,
} from "@/helpers/RuntimePerformance";

describe("RuntimePerformance", () => {
  it("usa o mesmo limite de cache de módulos em qualquer ambiente", () => {
    expect(RUNTIME_PERFORMANCE).toEqual({
      moduleCacheMax: 4,
    });
    expect(Object.isFrozen(RUNTIME_PERFORMANCE)).toBe(true);
  });

  it("mantém apenas módulos operacionais na faixa persistente", () => {
    expect([...PERSISTENT_MODULE_IDS]).toEqual([
      "clock",
      "liturgy",
      "stopwatch",
      "timer",
      "timer_worship",
    ]);
    expect(isPersistentModule("timer")).toBe(true);
    expect(isPersistentModule("musics")).toBe(false);
  });
});
