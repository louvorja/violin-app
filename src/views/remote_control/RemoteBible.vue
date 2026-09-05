<template>
  <div class="rb-root">
    <LjButton
      variant="default"
      block
      :icon="ICONS.BIBLE.BOOK_SEARCH"
      class="rb-search"
      @click="bibleSearchOpen = true"
    >
      {{ t("shell.quick_search_short") }}
    </LjButton>

    <LjDivider class="rb-rule-top" />

    <LjField layout="column" :label="t('options.bible.version')">
      <LjSelect
        size="touch"
        :model-value="bibleSelection.version"
        :items="bibleData.versions"
        item-value="id_bible_version"
        item-label="name"
        @update:model-value="selectVersion"
      >
        <template #value="{ item }">
          <span class="rb-version">
            <span class="lj-u-truncate">{{ item?.name }}</span>
            <Icon
              v-if="item && !downloadedVersions.has(item.id_bible_version)"
              :icon="ICONS.ACTIONS.DOWNLOAD_OUTLINE"
              size="small"
              color="warning"
            />
          </span>
        </template>
        <template #item="{ item }">
          <span class="rb-version">
            <span>{{ item.name }}</span>
            <Icon
              v-if="!downloadedVersions.has(item.id_bible_version)"
              :icon="ICONS.ACTIONS.DOWNLOAD_OUTLINE"
              size="small"
              color="warning"
            />
          </span>
        </template>
      </LjSelect>
    </LjField>

    <LjField layout="column" :label="t('options.module.bible.book')">
      <LjSelect
        size="touch"
        :model-value="bibleSelection.book"
        :items="bibleData.books"
        item-value="id_bible_book"
        item-label="name"
        @update:model-value="selectBook"
      />
    </LjField>

    <div class="rb-pair">
      <LjField layout="column" :label="t('options.module.bible.chapter')">
        <LjSelect
          size="touch"
          :model-value="bibleSelection.chapter"
          :items="bibleData.chapters"
          :disabled="!bibleSelection.book"
          @update:model-value="selectChapter"
        />
      </LjField>
      <LjField layout="column" :label="t('options.module.bible.verses')">
        <LjSelect
          size="touch"
          :model-value="bibleSelection.verse"
          :items="bibleData.verses"
          :disabled="!bibleSelection.chapter"
          @update:model-value="selectVerse"
        />
      </LjField>
    </div>

    <!-- Grade de versículos do capítulo atual -->
    <template
      v-if="activeBible.active && activeBible.chapterVerses && activeBible.chapterVerses.length > 0"
    >
      <LjDivider class="rb-rule-mid" />
      <div class="rb-ref lj-u-caption">
        <Icon :icon="ICONS.BIBLE.BOOK_OPEN" size="small" />
        <span class="lj-u-truncate">{{ activeBible.reference }}</span>
      </div>
      <div class="rb-grid">
        <button
          v-for="(text, verse) in activeBible.chapterVerses"
          :key="verse"
          type="button"
          class="rb-verse"
          :class="{ 'is-active': verse + 1 === activeBible.verse }"
          @click="goToVerse(verse + 1)"
        >
          <span class="rb-verse__num">{{ verse + 1 }}</span>
          <span class="rb-verse__text" v-html="text" />
        </button>
      </div>
    </template>

    <bible-spotlight v-model="bibleSearchOpen" @select="onBibleSearchSelect" />
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjDivider, LjField, LjSelect } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import BibleSpotlight from "@/components/BibleSpotlight.vue";
import { apiFetch } from "@/helpers/ApiClient";
import type {
  ActiveBibleState,
  Bible,
  BibleBook,
  BibleSearchResult,
  BibleVerse,
  BibleVersion,
} from "@/types/Bible";

interface FullBibleCache {
  chapters: Record<string, Record<string, string>>;
}

interface LoadBibleChapterPayload {
  bookId: string | number;
  chapter: number;
  verses?: number[];
}

const props = defineProps<{
  token?: string;
  activeBible: ActiveBibleState;
}>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
  (e: "update:active-bible", value: ActiveBibleState): void;
}>();

const { t, locale } = useI18n();

const bibleSearchOpen = ref(false);
const bibleData = ref<Bible>({ versions: [], books: [], chapters: [], verses: [] });
const bibleSelection = ref<BibleVerse>({
  version: null,
  book: null,
  chapter: null,
  verse: null,
});
const fullBible = ref<FullBibleCache | null>(null);
const downloadedVersions = ref<Set<number>>(new Set());

