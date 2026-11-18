import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { LiturgyPick } from "@/types/LiturgyLibrary";

/**
 * Importar uma liturgia da biblioteca no programa: a data passa a ser a do
 * vínculo (próximo dia da semana/13º sábado/data exata), com confirmação extra
 * quando o dia de destino já tem programa.
 */

const date = ref("2026-11-17");
const program = ref<{ sessions: unknown[] }>({ sessions: [] });
const setDate = vi.fn(async (next: string) => {
  date.value = next;
  return true;
});
const setSessions = vi.fn();
const setPlannedStart = vi.fn();
const peekProgram = vi.fn(async (_date: string) => null as { sessions: unknown[] } | null);
const importLiturgy = vi.fn(() => ({
  sessions: [{ id: "s1", label: "Culto", items: [] }],
  plannedStart: "19:00",
}));
const snackSuccess = vi.fn();
const track = vi.fn();
const captureException = vi.fn();
const alertInfo = vi.fn();
const hasPendingConflict = vi.fn(() => false);
let alertAnswer = "yes";
const yesno = vi.fn((_data: unknown, cb: (_answer: string) => void) => cb(alertAnswer));

vi.mock("../useProgram", () => ({
  useProgram: () => ({
    date,
    program,
    setDate: (...args: unknown[]) => setDate(...(args as [string])),
    setSessions,
    setPlannedStart,
  }),
  newId: () => "novo",
}));
vi.mock("../programStore", () => ({
  peekProgram: (...args: unknown[]) => peekProgram(...(args as [string])),
  hasPendingConflict: () => hasPendingConflict(),
}));
vi.mock("../../program/liturgy", () => ({
  importLiturgy: (...args: unknown[]) => importLiturgy(...(args as [])),
  programToLiturgy: vi.fn(),
}));
vi.mock("@/helpers/Alert", () => ({
  default: {
    yesno: (...args: unknown[]) => yesno(...(args as [unknown, (_answer: string) => void])),
    error: vi.fn(),
    info: (...args: unknown[]) => alertInfo(...args),
    prompt: vi.fn(),
  },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { success: (...args: unknown[]) => snackSuccess(...args) },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: {
    track: (...args: unknown[]) => track(...args),
    captureException: (...args: unknown[]) => captureException(...args),
  },
}));
vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll: vi.fn(async () => []) } }));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    tm: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    t: (key: string) => key,
  }),
}));
vi.mock("@/modules/liturgy/composables/useLiturgyLibrary", () => ({
  useLiturgyLibrary: () => ({ save: vi.fn() }),
}));

const { useProgramLiturgy } = await import("../useProgramLiturgy");

const pick = (patch: Partial<LiturgyPick> = {}): LiturgyPick => ({
  id: "lit-1",
  name: "Liturgia de sábado",
  items: [{ id: "l1" }] as never,
  binding: null,
  ...patch,
});

describe("useProgramLiturgy — importar da biblioteca", () => {
  beforeEach(() => {
    date.value = "2026-11-17";
    program.value = { sessions: [] };
    alertAnswer = "yes";
    hasPendingConflict.mockReturnValue(false);
    for (const fn of [setDate, setSessions, setPlannedStart, peekProgram, importLiturgy, snackSuccess, track, captureException, yesno, alertInfo, hasPendingConflict])
      fn.mockClear();
    peekProgram.mockResolvedValue(null);
    setDate.mockImplementation(async (next: string) => {
      date.value = next;
      return true;
    });
  });

  it("muda para a próxima ocorrência do vínculo e importa as sessões", async () => {
    const liturgy = useProgramLiturgy();
    await liturgy.importFromLibrary(pick({ binding: { type: "day_of_week", value: "6" } }));

    expect(setDate).toHaveBeenCalledWith("2026-11-21");
    expect(importLiturgy).toHaveBeenCalledOnce();
    expect(setSessions).toHaveBeenCalledWith([{ id: "s1", label: "Culto", items: [] }]);
    expect(setPlannedStart).toHaveBeenCalledWith("19:00");
    expect(track).toHaveBeenCalledWith(
      "presentation_liturgy_imported",
      expect.objectContaining({ source: "library", changed_date: true })
    );
    expect(snackSuccess).toHaveBeenCalledOnce();
  });

  it("sem vínculo (liturgia do dia) mantém a data", async () => {
    const liturgy = useProgramLiturgy();
    await liturgy.importFromLibrary(pick({ id: null }));

    expect(setDate).not.toHaveBeenCalled();
    expect(importLiturgy).toHaveBeenCalledOnce();
  });

  it("pede confirmação extra quando o dia de destino já tem programa", async () => {
    peekProgram.mockResolvedValueOnce({ sessions: [{ id: "s0" }] });
    alertAnswer = "no";
    const liturgy = useProgramLiturgy();

    await liturgy.importFromLibrary(pick({ binding: { type: "day_of_week", value: "6" } }));

    expect(yesno).toHaveBeenCalledOnce();
    expect(setDate).not.toHaveBeenCalled();
    expect(importLiturgy).not.toHaveBeenCalled();
  });

  it("cancelar a confirmação do dia ocupado mantém o programa intacto", async () => {
    peekProgram.mockResolvedValueOnce({ sessions: [{ id: "s0" }] });
    const liturgy = useProgramLiturgy();

    await liturgy.importFromLibrary(pick({ binding: { type: "date", value: "2026-12-25" } }));

    expect(setDate).toHaveBeenCalledWith("2026-12-25");
    expect(importLiturgy).toHaveBeenCalledOnce();
  });

  it("conflito do programa aberto (setDate false) aborta a importação", async () => {
    setDate.mockResolvedValueOnce(false);
    const liturgy = useProgramLiturgy();

    await liturgy.importFromLibrary(pick({ binding: { type: "day_of_week", value: "6" } }));

    expect(setDate).toHaveBeenCalledOnce();
    expect(importLiturgy).not.toHaveBeenCalled();
    expect(setSessions).not.toHaveBeenCalled();
  });

  it("não importa com edição deste computador presa em conflito", async () => {
    hasPendingConflict.mockReturnValueOnce(true);
    const liturgy = useProgramLiturgy();

    await liturgy.importFromLibrary(pick());

    expect(alertInfo).toHaveBeenCalledOnce();
    expect(setDate).not.toHaveBeenCalled();
    expect(importLiturgy).not.toHaveBeenCalled();
    expect(setSessions).not.toHaveBeenCalled();
  });
});
