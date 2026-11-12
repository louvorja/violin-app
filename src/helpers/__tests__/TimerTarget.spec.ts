import { describe, expect, it } from "vitest";
import { NEGATIVE_WINDOW_MS, resolveTargetDate, secondsUntilTarget } from "../TimerTarget";

const NOW = new Date(2026, 10, 5, 14, 0, 0);

describe("TimerTarget", () => {
  it("horário da manhã definido à tarde é o de amanhã", () => {
    // 14:00 -> 05:00 é 15h à frente, não 9h atrás.
    expect(secondsUntilTarget("05:00", NOW.getTime())).toBe(15 * 3600);
  });

  it("horário da madrugada definido à noite é o de amanhã", () => {
    const now = new Date(2026, 10, 5, 23, 0, 0);
    expect(secondsUntilTarget("01:00", now.getTime())).toBe(2 * 3600);
  });

  it("horário que acabou de passar continua hoje e fica negativo", () => {
    const now = new Date(2026, 10, 5, 23, 0, 0);
    expect(secondsUntilTarget("22:30", now.getTime())).toBe(-30 * 60);
  });

  it("passou há mais de 2h vira amanhã", () => {
    const now = new Date(2026, 10, 5, 23, 0, 0);
    expect(secondsUntilTarget("20:30", now.getTime())).toBe(21.5 * 3600);
    expect(secondsUntilTarget("20:00", now.getTime())).toBe(21 * 3600);
  });

  it("mantém o alvo de hoje quando ele ainda está à frente", () => {
    const now = new Date(2026, 10, 5, 10, 0, 0);
    expect(secondsUntilTarget("11:00", now.getTime())).toBe(3600);
  });

  it("trata o instante exato como hoje, 0 segundo", () => {
    const noon = new Date(2026, 10, 5, 12, 0, 0);
    expect(secondsUntilTarget("12:00", noon.getTime())).toBe(0);
  });

  it("respeita a borda de 2h", () => {
    const noon = new Date(2026, 10, 5, 12, 0, 0);
    expect(secondsUntilTarget("10:00", noon.getTime())).toBe(-2 * 3600);

    const oneSecondLater = new Date(noon.getTime() + 1000);
    expect(secondsUntilTarget("10:00", oneSecondLater.getTime())).toBe(22 * 3600 - 1);
  });

  it("constrói a data com a regra e valida entradas malformadas", () => {
    const target = resolveTargetDate("05:00", NOW);
    expect(target.getDate()).toBe(6);
    expect(target.getHours()).toBe(5);
    expect(target.getMinutes()).toBe(0);

    expect(secondsUntilTarget("25:99", NOW.getTime())).toBe(10 * 3600);
  });

  it("expõe a janela padrão de 2h", () => {
    expect(NEGATIVE_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });
});
