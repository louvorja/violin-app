import { describe, expect, it } from "vitest";
import {
  liturgyTargetDate,
  nextThirteenthSabbath,
  nextWeekday,
} from "../liturgyDate";

/**
 * A data que o programa assume ao importar uma liturgia da biblioteca:
 * data exata, próximo dia da semana ou próximo 13º sábado.
 */
describe("liturgyTargetDate", () => {
  it("data exata do vínculo", () => {
    expect(liturgyTargetDate({ type: "date", value: "2026-12-25" }, "2026-11-17")).toBe(
      "2026-12-25"
    );
    expect(liturgyTargetDate({ type: "date", value: "2026-02-31" }, "2026-11-17")).toBeNull();
    expect(liturgyTargetDate({ type: "date", value: "25/12/2026" }, "2026-11-17")).toBeNull();
  });

  it("dia da semana: a próxima ocorrência a partir do programa", () => {
    // Terça 17/11/2026 → sábado 21/11/2026.
    expect(nextWeekday("2026-11-17", 6)).toBe("2026-11-21");
    // Domingo 15/11/2026 → sábado 21/11/2026.
    expect(liturgyTargetDate({ type: "day_of_week", value: "6" }, "2026-11-15")).toBe(
      "2026-11-21"
    );
    // Já é o dia certo: fica nele.
    expect(liturgyTargetDate({ type: "day_of_week", value: "6" }, "2026-11-21")).toBe(
      "2026-11-21"
    );
    expect(liturgyTargetDate({ type: "day_of_week", value: "9" }, "2026-11-17")).toBeNull();
  });

  it("13º sábado: o próximo último sábado de trimestre", () => {
    expect(nextThirteenthSabbath("2026-11-17")).toBe("2026-12-26");
    // No próprio 13º sábado, fica nele.
    expect(nextThirteenthSabbath("2026-12-26")).toBe("2026-12-26");
    // Depois dele, vira o trimestre seguinte (virada de ano).
    expect(nextThirteenthSabbath("2026-12-27")).toBe("2027-03-27");
  });

  it("sem vínculo (ou vínculo estranho) mantém a data", () => {
    expect(liturgyTargetDate(null, "2026-11-17")).toBeNull();
    expect(liturgyTargetDate(undefined, "2026-11-17")).toBeNull();
    expect(liturgyTargetDate({ type: "outro" as never, value: "x" }, "2026-11-17")).toBeNull();
  });

  it("data de origem inválida não inventa destino", () => {
    expect(nextWeekday("17/11/2026", 6)).toBeNull();
    expect(nextThirteenthSabbath("2026-13-01")).toBeNull();
  });
});
