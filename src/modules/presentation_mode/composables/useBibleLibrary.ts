import { computed, ref, shallowRef } from "vue";
import $appdata from "@/helpers/AppData";
import Database from "@/helpers/Database";
import { i18nAtual } from "@/i18n";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import type { BibleBook, BibleVersion } from "@/types/Bible";
import type { ProgramBibleRef } from "@/types/Presentation";
import type { BibleChapter } from "../program/bible";

/**
 * A Bíblia da biblioteca: versões, livros e o capítulo aberto. É um estado
 * único do módulo — a aba navega por ele, e o Próximo/Anterior das saídas
 * anda pelo capítulo do versículo no ar.
 */

const versions = shallowRef<BibleVersion[]>([]);
const books = shallowRef<BibleBook[]>([]);
const versionId = ref<number | null>(null);
const bookId = ref<number | null>(null);
const chapter = shallowRef<BibleChapter | null>(null);
const loading = ref(false);
let loadedLocale: string | null = null;

/** Capítulos já lidos: andar de versículo em versículo não volta ao banco. */
const chapterCache = new Map<string, BibleChapter>();
const MAX_CACHED = 20;

const isBook = (b: BibleBook) =>
  Number.isSafeInteger(b?.id_bible_book) && b.id_bible_book > 0 && typeof b.name === "string" && b.chapters > 0;
const isVersion = (v: BibleVersion) =>
  Number.isSafeInteger(v?.id_bible_version) && v.id_bible_version > 0 && typeof v.abbreviation === "string";

async function ensureLoaded(locale: string): Promise<void> {
  if (loadedLocale === locale && books.value.length) return;
  loading.value = true;
  try {
    const [loadedBooks, loadedVersions] = await Promise.all([
      Database.get<BibleBook[]>(`${locale}_bible_book`),
      Database.get<BibleVersion[]>(`${locale}_bible_version`),
    ]);
    books.value = (Array.isArray(loadedBooks) ? loadedBooks : []).filter(isBook);
    versions.value = (Array.isArray(loadedVersions) ? loadedVersions : []).filter(isVersion);
    if (loadedLocale !== locale) {
      chapterCache.clear();
      chapter.value = null;
      bookId.value = null;
    }
    loadedLocale = locale;
    // Começa na versão que o módulo Bíblia está usando.
    const current = $appdata.get<number>(KEYS.MODULES.BIBLE.DATA.ID_BIBLE_VERSION, 0);
    const known = versions.value.some((v) => v.id_bible_version === versionId.value);
    if (!known) {
      versionId.value = versions.value.some((v) => v.id_bible_version === current)
        ? current
        : (versions.value[0]?.id_bible_version ?? null);
    }
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.library.bible" });
  } finally {
    loading.value = false;
  }
}

async function loadChapter(vId: number, bId: number, n: number): Promise<BibleChapter | null> {
  const key = `bible_${vId}_${bId}_${n}`;
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const version = versions.value.find((v) => v.id_bible_version === vId);
  const book = books.value.find((b) => b.id_bible_book === bId);
  if (!version || !book) return null;
  const data = await Database.get<Record<string, unknown>>(key);
  const verses =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.fromEntries(
          Object.entries(data).filter((e): e is [string, string] => /^\d+$/.test(e[0]) && typeof e[1] === "string")
        )
      : {};
  if (!Object.keys(verses).length) return null;
  const result: BibleChapter = {
    versionId: vId,
    version: version.abbreviation,
    bookId: bId,
    book: book.name,
    chapter: n,
    verses,
  };
  chapterCache.set(key, result);
  if (chapterCache.size > MAX_CACHED) chapterCache.delete(chapterCache.keys().next().value!);
  return result;
}

function currentLocale(): string {
  const locale = (i18nAtual()?.global as { locale?: { value?: string } } | undefined)?.locale?.value;
  return locale ?? loadedLocale ?? "pt";
}

/**
 * O capítulo de um trecho já escolhido — item do programa ou versículo no ar.
 * Não depende de a aba Bíblia ter sido aberta antes.
 */
async function chapterOf(ref: ProgramBibleRef): Promise<BibleChapter | null> {
  if (!ref.version_id) return null;
  try {
    await ensureLoaded(currentLocale());
    return await loadChapter(ref.version_id, ref.book_id, ref.chapter);
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.bible_chapter_of" });
    return null;
  }
}

/** O capítulo do trecho, se já foi lido — sem esperar o banco. */
function cachedChapterOf(ref: ProgramBibleRef): BibleChapter | null {
  return ref.version_id ? (chapterCache.get(`bible_${ref.version_id}_${ref.book_id}_${ref.chapter}`) ?? null) : null;
}

let openGeneration = 0;

async function openChapter(bId: number, n: number): Promise<void> {
  if (!versionId.value) return;
  const generation = ++openGeneration;
  bookId.value = bId;
  loading.value = true;
  try {
    const result = await loadChapter(versionId.value, bId, n);
    if (generation === openGeneration) chapter.value = result;
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.library.bible_chapter" });
  } finally {
    if (generation === openGeneration) loading.value = false;
  }
}

/** Trocar de versão mantém o lugar: o mesmo capítulo, na outra tradução. */
async function setVersion(id: number): Promise<void> {
  versionId.value = id;
  const open = chapter.value;
  if (open) await openChapter(open.bookId, open.chapter);
}

function openBook(bId: number): void {
  openGeneration++;
  bookId.value = bId;
  chapter.value = null;
  loading.value = false;
}

function closeChapter(): void {
  if (bookId.value) openBook(bookId.value);
}

export function useBibleLibrary() {
  return {
    versions,
    books,
    versionId,
    bookId,
    book: computed(() => books.value.find((b) => b.id_bible_book === bookId.value) ?? null),
    chapter,
    loading,
    ensureLoaded,
    chapterOf,
    cachedChapterOf,
    openChapter,
    setVersion,
    openBook,
    closeChapter,
  };
}
