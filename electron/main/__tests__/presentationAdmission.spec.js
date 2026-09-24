// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { WorkPriority, canStartWork } = require("../presentationAdmission.js");

describe("presentationAdmission", () => {
  it("admite o live path e o pedido do operador durante apresentação", () => {
    expect(canStartWork(WorkPriority.CRITICAL, true)).toBe(true);
    expect(canStartWork(WorkPriority.INTERACTIVE, true)).toBe(true);
  });

  it("adia só trabalho automático background até a apresentação terminar", () => {
    expect(canStartWork(WorkPriority.BACKGROUND, true)).toBe(false);
    expect(canStartWork(WorkPriority.BACKGROUND, false)).toBe(true);
  });

  it("rejeita prioridade desconhecida em vez de classificá-la como segura", () => {
    expect(() => canStartWork("download", true)).toThrow(TypeError);
  });
});
