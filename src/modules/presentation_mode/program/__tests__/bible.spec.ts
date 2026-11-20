import { describe, expect, it } from "vitest";
import { bibleRefOf, nextVerseOf, numbersInterval, stepVerse, type BibleChapter } from "../bible";

const john3: BibleChapter = {
  versionId: 1,
  version: "NVI",
  bookId: 43,
  book: "João",
  chapter: 3,
  verses: { "1": "um", "2": "dois", "3": "três", "16": "dezesseis", "17": "dezessete" },
};

describe("bible", () => {
  it("agrupa números seguidos em intervalos", () => {
    expect(numbersInterval([5, 1, 2, 3])).toBe("1-3, 5");
    expect(numbersInterval([])).toBe("");
  });

  it("monta a referência e o texto como o módulo Bíblia", () => {
    const ref = bibleRefOf(john3, [17, 16, 2]);
    expect(ref.reference).toBe("João 3:2, 16-17 (NVI)");
    expect(ref.text).toBe("dois [...] dezesseis dezessete");
    expect(ref.verses).toEqual([2, 16, 17]);
  });

  it("anda pelo capítulo a partir do trecho no ar", () => {
    expect(stepVerse(john3, [2, 3], "next")).toBe(16);
    expect(stepVerse(john3, [16, 17], "prev")).toBe(3);
    expect(stepVerse(john3, [17], "next")).toBeNull();
    expect(stepVerse(john3, [1], "prev")).toBeNull();
    expect(stepVerse(john3, [3], "first")).toBe(1);
    expect(stepVerse(john3, [3], "last")).toBe(17);
  });

  it("o próximo versículo vai para o retorno de palco", () => {
    expect(nextVerseOf(john3, [3])).toEqual({ text: "dezesseis", reference: "João 3:16 (NVI)" });
    expect(nextVerseOf(john3, [17])).toBeNull();
  });
});
