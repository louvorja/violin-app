<template>
  <ModuleContainer ref="container" :manifest="manifest" @close="close">
    <template #header>
      <div class="bs-header">
        <div ref="searchBoxRef" class="bs-search-input" @mousedown="openHistory">
          <Icon :icon="ICONS.ACTIONS.SEARCH" size="small" class="bs-search-input__icon" />
          <div class="bs-search-input__terms">
            <LjChip
              v-for="(term, i) in searchTerms"
              :key="`${term}-${i}`"
              size="sm"
              removable
              @remove="removeTerm(i)"
            >
              {{ term }}
            </LjChip>
            <input
              v-model="draft"
              type="text"
              class="bs-search-input__field"
              :placeholder="searchTerms.length ? '' : t('search_placeholder')"
              :aria-label="t('search_placeholder')"
              @focus="openHistory"
              @keydown.enter="onSearchEnter"
              @keydown.esc="historyOpen = false"
              @keydown.delete="onSearchBackspace"
            />
          </div>
          <button
            v-if="searchTerms.length || draft"
            type="button"
            class="bs-search-input__clear"
            :aria-label="$t('components.ui.clear')"
            @click="clearSearch"
          >
            <Icon :icon="ICONS.ACTIONS.CLOSE" size="x-small" />
          </button>
        </div>
        <Teleport to="body">
          <div
            v-if="historyOpen && searchHistory.length"
            ref="historyRef"
            class="lj-ui-float bs-history"
          >
            <div
              v-for="term in searchHistory"
              :key="term"
              class="bs-history__item"
              :class="{ 'bs-history__item--active': searchTerms.includes(term) }"
              @mousedown.prevent="toggleHistoryTerm(term)"
            >
              <Icon size="small" class="lj-u-muted" :icon="ICONS.UI.HISTORY" />
              <span class="bs-history__label lj-u-truncate">{{ term }}</span>
              <button
                type="button"
                class="bs-history__remove"
                :aria-label="$t('components.ui.remove')"
                @mousedown.stop.prevent="removeFromHistory(term)"
              >
                <Icon size="x-small" class="lj-u-muted" :icon="ICONS.ACTIONS.CANCEL" />
              </button>
            </div>
          </div>
        </Teleport>
        <LjButton
          variant="primary"
          :disabled="!(searchTerms.length && searchTerms.some((t) => t?.trim())) || searching"
          @click="doSearch"
        >
          {{ t("search") }}
        </LjButton>
      </div>
    </template>

    <div class="bs-body">
      <template v-if="searching">
        <div class="bs-body__loading">
          <LjSpinner :size="40" />
          <span class="lj-u-caption lj-u-muted">Buscando…</span>
        </div>
      </template>
      <template v-else>
        <aside v-if="results.length" class="bs-results">
          <div class="bs-results-header">
            <small>{{ t("results_count", { n: results.length }) }}</small>
          </div>
          <div
            v-for="(res, i) in results"
            :key="i"
            class="bs-result-item"
            :class="{ 'bs-result-item--active': selectedIndex === i }"
            @click="selectResult(i)"
          >
            <div class="bs-result-ref">{{ res.reference }}</div>
            <div class="bs-result-preview" v-html="highlight(res.text, searchTerms)" />
          </div>
        </aside>

        <main v-if="currentVerse" class="bs-verse">
          <div class="bs-verse-ref">{{ currentVerse.reference }}</div>
          <div class="bs-verse-text" v-html="highlight(currentVerse.text, searchTerms)" />
          <LjButton
            :variant="isProjecting ? 'danger' : 'primary'"
            :icon="isProjecting ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.START"
            class="bs-verse-project"
            @click="projectCurrent"
          >
            {{ t("ribbon.project") }}
          </LjButton>
        </main>

        <div v-else-if="noResults" class="bs-empty">
          <Icon :icon="ICONS.MODULES.BIBLE_SEARCH" size="48" color="primary" />
          <p>{{ t("empty_hint") }}</p>
        </div>
      </template>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { LjButton, LjChip, LjSpinner } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { ref, computed, onMounted, onUnmounted, watch, type Ref } from "vue";
