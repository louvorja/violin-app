import { describe, expect, it } from "vitest";
import { bibleRefOf, bibleReference, type BibleChapter } from "../BibleText";

const chapter = (version: string): BibleChapter => ({
  versionId: 1,
  version,
  bookId: 43,
  book: "João",
  chapter: 3,
  verses: { "16": "Porque Deus amou o mundo…" },
});

describe("referência bíblica", () => {
  it("segue o formato do módulo Bíblia", () => {
    expect(bibleReference(chapter("NVI"), [16, 17])).toBe("João 3:16-17 (NVI)");
  });

  it("não deixa parênteses vazios quando a versão não tem sigla", () => {
    expect(bibleReference(chapter(""), [16])).toBe("João 3:16");
  });

  it("monta o trecho completo com livro, capítulo, versículo e versão", () => {
    expect(bibleRefOf(chapter("NVI"), [16])).toMatchObject({
      reference: "João 3:16 (NVI)",
      book_id: 43,
      chapter: 3,
      verses: [16],
      version_id: 1,
    });
  });
});
