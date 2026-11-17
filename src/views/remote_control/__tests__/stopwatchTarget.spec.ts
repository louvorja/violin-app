import { describe, expect, it } from "vitest";
import {
  MAX_TARGET_SECONDS,
  formatStopwatchTarget,
  parseStopwatchTarget,
} from "../stopwatchTarget";

describe("parseStopwatchTarget", () => {
  it("aceita mm:ss e hh:mm:ss", () => {
    expect(parseStopwatchTarget("05:30")).toBe(330);
    expect(parseStopwatchTarget("01:02:03")).toBe(3723);
  });

  it("recusa zero e entrada vazia", () => {
    expect(parseStopwatchTarget("00:00")).toBeNull();
    expect(parseStopwatchTarget("00:00:00")).toBeNull();
    expect(parseStopwatchTarget("")).toBeNull();
  });

  it("usa o mesmo teto da API (99 horas)", () => {
    expect(parseStopwatchTarget("99:00:00")).toBe(MAX_TARGET_SECONDS);
    expect(parseStopwatchTarget("99:00:01")).toBeNull();
    expect(parseStopwatchTarget("99:59:59")).toBeNull();
  });

  it("recusa partes fracionarias e fora de faixa", () => {
    expect(parseStopwatchTarget("00:01.5:00")).toBeNull();
    expect(parseStopwatchTarget("00:60:00")).toBeNull();
    expect(parseStopwatchTarget("00:00:60")).toBeNull();
    expect(parseStopwatchTarget("100:00:00")).toBeNull();
  });
});

describe("formatStopwatchTarget", () => {
  it("formata sempre hh:mm:ss, inclusive no teto", () => {
    expect(formatStopwatchTarget(330)).toBe("00:05:30");
    expect(formatStopwatchTarget(MAX_TARGET_SECONDS)).toBe("99:00:00");
  });
});
