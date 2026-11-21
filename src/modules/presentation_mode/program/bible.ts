import type { ProgramBibleRef } from "@/types/Presentation";
import type { BiblePassage as BiblePassageFull } from "@/types/Bible";
import {
  bibleRefOf,
  bibleReference,
  numbersInterval,
  verseNumbers,
  versesText,
} from "@/helpers/BibleText";
import type { BibleChapter } from "@/helpers/BibleText";

export { bibleRefOf, bibleReference, numbersInterval, verseNumbers, versesText };
export type { BibleChapter };

/** Livro, capítulo e versículos — o que identifica um trecho, como a projeção o anuncia. */
export type BiblePassage = Pick<
  BiblePassageFull,
  "book_id" | "chapter" | "verses" | "version_id"
>;

/**
 * O mesmo trecho. A versão só conta quando os dois lados a dizem: o item
 * escolhido pelo BibleSpotlight pode não trazê-la.
 */
export function samePassage(a: BiblePassage, b: BiblePassage): boolean {
  return (
    a.book_id === b.book_id &&
    a.chapter === b.chapter &&
    a.verses.join(",") === b.verses.join(",") &&
    (a.version_id === undefined || b.version_id === undefined || a.version_id === b.version_id)
  );
}

/**
 * Anda um versículo dentro do capítulo, a partir do que está no ar. Com um
 * trecho no ar, "próximo" vem depois do último e "anterior" antes do primeiro.
 * Devolve null quando não há para onde ir.
 */
export function stepVerse(
  chapter: BibleChapter,
  current: number[],
  to: "first" | "prev" | "next" | "last"
): number | null {
  const all = verseNumbers(chapter);
  if (!all.length) return null;
  if (to === "first") return all[0];
  if (to === "last") return all[all.length - 1];
  if (!current.length) return null;
  if (to === "next") return all.find((n) => n > Math.max(...current)) ?? null;
  return [...all].reverse().find((n) => n < Math.min(...current)) ?? null;
}

/** O versículo que vem depois do trecho — o retorno de palco mostra como "próximo". */
export function nextVerseOf(chapter: BibleChapter, verses: number[]): { text: string; reference: string } | null {
  const next = stepVerse(chapter, verses, "next");
  if (next === null) return null;
  return { text: chapter.verses[String(next)], reference: bibleReference(chapter, [next]) };
}