import { module as manifest } from "../manifest";
import type { BibleBook, BibleVersion, BibleSearchResult } from "@/types/Bible";
import ModuleContainer from "@/components/ModuleContainer.vue";
import $database from "@/helpers/Database";
import $userdata from "@/helpers/UserData";
import $broadcast from "@/helpers/Broadcast";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import ProjectionWindows from "@/helpers/ProjectionWindows";
import $modules from "@/helpers/Modules";
import { KEYS } from "@/constants/UserDataKeys";
import Fuse from "fuse.js";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { ICONS } from "@/config/Icons";

const container = ref<{ t: (key: string, named?: Record<string, unknown>) => string } | null>(null);
const t = (key: string, params?: Record<string, unknown>): string =>
  container.value?.t(key, params) || key;

const searchTerms = ref<string[]>([]);
/** Texto ainda não confirmado como termo — vira chip no Enter. */
const draft = ref("");
const searchBoxRef = ref<HTMLElement | null>(null);
const historyRef = ref<HTMLElement | null>(null);
const historyOpen = ref(false);
const searchHistory = ref<string[]>(
  $userdata.get("modules.bible_search.search_history", []) as unknown as string[]
);
const results: Ref<BibleSearchResult[]> = ref([]);
const selectedIndex = ref<number>(0);
const searching = ref<boolean>(false);
const noResults = ref<boolean>(false);
const books: Ref<BibleBook[]> = ref([]);
const versions: Ref<BibleVersion[]> = ref([]);
const selectedVersionId = ref<number | null>(null);
const isProjecting = computed(() => $userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING, false));

const versionItems = computed(() =>
  versions.value.map((v: BibleVersion) => ({
    ...v,
    abbreviation: v.abbreviation
      ? `${v.abbreviation}${v.name ? " - " + v.name : ""}`
      : v.name || v.id_bible_version,
  }))
);

const currentVerse = computed<BibleSearchResult | null>(() => {
  if (!results.value.length) return null;
  return results.value[selectedIndex.value] ?? null;
});

function byCanonicalOrder(a: BibleSearchResult, b: BibleSearchResult): number {
  if (a.id_bible_book !== b.id_bible_book) return a.id_bible_book - b.id_bible_book;
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}