async function loadDownloadedVersions(): Promise<void> {
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(`/api/bible-downloaded?lang=${lang}&token=${props.token}`);
    if (res.ok) {
      const data = (await res.json()) as { downloaded?: number[] };
      downloadedVersions.value = new Set(data.downloaded || []);
    }
  } catch (e) {
    console.error("[RemoteBible] loadDownloadedVersions:", e);
  }
}

/**
 * Helper que busca JSON do cache local do host via /api/db/:path.
 * Substitui Database.get() para páginas de controle remoto, evitando
 * chamadas à API externa (api.louvorja.com.br).
 */
async function dbGet<T>(relPath: string): Promise<T | null> {
  try {
    const res = await apiFetch(`/api/db/${relPath}?token=${props.token}`);
    if (res.ok) return (await res.json()) as T;
  } catch (e) {
    console.error(`[RemoteBible] dbGet(${relPath}):`, e);
  }
  return null;
}

async function loadBible(): Promise<void> {
  const lang = locale.value || "pt";

  const params = await dbGet<{ bible_versions: BibleVersion[] }>(`${lang}_params`);
  if (params?.bible_versions) {
    bibleData.value.versions = params.bible_versions;
    const preferred = await getPreferredBibleVersion();
    if (preferred && bibleData.value.versions.find((v) => v.id_bible_version == preferred)) {
      bibleSelection.value.version = preferred;
    } else if (bibleData.value.versions.length > 0) {
      bibleSelection.value.version = bibleData.value.versions[0].id_bible_version;
    }
  } else {
    const versions = await dbGet<BibleVersion[]>(`${lang}_bible_version`);
    if (versions) {
      bibleData.value.versions = versions;
      if (bibleData.value.versions.length > 0) {
        bibleSelection.value.version = bibleData.value.versions[0].id_bible_version;
      }
    }
  }

  const books = await dbGet<BibleBook[]>(`${lang}_bible_book`);
  bibleData.value.books = books || [];
}

async function getPreferredBibleVersion(): Promise<number | null> {
  try {
    const res = await apiFetch(`/api/user-data?path=id_bible_version&token=${props.token}`);
    if (res.ok) {
      const data = await res.json();
      return data.value;
    }
  } catch (e) {
    console.error("Erro ao buscar versão da bíblia:", e);
  }
  return null;
}

/**
 * O LjSelect emite `string | number`; a seleção da bíblia é numérica. Cada
 * atalho abaixo converte e reproduz a ordem que o `v-model` tinha: primeiro
 * grava o valor, depois dispara o encadeamento de carga.
 */
function selectVersion(value: string | number): void {
  bibleSelection.value.version = Number(value);
  onVersionSelect();
}

function selectBook(value: string | number): void {
  const id = Number(value);
  bibleSelection.value.book = id;
  onBookSelect(id);
}

function selectChapter(value: string | number): void {
  const num = Number(value);
  bibleSelection.value.chapter = num;
  onChapterSelect(num);
}

function selectVerse(value: string | number): void {
  const num = Number(value);
  bibleSelection.value.verse = num;
  onVerseSelect(num);
}

async function onVersionSelect(): Promise<void> {
  bibleSelection.value.book = null;
  bibleSelection.value.chapter = null;
  bibleSelection.value.verse = null;
  bibleData.value.chapters = [];
  bibleData.value.verses = [];
}

async function onBookSelect(id: number | string | null): Promise<void> {
  if (!id) {
    bibleData.value.chapters = [];
    bibleData.value.verses = [];
    return;
  }

  const bookId = Number(id);

  bibleSelection.value.chapter = null;
  bibleSelection.value.verse = null;

  const book = bibleData.value.books.find((b) => b.id_bible_book === bookId);
  if (book?.chapters) {
    bibleData.value.chapters = Array.from({ length: book.chapters }, (_, i) => i + 1);
  } else {
    const versionId = bibleSelection.value.version || (await getPreferredBibleVersion());
    const dbKey = versionId ? `bible_${versionId}_${bookId}` : `pt_bible_${bookId}`;
    const full = await dbGet<{ chapters?: Record<string, unknown> }>(dbKey);
    if (full?.chapters) {
      const chapterKeys = Object.keys(full.chapters)
        .map(Number)
        .filter((n) => !isNaN(n));
      const chaptersCount = chapterKeys.length > 0 ? Math.max(...chapterKeys) : 0;
      bibleData.value.chapters = Array.from({ length: chaptersCount }, (_, i) => i + 1);
    }
  }
  bibleData.value.verses = [];
}

