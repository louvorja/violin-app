import { describe, expect, it } from "vitest";
import {
  isSynced,
  navigableSlide,
  nextMarked,
  slideAt,
  slideEnd,
  slideStart,
} from "../SlideMarkers";

// "Ao Único - Ovelinha Dara.slja": o slide 21 (índice 20), em branco, entrou
// depois da gravação e ficou sem horário.
const AO_UNICO = [
  1, 5, 26, 33, 37, 41, 45, 49, 56, 63, 67, 71, 75, 79, 86, 90, 98, 107, 111, 115, 0, 142, 149,
  158, 162, 167, 174, 178, 185, 195,
];

describe("SlideMarkers", () => {
  it("slide sem horário no meio da música não adianta a letra", () => {
    const at = (position: number) => slideAt(AO_UNICO, position, AO_UNICO.length);
    expect(at(0)).toBe(0);
    expect(at(10)).toBe(1);
    expect(at(28)).toBe(2);
    expect(at(34)).toBe(3);
    expect(at(120)).toBe(19);
    expect(at(141)).toBe(19);
    expect(at(145)).toBe(21);
    expect(at(200)).toBe(29);
  });

  it("marcações em ordem dão o mesmo slide que a contagem antiga", () => {
    const times = [0, 10, 10, 20, 35];
    for (let position = 0; position <= 40; position += 0.5) {
      const reached = times.filter((time) => time <= position).length;
      expect(slideAt(times, position, times.length)).toBe(Math.max(0, reached - 1));
    }
  });

  it("nunca passa do último slide quando há mais marcações que slides", () => {
    expect(slideAt([0, 1, 2], 3, 1)).toBe(0);
  });

  it("sem marcação depois do primeiro slide, a música não está sincronizada", () => {
    expect(isSynced([])).toBe(false);
    expect(isSynced([0])).toBe(false);
    expect(isSynced([3, 0, 0, 0])).toBe(false);
    expect(isSynced([0, 0, 12])).toBe(true);
  });

  it("o slide sem horário fica fora do próximo e do fim do anterior", () => {
    expect(nextMarked(AO_UNICO, 19)).toBe(21);
    expect(slideEnd(AO_UNICO, 19, 209)).toBe(142);
    expect(slideEnd(AO_UNICO, 29, 209)).toBe(209);
    expect(nextMarked(AO_UNICO, 29)).toBe(-1);
  });

  it("o início de um slide sem horário é o do último marcado antes dele", () => {
    expect(slideStart(AO_UNICO, 20)).toBe(115);
    expect(slideStart(AO_UNICO, 21)).toBe(142);
    expect(slideStart([0, 0, 12], 1)).toBe(0);
  });

  it("navegar até um slide sem horário leva ao marcado seguinte no sentido do movimento", () => {
    expect(navigableSlide(AO_UNICO, 19, 20)).toBe(21);
    expect(navigableSlide(AO_UNICO, 21, 20)).toBe(19);
    expect(navigableSlide(AO_UNICO, 5, 20)).toBe(21);
    expect(navigableSlide(AO_UNICO, 19, 19)).toBe(19);
  });

  it("sem marcado adiante, a navegação fica onde está", () => {
    expect(navigableSlide([0, 10, 20, 0, 0], 2, 3)).toBe(2);
    expect(navigableSlide([0, 10, 20, 0, 0], 2, 4)).toBe(2);
  });
});
