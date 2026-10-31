import { describe, expect, it } from "vitest";
import { taskProgressIsIndeterminate } from "@/composables/useBackgroundTasks";

describe("taskProgressIsIndeterminate", () => {
  it("com total conhecido desenha 0% em vez de animar para sempre", () => {
    // Libras e coletâneas registram o total antes do primeiro arquivo.
    expect(taskProgressIsIndeterminate({ progress: 0, _total: 12 })).toBe(false);
    expect(taskProgressIsIndeterminate({ progress: 0, _total: 0 })).toBe(true);
  });

  it("percentual já recebido sempre vale como progresso", () => {
    expect(taskProgressIsIndeterminate({ progress: 1, _total: 0 })).toBe(false);
    expect(taskProgressIsIndeterminate({ progress: 100, _total: 0 })).toBe(false);
  });
});
