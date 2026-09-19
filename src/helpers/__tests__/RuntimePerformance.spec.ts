import { describe, expect, it } from "vitest";
import { getRuntimePerformanceProfile } from "@/helpers/RuntimePerformance";

describe("getRuntimePerformanceProfile", () => {
  it("usa o perfil normal quando o equipamento é forte", () => {
    expect(getRuntimePerformanceProfile({ deviceMemory: 8, hardwareConcurrency: 8 })).toEqual({
      lowResource: false,
      constrained: false,
      moduleCacheMax: 6,
      tablePageSize: 80,
    });
  });

  it("reduz cache e DOM inicial em equipamentos limitados", () => {
    expect(getRuntimePerformanceProfile({ deviceMemory: 4, hardwareConcurrency: 4 })).toEqual({
      lowResource: false,
      constrained: true,
      moduleCacheMax: 4,
      tablePageSize: 60,
    });
  });

  it("prioriza liberar RAM quando há até 2 GB ou 2 threads", () => {
    expect(getRuntimePerformanceProfile({ deviceMemory: 2, hardwareConcurrency: 8 })).toEqual({
      lowResource: true,
      constrained: true,
      moduleCacheMax: 3,
      tablePageSize: 40,
    });
    expect(getRuntimePerformanceProfile({ hardwareConcurrency: 2 })).toEqual({
      lowResource: true,
      constrained: true,
      moduleCacheMax: 3,
      tablePageSize: 40,
    });
  });

  it("não exige deviceMemory para funcionar no Electron", () => {
    expect(getRuntimePerformanceProfile({ hardwareConcurrency: 8 })).toEqual({
      lowResource: false,
      constrained: false,
      moduleCacheMax: 6,
      tablePageSize: 80,
    });
  });
});
