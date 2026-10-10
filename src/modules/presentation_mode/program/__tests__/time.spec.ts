import { describe, it, expect } from "vitest";
import type { Program, ProgramItem } from "@/types/Presentation";
import {
  forecast,
  formatDuration,
  formatHHMM,
  parseHHMM,
  plannedStarts,
  sessionStarts,
  totalMinutes,
} from "../time";

function item(id: string, plannedMinutes: number): ProgramItem {
  return { id, kind: "note", title: id, plannedMinutes };
}

// 09:00 · abertura (3 + 5) · palavra (4 + 30) → término planejado 09:42
const program: Program = {
  id: "2026-09-05",
  date: "2026-09-05",
  plannedStart: "09:00",
  createdAt: "",
  updatedAt: "",
  sessions: [
    { id: "s1", label: "Abertura", items: [item("a", 3), item("b", 5)] },
    { id: "s2", label: "Palavra", items: [item("c", 4), item("d", 30)] },
  ],
};

const at = (hhmm: string, seconds = 0) => parseHHMM(hhmm)! + seconds / 60;
const none = new Set<string>();

describe("relógio do programa", () => {
  it("formata horas e durações", () => {
    expect(parseHHMM("09:05")).toBe(545);
    expect(parseHHMM("25:00")).toBeNull();
    expect(formatHHMM(545.9)).toBe("09:05");
    expect(formatDuration(8)).toBe("8m");
    expect(formatDuration(72)).toBe("1h12m");
    expect(formatDuration(120)).toBe("2h");
  });

  it("encadeia o horário previsto de cada item e de cada sessão", () => {
    const starts = plannedStarts(program);
    expect(formatHHMM(starts.get("b")!)).toBe("09:03");
    expect(formatHHMM(starts.get("d")!)).toBe("09:12");
    expect(formatHHMM(sessionStarts(program).get("s2")!)).toBe("09:08");
    expect(totalMinutes(program)).toBe(42);
  });

  it("antes de começar, o previsto é o planejado", () => {
    const f = forecast(program, { now: at("08:50"), liveItemId: null, liveStartedAt: null, doneIds: none });
    expect(formatHHMM(f.plannedEnd)).toBe("09:42");
    expect(f.deltaMinutes).toBe(0);
    expect(f.status).toBe("on_time");
  });

  it("item ao vivo que começou tarde atrasa o término", () => {
    // "c" devia começar 09:08; entrou 09:12 → termina 09:46.
    const f = forecast(program, { now: at("09:12"), liveItemId: "c", liveStartedAt: at("09:12"), doneIds: none });
    expect(f.deltaMinutes).toBeCloseTo(4);
    expect(f.status).toBe("late");
  });

  it("item que estourou a duração não devolve tempo", () => {
    // "c" (4m) no ar desde 09:08 e ainda rodando às 09:15: faltam 30m de "d".
    const f = forecast(program, { now: at("09:15"), liveItemId: "c", liveStartedAt: at("09:08"), doneIds: none });
    expect(formatHHMM(f.forecastEnd)).toBe("09:45");
    expect(f.deltaMinutes).toBeCloseTo(3);
  });

  it("adiantado quando o programa anda antes do planejado", () => {
    const f = forecast(program, { now: at("09:05"), liveItemId: "c", liveStartedAt: at("09:05"), doneIds: none });
    expect(f.deltaMinutes).toBeCloseTo(-3);
    expect(f.status).toBe("early");
  });

  it("menos de um minuto de diferença conta como no horário", () => {
    const f = forecast(program, { now: at("09:08", 40), liveItemId: "c", liveStartedAt: at("09:08", 40), doneIds: none });
    expect(f.status).toBe("on_time");
  });

  it("programa vazio ou de outra data não compara com o relógio", () => {
    const empty = { ...program, sessions: [] };
    expect(forecast(empty, { now: at("10:40"), liveItemId: null, liveStartedAt: null, doneIds: none }).status).toBe("on_time");
    const other = forecast(program, { now: null, liveItemId: null, liveStartedAt: null, doneIds: none });
    expect(other.deltaMinutes).toBe(0);
    expect(formatHHMM(other.forecastEnd)).toBe("09:42");
  });

  it("entre itens, conta só o que não foi concluído", () => {
    const f = forecast(program, {
      now: at("09:10"),
      liveItemId: null,
      liveStartedAt: null,
      doneIds: new Set(["a", "b"]),
    });
    expect(formatHHMM(f.forecastEnd)).toBe("09:44");
  });
});