function onChapterSelect(num: number | null): void {
  if (!num) {
    bibleData.value.verses = [];
    return;
  }
  bibleSelection.value.verse = null;
  loadChapterVerses(num);
}

async function loadChapterVerses(num: number): Promise<void> {
  const bookId = Number(bibleSelection.value.book);
  const versionId = bibleSelection.value.version || (await getPreferredBibleVersion());
  if (!bookId || !versionId) return;

  const dbKey = `bible_${versionId}_${bookId}_${num}`;
  const chapterData = await dbGet<Record<string, string>>(dbKey);

  if (chapterData) {
    const verseKeys = Object.keys(chapterData)
      .map(Number)
      .filter((n) => !isNaN(n));
    const versesCount = verseKeys.length > 0 ? Math.max(...verseKeys) : 0;
    bibleData.value.verses = Array.from({ length: versesCount }, (_, i) => i + 1);
    fullBible.value = { chapters: { [num]: chapterData } };

    const arr: string[] = [];
    for (let i = 1; i <= versesCount; i++) {
      arr.push(chapterData[i] || chapterData[String(i)] || "");
    }

    const book = bibleData.value.books.find((b) => b.id_bible_book === bookId);
    const reference = book ? `${book.name} ${num}` : `Capítulo ${num}`;

    emit("update:active-bible", {
      ...props.activeBible,
      active: true,
      reference,
      chapterVerses: arr,
      bookId,
      chapter: num,
      versionId,
    } as ActiveBibleState);
  }
}

function onVerseSelect(num: number | null): void {
  if (!num) return;
  projectVerse();
}

function projectVerse(): void {
  if (!bibleSelection.value.book || !bibleSelection.value.chapter || !bibleSelection.value.verse)
    return;

  const book = bibleData.value.books.find((b) => b.id_bible_book === bibleSelection.value.book);
  if (!book || !fullBible.value) return;

  const chapterData: Record<string, string> | undefined =
    fullBible.value.chapters[bibleSelection.value.chapter] ||
    fullBible.value.chapters[String(bibleSelection.value.chapter)];
  if (!chapterData) return;

  const text: string =
    chapterData[bibleSelection.value.verse] || chapterData[String(bibleSelection.value.verse)];
  const reference = `${book.name} ${bibleSelection.value.chapter}:${bibleSelection.value.verse}`;

  const arr: string[] = [];
  if (chapterData) {
    const verseKeys = Object.keys(chapterData)
      .map(Number)
      .filter((n) => !isNaN(n));
    const versesCount = verseKeys.length > 0 ? Math.max(...verseKeys) : 0;
    for (let i = 1; i <= versesCount; i++) {
      arr.push(chapterData[i] || chapterData[String(i)] || "");
    }
  }

  const newActive: ActiveBibleState = {
    ...props.activeBible,
    active: true,
    reference,
    bookId: bibleSelection.value.book,
    chapter: bibleSelection.value.chapter,
    verse: bibleSelection.value.verse,
    versionId: bibleSelection.value.version,
    chapterVerses: arr.length > 0 ? arr : props.activeBible.chapterVerses,
  };

  emit("update:active-bible", newActive);

  apiFetch(
    `/api/bible?text=${encodeURIComponent(text)}&reference=${encodeURIComponent(
      reference
    )}&bookId=${bibleSelection.value.book}&chapter=${bibleSelection.value.chapter}&verse=${
      bibleSelection.value.verse
    }&token=${props.token}`
  )
    .then((res: Response) => {
      if (!res.ok) emit("show-snackbar", "Erro ao projetar bíblia", "error");
    })
    .catch(() => emit("show-snackbar", "Erro de conexão", "error"));

  emit("show-snackbar", reference);
}

