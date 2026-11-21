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
  const version = String(chapter.version || "").trim();
  return `${chapter.book} ${chapter.chapter}${interval ? `:${interval}` : ""}${
    version ? ` (${version})` : ""
  }`;
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
