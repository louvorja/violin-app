import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const hasPendingConflict = vi.fn(() => false);
const alertInfo = vi.fn();

vi.mock("@/helpers/Alert", () => ({
  default: {
    info: (...args: unknown[]) => alertInfo(...args),
    show: vi.fn(),
    yesno: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn(),
  },
}));
vi.mock("@/helpers/DocStore", () => ({
  default: { get: async () => undefined, put: async () => undefined },
}));
vi.mock("../programStore", () => ({
  loadProgram: async (date: string) => ({
    id: date,
    date,
    plannedStart: "09:00",
    sessions: [],
    createdAt: "",
    updatedAt: "",
  }),
  saveProgram: () => undefined,
  checkRemote: async () => null,
  hasPendingConflict: () => hasPendingConflict(),
}));

const { useProgram } = await import("../useProgram");

/**
 * Trocar de data recarrega o documento. Em conflito, a edição deste
 * computador ainda não foi para a pasta da igreja: a troca é recusada e o
 * operador resolve o conflito primeiro (senão a edição morreria só no
 * DocStore local).
 */
describe("useProgram — troca de data em conflito", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    alertInfo.mockClear();
    hasPendingConflict.mockReturnValue(false);
  });

  it("recusa a troca enquanto o programa está em conflito", async () => {
    const program = useProgram();
    await program.setDate("2026-11-17");
    hasPendingConflict.mockReturnValue(true);

    expect(await program.setDate("2026-11-18")).toBe(false);
    expect(program.date.value).toBe("2026-11-17");
    expect(alertInfo).toHaveBeenCalledOnce();
  });

  it("sem conflito, troca normalmente", async () => {
    const program = useProgram();
    await program.setDate("2026-11-17");

    expect(await program.setDate("2026-11-18")).toBe(true);
    expect(program.date.value).toBe("2026-11-18");
    expect(alertInfo).not.toHaveBeenCalled();
  });
});
