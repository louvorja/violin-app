import { describe, expect, it } from "vitest";
import {
  elapsedMs,
  endsAtLabel,
  formatStopwatch,
  shownSeconds,
  stopwatchAlert,
  stopwatchProgress,
} from "../stopwatchClock";

describe("stopwatchClock", () => {
  it("conta pelo relógio: um tick atrasado não perde segundos", () => {
    // Iniciado às 0 ms; o próximo tick só chegou 61 s depois (janela minimizada).
    const run = { baseMs: 0, startedAt: 1_000 };
    expect(elapsedMs(run, 62_000)).toBe(61_000);
    expect(shownSeconds("up", 0, elapsedMs(run, 62_000), true)).toBe(61);
  });

  it("soma o que já foi contado antes da pausa", () => {
    expect(elapsedMs({ baseMs: 30_000, startedAt: null }, 999_999)).toBe(30_000);
    expect(elapsedMs({ baseMs: 30_000, startedAt: 100_000 }, 105_500)).toBe(35_500);
  });

  it("regressivo mostra a meta antes de começar", () => {
    expect(formatStopwatch(shownSeconds("down", 600, 0, true), true)).toBe("10:00");
  });

  it("regressivo passa do zero com tempo excedido e para nele sem", () => {
    expect(shownSeconds("down", 60, 72_400, true)).toBe(-12);
    expect(formatStopwatch(-12, true)).toBe("-00:12");
    expect(shownSeconds("down", 60, 72_400, false)).toBe(0);
  });

  it("formata horas e esconde os segundos quando pedido", () => {
    expect(formatStopwatch(3725, true)).toBe("1:02:05");
    expect(formatStopwatch(3725, false)).toBe("1:02");
    expect(formatStopwatch(125, false)).toBe("02");
  });

  it("sem segundos, o regressivo arredonda o minuto para cima", () => {
    expect(formatStopwatch(280, false, true)).toBe("05");
    expect(formatStopwatch(30, false, true)).toBe("01");
    expect(formatStopwatch(0, false, true)).toBe("00");
    expect(formatStopwatch(-30, false, true)).toBe("-00");
    expect(formatStopwatch(3599, false, true)).toBe("1:00");
  });

  it("aviso amarelo perto do fim e vermelho só depois de chegar ao zero", () => {
    expect(stopwatchAlert("down", 61, 60, false)).toBe("");
    expect(stopwatchAlert("down", 60, 60, false)).toBe("warning");
    expect(stopwatchAlert("down", 1, 60, false)).toBe("warning");
    expect(stopwatchAlert("down", 0, 60, false)).toBe("");
    expect(stopwatchAlert("down", 0, 60, true)).toBe("danger");
    expect(stopwatchAlert("down", -30, 60, true)).toBe("danger");
    expect(stopwatchAlert("down", 30, 0, false)).toBe("");
    expect(stopwatchAlert("up", 5, 60, true)).toBe("");
  });

  it("parado na meta não avisa, mesmo com meta menor que o aviso", () => {
    expect(stopwatchAlert("down", 240, 300, false, false)).toBe("");
    expect(stopwatchAlert("down", 240, 300, false, true)).toBe("warning");
  });

  it("progresso do regressivo fica entre 0 e 1", () => {
    expect(stopwatchProgress(600, 0)).toBe(0);
    expect(stopwatchProgress(600, 300_000)).toBe(0.5);
    expect(stopwatchProgress(600, 900_000)).toBe(1);
    expect(stopwatchProgress(0, 10_000)).toBe(0);
  });

  it("calcula a hora do fim", () => {
    const now = new Date(2026, 10, 4, 19, 44, 30).getTime();
    expect(endsAtLabel(now, 462)).toBe("19:52");
  });
});