function normalize(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function highlight(text: string, terms: string[]): string {
  if (!text || !terms.length) return text || "";
  const valid = terms.filter((t: string) => t?.trim());
  if (!valid.length) return text;

  const norm = normalize(text);
  const ranges: Array<[number, number]> = [];

  for (const q of valid) {
    const qNorm = normalize(q);
    if (!qNorm) continue;
    let pos = 0;
    while ((pos = norm.indexOf(qNorm, pos)) !== -1) {
      ranges.push([pos, pos + q.length]);
      pos += qNorm.length;
    }
  }

  if (!ranges.length) return text;

  ranges.sort((a, b) => b[0] - a[0]);
  let result = text;
  for (const [start, end] of ranges) {
    result =
      result.slice(0, start) + "<mark>" + result.slice(start, end) + "</mark>" + result.slice(end);
  }
  return result;
}

async function loadBooks(): Promise<void> {
  const lang = "pt";
  const data: BibleBook[] | null = await $database.get(`${lang}_bible_book`, { silent: true });
  books.value = data || [];
}

async function loadVersions(): Promise<void> {
  const lang = "pt";
  const data: BibleVersion[] | null = await $database.get(`${lang}_bible_version`, {
    silent: true,
  });
  versions.value = data || [];
  if (data?.length) {
    const saved = $userdata.get("modules.bible_search.version", null);
    selectedVersionId.value = (saved as number | null) || data[0].id_bible_version;
  }
}

async function getVersionId(): Promise<number> {
  if (selectedVersionId.value) return selectedVersionId.value;
  if (versions.value.length) {
    selectedVersionId.value = versions.value[0].id_bible_version;
    return selectedVersionId.value;
  }
  return 1;
}

function onVersionChange(val: number): void {
  $userdata.set("modules.bible_search.version", val);
}

async function doSearch(): Promise<void> {
  const terms = searchTerms.value.filter((t: string) => t?.trim());
  if (!terms.length) return;

  searching.value = true;
  results.value = [];
  selectedIndex.value = 0;
  noResults.value = false;

  try {
    const merged: BibleSearchResult[] = [];
    const seen = new Set<string>();

    for (const term of terms) {
      addToHistory(term);

      let found = await searchByReference(term);
      if (!found.length) found = await searchByKeyword(term);

      for (const r of found) {
        const key = `${r.id_bible_book}:${r.chapter}:${r.verse}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(r);
        }
      }
    }

    results.value = merged.sort(byCanonicalOrder);
  } finally {
    searching.value = false;
    if (!results.value.length) noResults.value = true;
  }
}

function addToHistory(term: string): void {
  const list = searchHistory.value.filter((t) => t !== term);
  list.unshift(term);
  searchHistory.value = list.slice(0, 10);
  $userdata.set("modules.bible_search.search_history", searchHistory.value);
}

function removeFromHistory(term: string): void {
  searchHistory.value = searchHistory.value.filter((t) => t !== term);
  $userdata.set("modules.bible_search.search_history", searchHistory.value);
}

function toggleHistoryTerm(term: string): void {
  const idx = searchTerms.value.indexOf(term);
  if (idx >= 0) {
    searchTerms.value.splice(idx, 1);
  } else {
    searchTerms.value.push(term);
  }
}

function removeTerm(index: number): void {
  searchTerms.value.splice(index, 1);
}

function clearSearch(): void {
  searchTerms.value = [];
  draft.value = "";
}

function onSearchEnter(): void {
  const value = draft.value.trim();
  if (value) {
    if (!searchTerms.value.includes(value)) searchTerms.value.push(value);
    draft.value = "";
    return;
  }
  if (searchTerms.value.length) doSearch();
}

/** Backspace com o campo vazio apaga o último termo, como num campo de tags. */
function onSearchBackspace(): void {
  if (draft.value) return;
  searchTerms.value.pop();
}

function openHistory(): void {
  if (!searchHistory.value.length) return;
  historyOpen.value = true;
  positionHistory();
}

// A lista sai num Teleport para não ser cortada pelo cabeçalho do módulo, então
// a posição é calculada à mão a partir do retângulo do campo.
function positionHistory(): void {
  requestAnimationFrame(() => {
    const pop = historyRef.value;
    const box = searchBoxRef.value;
    if (!pop || !box) return;
    const r = box.getBoundingClientRect();
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.left = `${r.left}px`;
    pop.style.width = `${r.width}px`;
  });
}

function onDocPointerDown(e: MouseEvent): void {
  if (!historyOpen.value) return;
  const target = e.target as Node;
  if (searchBoxRef.value?.contains(target)) return;
  if (historyRef.value?.contains(target)) return;
  historyOpen.value = false;
}

// Cada chip que entra ou sai muda a altura do campo — a lista tem de acompanhar.
// A contagem é a fonte: `watch` sobre o ref do array não vê push nem splice.
watch([() => searchTerms.value.length, draft], () => {
  if (historyOpen.value) positionHistory();
});

async function searchByReference(q: string): Promise<BibleSearchResult[]> {
  const refMatch = q.match(/^(\d?\s*[a-zA-Z\s]+?)\s+(\d+)(?:[\s:]+(\d+))?$/);
  if (!refMatch) return [];
  const bookSearch = normalize(refMatch[1].replace(/\s+/g, ""));
  const chapter = parseInt(refMatch[2], 10);
  const verse = refMatch[3] ? parseInt(refMatch[3], 10) : null;

  const book = books.value.find((b: BibleBook) => {
    const bn = normalize(b.name).replace(/\s+/g, "");
    const ba = normalize(b.abbreviation ?? "").replace(/\s+/g, "");
    return bn.includes(bookSearch) || ba === bookSearch;
  });
  if (!book) return [];

  const versionId = await getVersionId();
  const bibleFile = `bible_${versionId}_${book.id_bible_book}_${chapter}`;
  const chapterData: Record<string, string> | null = await $database.get(bibleFile, {
    silent: true,
  });
  if (!chapterData) return [];

  if (verse && chapterData[verse]) {
    return [
      {
        id_bible_book: book.id_bible_book,
        id_bible_version: versionId,
        book: book.name,
        chapter,
        verse,
        reference: `${book.name} ${chapter}:${verse}`,
        text: chapterData[verse],
      },
    ];
  } else if (!verse) {
    return Object.entries(chapterData)
      .map(([v, txt]) => ({
        id_bible_book: book.id_bible_book,
        id_bible_version: versionId,
        book: book.name,
        chapter,
        verse: parseInt(v, 10),
        reference: `${book.name} ${chapter}:${v}`,
        text: txt,
      }))
      .sort(byCanonicalOrder);
  }
  return [];
}

const versesCache: BibleSearchResult[] = [];
let cachedVersionId: number | null = null;
let cachedBookList: string | null = null;

async function getVersesForSearch(): Promise<BibleSearchResult[]> {
  const versionId = await getVersionId();
  const selectedBooks: number[] = $userdata.get("modules.bible_search.books", []) || [];
  const bookListKey = selectedBooks.length ? selectedBooks.join(",") : "*";
  if (cachedVersionId === versionId && cachedBookList === bookListKey && versesCache.length) {
    return versesCache;
  }
  versesCache.length = 0;
  cachedVersionId = versionId;
  cachedBookList = bookListKey;
  for (const book of books.value) {
    if (selectedBooks.length && !selectedBooks.includes(book.id_bible_book)) continue;
    for (let ch = 1; ch <= (book.chapters || 1); ch++) {
      const bibleFile = `bible_${versionId}_${book.id_bible_book}_${ch}`;
      const chapterData: Record<string, string> | null = await $database.get(bibleFile, {
        silent: true,
      });
      if (!chapterData) continue;
      for (const [v, txt] of Object.entries(chapterData)) {
        versesCache.push({
          id_bible_book: book.id_bible_book,
          id_bible_version: versionId,
          book: book.name,
          chapter: ch,
          verse: parseInt(v, 10),
          reference: `${book.name} ${ch}:${v}`,
          text: txt,
        });
      }
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return versesCache;
}

async function searchByKeyword(q: string): Promise<BibleSearchResult[]> {
  const startTime = Date.now();
  const allVerses = await getVersesForSearch();
  const fuse = new Fuse(allVerses, {
    keys: ["text"],
    threshold: 0.1,
    ignoreLocation: true,
    minMatchCharLength: 3,
  });
  const fuseResults = fuse.search(q);
  const found = fuseResults.map((r) => r.item).sort(byCanonicalOrder);
  console.log(
    `[BibleSearch] Search "${q}" found ${found.length} results in ${Date.now() - startTime}ms (corpus: ${allVerses.length} verses)`
  );
  return found;
}

function selectResult(idx: number): void {
  selectedIndex.value = idx;
}

function prevResult(): void {
  if (selectedIndex.value > 0) selectedIndex.value--;
}

function nextResult(): void {
  if (selectedIndex.value < results.value.length - 1) selectedIndex.value++;
}

async function projectCurrent(): Promise<void> {
  const isActive = $userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING, false);
  if (isActive) {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, false);
    $broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, {
      text: "",
      reference: "",
      active: true,
    });
    await ProjectionWindows.closeBibleWindows();
    return;
  }
  const v = currentVerse.value;
  if (!v) return;
  $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
  await ProjectionWindows.openBibleWindow();
  $broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, {
    text: v.text,
    reference: v.reference,
    book_id: v.id_bible_book,
    chapter: v.chapter,
    verses: [v.verse],
    active: true,
  });
}

function openInBible(): void {
  const v = currentVerse.value;
  if (!v) return;
  $broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, {
    text: v.text,
    reference: v.reference,
    book_id: v.id_bible_book,
    chapter: v.chapter,
    verses: [v.verse],
    active: true,
  });
  $modules.open("bible");
  $broadcast.send(BROADCAST_TYPE.RIBBON_SELECT_PAGE, { pageId: "ctx_bible" });
}

function close(): void {
  searchTerms.value = [];
  draft.value = "";
  historyOpen.value = false;
  results.value = [];
  selectedIndex.value = 0;
}

useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload: unknown) => {
  const p = payload as { module?: string; action?: string } | null;
  if (p?.module !== "bible_search") return;
  if (!results.value.length) return;
  switch (p.action) {
    case "prev":
      prevResult();
      break;
    case "next":
      nextResult();
      break;
    case "go_bible":
      openInBible();
      break;
    case "project":
      projectCurrent();
      break;
  }
});

onMounted(async () => {
  document.addEventListener("mousedown", onDocPointerDown, true);
  await loadBooks();
  await loadVersions();
  const savedVersion = $userdata.get("modules.bible_search.version", null);
  if (savedVersion && versions.value.some((v) => v.id_bible_version === savedVersion)) {
    selectedVersionId.value = savedVersion as number;
  }
});

onUnmounted(() => document.removeEventListener("mousedown", onDocPointerDown, true));
</script>

<style scoped>
.bs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
}
.bs-search-input {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  flex: 1;
  min-width: 0;
  min-height: var(--lj-ui-h-lg);
  padding: 2px var(--lj-space-4);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  cursor: text;
}
.bs-search-input:focus-within {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}
.bs-search-input__icon {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}
.bs-search-input__terms {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
  flex: 1;
  min-width: 0;
  padding-block: 2px;
}
.bs-search-input__field {
  flex: 1;
  min-width: 80px;
  height: 20px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}
.bs-search-input__field::placeholder {
  color: var(--lj-text-subtle);
}
.bs-search-input__clear {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  flex-shrink: 0;
}
.bs-search-input__clear:hover {
  color: var(--lj-text);
}
.bs-history {
  position: fixed;
  z-index: var(--lj-z-popup);
  max-height: 280px;
  overflow-y: auto;
  padding: var(--lj-space-1);
  font-size: var(--lj-text-base);
}
.bs-history__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-height: var(--lj-ui-h-md);
  padding-inline: var(--lj-space-3);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text);
  cursor: pointer;
}
.bs-history__item:hover {
  background: var(--lj-surface-bg-hover);
}
.bs-history__item--active {
  background: var(--lj-ui-accent-soft);
}
.bs-history__label {
  flex: 1;
  min-width: 0;
}
.bs-history__remove {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}
.bs-version-select {
  width: 200px;
  min-width: 160px;
}
.bs-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.bs-results {
  width: 360px;
  min-width: 280px;
  overflow-y: auto;
  border-right: 1px solid var(--lj-surface-border);
  display: flex;
  flex-direction: column;
}
.bs-results-header {
  padding: 8px 12px;
  color: var(--lj-text-muted);
  border-bottom: 1px solid var(--lj-surface-border);
}
.bs-result-item {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--lj-surface-border);
  transition: background 0.15s;
}
.bs-result-item:hover {
  background: var(--lj-hover-bg);
}
.bs-result-item--active {
  background: var(--lj-ui-accent-soft);
  border-left: 3px solid var(--lj-ui-accent);
}
.bs-result-ref {
  font-weight: 600;
  font-size: 13px;
  color: var(--lj-ui-accent-text);
  margin-bottom: 2px;
}
.bs-result-preview {
  font-size: 12px;
  color: var(--lj-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bs-verse {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.bs-verse-ref {
  font-size: 14px;
  font-weight: 600;
  color: var(--lj-ui-accent-text);
  margin-bottom: 16px;
}
.bs-verse-text {
  font-size: 18px;
  line-height: 1.6;
  text-align: center;
  max-width: 700px;
}
.bs-verse-project {
  margin-top: 24px;
}
.bs-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--lj-text-muted);
}
.bs-body__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--lj-ui-accent-text);
}
</style>