async function onBibleSearchSelect(res: BibleSearchResult): Promise<void> {
  const bookId = res.bookId ?? res.id_bible_book;

  try {
    const resProject = await apiFetch(
      `/api/bible?text=${encodeURIComponent(res.text)}&reference=${encodeURIComponent(
        res.reference
      )}&bookId=${bookId}&chapter=${res.chapter}&verse=${res.verse}&token=${props.token}`
    );
    if (resProject.ok) {
      emit("show-snackbar", t("components.music_menu.execute") + ": " + res.reference);

      if (bookId && res.chapter) {
        bibleSelection.value.book = bookId;
        bibleSelection.value.chapter = res.chapter;
        bibleSelection.value.verse = res.verse || 1;
        await onBookSelect(bookId);
        bibleSelection.value.chapter = res.chapter;
        await loadChapterVerses(res.chapter);

        emit("update:active-bible", {
          ...props.activeBible,
          active: true,
          reference: res.reference,
          bookId,
          chapter: res.chapter,
          verse: res.verse || 1,
        } as ActiveBibleState);
      }
    } else {
      const err = (await resProject.json()) as { message?: string; error?: string };
      emit(
        "show-snackbar",
        "Erro: " + (err.message || err.error || resProject.statusText),
        "error"
      );
    }
  } catch (e) {
    console.error("[RemoteBible] Erro ao projetar versículo:", e);
    emit("show-snackbar", "Erro de conexão", "error");
  }
}

function goToVerse(num: number): void {
  if (!props.activeBible.bookId || !props.activeBible.chapter) return;

  const book = bibleData.value.books.find((b) => b.id_bible_book === props.activeBible.bookId);
  if (!book) return;

  const text = props.activeBible.chapterVerses[num - 1];
  const reference = `${book.name} ${props.activeBible.chapter}:${num}`;

  apiFetch(
    `/api/bible?text=${encodeURIComponent(text)}&reference=${encodeURIComponent(reference)}&bookId=${
      props.activeBible.bookId
    }&chapter=${props.activeBible.chapter}&verse=${num}&token=${props.token}`
  ).catch(() => emit("show-snackbar", "Erro ao projetar bíblia", "error"));

  emit("update:active-bible", {
    ...props.activeBible,
    active: true,
    reference,
    verse: num,
    bookId: props.activeBible.bookId,
    chapter: props.activeBible.chapter,
  } as ActiveBibleState);
}

onMounted(() => {
  loadBible();
  loadDownloadedVersions();
});

defineExpose({
  loadBibleChapter: async (payload: LoadBibleChapterPayload): Promise<void> => {
    if (payload.bookId && payload.chapter) {
      const bId = Number(payload.bookId);
      bibleSelection.value.book = bId;
      bibleSelection.value.chapter = payload.chapter;
      bibleSelection.value.verse = payload.verses?.[0] || 1;

      if (bibleData.value.books.length === 0) {
        await loadBible();
      }

      await onBookSelect(bId);
      bibleSelection.value.chapter = payload.chapter;
      await loadChapterVerses(payload.chapter);
    }
  },
  refresh: async (): Promise<void> => {
    await loadBible();
    await loadDownloadedVersions();
  },
});
</script>

<style scoped>
.rb-root {
  padding: var(--lj-space-6);
}

.rb-search,
.rb-rule-top {
  margin-bottom: var(--lj-space-6);
}

.rb-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--lj-space-5);
}

.rb-rule-mid {
  margin: var(--lj-space-6) 0;
}

/* Faixa de referência do capítulo aberto. Sobre o fundo suave da página ela
   só se destaca com a superfície cheia, como as abas e o rodapé. */
.rb-ref {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  margin-bottom: var(--lj-space-4);
  padding: var(--lj-space-2) var(--lj-space-4);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text-muted);
}

.rb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--lj-space-4);
}

.rb-verse {
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: 16/9;
  padding: var(--lj-space-4);
  overflow: hidden;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rb-verse.is-active {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rb-verse:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rb-verse__num {
  position: absolute;
  top: var(--lj-space-2);
  left: var(--lj-space-2);
  font-size: var(--lj-text-xs);
  opacity: 0.7;
}

.rb-verse__text {
  display: -webkit-box;
  margin: auto;
  overflow: hidden;
  font-size: var(--lj-text-sm);
  line-height: 1.2;
  text-align: center;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}
</style>

<!-- Sem `scoped`: o painel do LjSelect é emitido num portal no <body> e o Vue
     não propaga o atributo de escopo para lá. O `:has` prende as regras à
     página do controle remoto — é a única do app operada com o dedo, e o item
     de 26px do catálogo é alvo de mouse. -->
<style>
.rb-version {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  max-width: 100%;
  min-width: 0;
}

body:has(.rb-root) .lj-select__item {
  height: var(--lj-ui-h-touch);
  font-size: var(--lj-ui-font-touch);
}
</style>
