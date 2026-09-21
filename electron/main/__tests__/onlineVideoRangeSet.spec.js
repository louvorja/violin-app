// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { RangeSet } = require("../onlineVideo/rangeSet.js");

const set = (...ranges) => {
  const s = new RangeSet();
  for (const [a, b] of ranges) s.add(a, b);
  return s;
};

describe("RangeSet.add", () => {
  it("junta o que encosta e o que se sobrepõe", () => {
    expect(set([0, 9], [10, 19]).ranges).toEqual([[0, 19]]);
    expect(set([0, 9], [5, 15]).ranges).toEqual([[0, 15]]);
    expect(set([10, 19], [0, 9]).ranges).toEqual([[0, 19]]);
  });

  it("mantém separado o que tem um buraco no meio, em ordem", () => {
    expect(set([20, 29], [0, 9]).ranges).toEqual([
      [0, 9],
      [20, 29],
    ]);
  });

  it("um trecho que cobre vários engole todos", () => {
    expect(set([0, 4], [10, 14], [20, 24], [2, 22]).ranges).toEqual([[0, 24]]);
  });

  it("um trecho que preenche o buraco fecha os dois lados", () => {
    expect(set([0, 4], [10, 14], [5, 9]).ranges).toEqual([[0, 14]]);
  });

  it("repetir o que já existe não muda nada", () => {
    expect(set([0, 9], [0, 9], [3, 4]).ranges).toEqual([[0, 9]]);
  });

  it("intervalo invertido ou vazio é ignorado", () => {
    expect(set([5, 4]).ranges).toEqual([]);
  });
});

describe("RangeSet.covers", () => {
  const s = set([0, 9], [20, 29]);
  it("só é verdadeiro se o trecho inteiro está presente", () => {
    expect(s.covers(0, 9)).toBe(true);
    expect(s.covers(2, 5)).toBe(true);
    expect(s.covers(5, 12)).toBe(false); // atravessa o buraco
    expect(s.covers(10, 19)).toBe(false);
    expect(s.covers(25, 35)).toBe(false); // passa do fim
    expect(new RangeSet().covers(0, 0)).toBe(false);
  });
});

describe("RangeSet.firstGap", () => {
  it("arquivo vazio: o buraco é o arquivo todo", () => {
    expect(new RangeSet().firstGap(0, 100)).toEqual({ start: 0, end: 99 });
  });

  it("acha o primeiro buraco a partir do ponto, no meio ou no fim", () => {
    const s = set([0, 9], [20, 29]);
    expect(s.firstGap(0, 40)).toEqual({ start: 10, end: 19 });
    expect(s.firstGap(15, 40)).toEqual({ start: 15, end: 19 });
    expect(s.firstGap(25, 40)).toEqual({ start: 30, end: 39 });
  });

  it("um ponto dentro de um trecho presente pula para depois dele", () => {
    expect(set([0, 9]).firstGap(3, 100)).toEqual({ start: 10, end: 99 });
  });

  it("tudo presente do ponto em diante: null", () => {
    expect(set([0, 99]).firstGap(0, 100)).toBeNull();
    expect(set([50, 99]).firstGap(60, 100)).toBeNull();
    expect(set([0, 9]).firstGap(100, 100)).toBeNull();
  });

  it("o buraco do começo só aparece olhando de zero (o baixador volta a ele no fim)", () => {
    const s = set([50, 99]);
    expect(s.firstGap(60, 100)).toBeNull();
    expect(s.firstGap(0, 100)).toEqual({ start: 0, end: 49 });
  });
});

describe("RangeSet.bytes", () => {
  it("conta os bytes presentes", () => {
    expect(set([0, 9], [20, 24]).bytes).toBe(15);
    expect(new RangeSet().bytes).toBe(0);
  });
});
