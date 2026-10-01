import type { ProgramBibleRef } from "@/types/Presentation";

/** Um capítulo carregado: os versículos pelo número, e o que é preciso para nomeá-lo. */
export interface BibleChapter {
  versionId: number;
  version: string;
  bookId: number;
  book: string;
  chapter: number;
  verses: Record<string, string>;
}

/** [1, 2, 3, 5] → "1-3, 5". */
export function numbersInterval(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === end + 1) {
      end = n;
      continue;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    start = end = n;
  }
  if (sorted.length) parts.push(start === end ? `${start}` : `${start}-${end}`);
  return parts.join(", ");
}

/** O mesmo formato do módulo Bíblia: "João 3:16-17 (NVI)". */
export function bibleReference(chapter: BibleChapter, verses: number[]): string {
  const interval = numbersInterval(verses);
  return `${chapter.book} ${chapter.chapter}${interval ? `:${interval}` : ""} (${chapter.version})`;
}

/** Versículos salteados ganham "[...]" entre eles, como no módulo Bíblia. */
export function versesText(chapter: BibleChapter, verses: number[]): string {
  const sorted = [...verses].sort((a, b) => a - b);
  return sorted
    .map((n, i) => (i > 0 && n - sorted[i - 1] > 1 ? "[...] " : "") + (chapter.verses[String(n)] ?? ""))
    .join(" ");
}

export function verseNumbers(chapter: BibleChapter): number[] {
  return Object.keys(chapter.verses)
    .map(Number)
    .sort((a, b) => a - b);
}

export function bibleRefOf(chapter: BibleChapter, verses: number[]): ProgramBibleRef {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  return {
    reference: bibleReference(chapter, sorted),
    text: versesText(chapter, sorted),
    book_id: chapter.bookId,
    chapter: chapter.chapter,
    verses: sorted,
    version_id: chapter.versionId,
  };
}

/** Livro, capítulo e versículos — o que identifica um trecho, como a projeção o anuncia. */
export interface BiblePassage {
  book_id: number;
  chapter: number;
  verses: number[];
  version_id?: number;
}

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
