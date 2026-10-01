<template>
  <div class="pm-bible" data-testid="pm-library-bible">
    <nav class="pm-bible__books" :aria-label="tm('bible.books')">
      <div class="pm-bible__filter">
        <LjInput
          v-model="bookQuery"
          size="sm"
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="tm('bible.find_book')"
          clearable
        />
      </div>
      <div class="pm-bible__book-list">
        <button
          v-for="b in filteredBooks"
          :key="b.id_bible_book"
          type="button"
          class="pm-bible__book"
          :class="{ 'pm-bible__book--active': b.id_bible_book === bible.bookId.value }"
          :data-testid="`pm-bible-book-${b.id_bible_book}`"
          @click="bible.openBook(b.id_bible_book)"
        >
          <span class="pm-bible__book-dot" :style="b.color ? { background: b.color } : undefined" />
          <span class="pm-bible__book-name">{{ b.name }}</span>
          <span class="pm-bible__book-count">{{ b.chapters }}</span>
        </button>
      </div>
    </nav>

    <div class="pm-bible__main">
      <header class="pm-bible__head">
        <LjButton
          v-if="chapter"
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.ARROW_LEFT"
          :title="tm('bible.chapters')"
          data-testid="pm-bible-back"
          @click="bible.closeChapter()"
        />
        <span class="pm-bible__title">{{ title }}</span>
        <template v-if="chapter">
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.PREVIOUS"
            :title="tm('bible.prev_chapter')"
            :disabled="chapter.chapter <= 1"
            @click="openChapter(chapter.chapter - 1)"
          />
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.NEXT"
            :title="tm('bible.next_chapter')"
            :disabled="chapter.chapter >= (book?.chapters ?? 0)"
            @click="openChapter(chapter.chapter + 1)"
          />
        </template>
        <div class="pm-bible__version">
          <LjSelect
            :model-value="bible.versionId.value"
            :items="versionItems"
            size="sm"
            :aria-label="tm('bible.version')"
            data-testid="pm-bible-version"
            @update:model-value="(v) => v != null && bible.setVersion(Number(v))"
          />
        </div>
      </header>

      <p v-if="bible.loading.value" class="pm-bible__note">{{ tm("library.loading") }}</p>

      <ol v-else-if="chapter" ref="list" class="pm-verses" data-testid="pm-bible-verses">
        <li
          v-for="n in numbers"
          :key="n"
          class="pm-verse"
          :class="{
            'pm-verse--selected': selected.includes(n),
            'pm-verse--live': liveVerses.includes(n),
          }"
          role="button"
          tabindex="0"
          :data-testid="`pm-verse-${n}`"
          @click="select(n, $event)"
          @dblclick="play(n)"
          @keydown.enter.self="play(n)"
        >
          <span class="pm-verse__num">{{ n }}</span>
          <span class="pm-verse__text">{{ chapter.verses[String(n)] }}</span>
          <span class="pm-verse__actions">
            <LjTooltip :text="tm('library.play')">
              <button
                type="button"
                class="pm-verse__btn"
                :aria-label="tm('library.play')"
                :data-testid="`pm-verse-play-${n}`"
                @click.stop="play(n)"
                @dblclick.stop
              >
                <LjIcon :icon="ICONS.PLAYER.PLAY" :size="13" />
              </button>
            </LjTooltip>
            <LjTooltip :text="tm('library.add_to_program')">
              <button
                type="button"
                class="pm-verse__btn"
                :aria-label="tm('library.add_to_program')"
                :data-testid="`pm-verse-add-${n}`"
                @click.stop="emit('add', bibleItem(refFor(n)))"
                @dblclick.stop
              >
                <LjIcon :icon="ICONS.ACTIONS.ADD" :size="13" />
              </button>
            </LjTooltip>
          </span>
        </li>
      </ol>

      <div v-else-if="book" class="pm-chapters" data-testid="pm-bible-chapters">
        <button
          v-for="n in book.chapters"
          :key="n"
          type="button"
          class="pm-chapter"
          :data-testid="`pm-bible-chapter-${n}`"
          @click="openChapter(n)"
        >
          {{ n }}
        </button>
      </div>

      <p v-else class="pm-bible__note">{{ tm("bible.pick_book") }}</p>
      <p v-if="chapter && !bible.loading.value" class="pm-bible__hint">{{ tm("bible.hint") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { LjButton, LjIcon, LjInput, LjSelect, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Strings from "@/helpers/Strings";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import { bibleItem } from "../program/items";
import type { Playable } from "../program/playable";
import { useBibleLibrary } from "../composables/useBibleLibrary";
import { bibleRefOf, verseNumbers } from "../program/bible";

/**
 * Aba Bíblia da biblioteca: livro › capítulo › versículos. Um clique leva o
 * trecho para a prévia do palco — Shift estende, Ctrl/⌘ soma versículos
 * soltos; ▶ ou duplo clique projeta; + põe no programa.
 */

const props = defineProps<{ live: ProgramBibleRef | null }>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable];
  add: [item: ProgramItem];
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const bible = useBibleLibrary();
const book = bible.book;
const chapter = bible.chapter;

const bookQuery = ref("");
const filteredBooks = computed(() => {
  const q = Strings.fold(bookQuery.value.trim());
  return q ? bible.books.value.filter((b) => Strings.fold(b.name).includes(q)) : bible.books.value;
});

const versionItems = computed(() =>
  bible.versions.value.map((v) => ({ value: v.id_bible_version, label: v.abbreviation }))
);

const numbers = computed(() => (chapter.value ? verseNumbers(chapter.value) : []));

const title = computed(() => {
  if (chapter.value) return `${chapter.value.book} ${chapter.value.chapter}`;
  return book.value?.name ?? tm("bible.title");
});

const liveVerses = computed(() => {
  const live = props.live;
  const c = chapter.value;
  if (
    !live ||
    !c ||
    live.version_id !== c.versionId ||
    live.book_id !== c.bookId ||
    live.chapter !== c.chapter
  )
    return [];
  return live.verses;
});

const selected = ref<number[]>([]);
let anchor: number | null = null;
watch(chapter, () => {
  selected.value = [];
  anchor = null;
});

/** Próximo/Anterior nas saídas: a seleção acompanha o versículo no ar e a lista rola até ele. */
const list = ref<HTMLElement | null>(null);
watch(
  () => liveVerses.value.join(","),
  async (key) => {
    if (!key) return;
    selected.value = [...liveVerses.value];
    anchor = liveVerses.value[0];
    await nextTick();
    list.value?.querySelector(".pm-verse--live")?.scrollIntoView({ block: "nearest" });
  }
);

function select(n: number, event: MouseEvent): void {
  if (!chapter.value) return;
  if (event.shiftKey && anchor !== null) {
    const [from, to] = anchor < n ? [anchor, n] : [n, anchor];
    selected.value = numbers.value.filter((v) => v >= from && v <= to);
  } else if (event.ctrlKey || event.metaKey) {
    selected.value = selected.value.includes(n)
      ? selected.value.filter((v) => v !== n)
      : [...selected.value, n];
    anchor = n;
  } else {
    selected.value = [n];
    anchor = n;
  }
  if (selected.value.length)
    emit("preview", { type: "bible", ref: bibleRefOf(chapter.value, selected.value) });
}

/** A ação vale para a seleção quando o versículo faz parte dela; senão, só para ele. */
function refFor(n: number): ProgramBibleRef {
  const verses = selected.value.includes(n) ? selected.value : [n];
  return bibleRefOf(chapter.value!, verses);
}

function play(n: number): void {
  emit("play", { type: "bible", ref: refFor(n) });
}

function openChapter(n: number): void {
  if (book.value) void bible.openChapter(book.value.id_bible_book, n);
}

onMounted(() => void bible.ensureLoaded(locale.value));
watch(locale, (l) => void bible.ensureLoaded(l));
</script>

<style scoped>
.pm-bible {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-bible__books {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-bible__filter {
  padding: 6px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-bible__book-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.pm-bible__book {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 25px;
  padding: 0 8px 0 9px;
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms var(--lj-ease);
}

.pm-bible__book:hover {
  background: var(--lj-hover-bg);
}

.pm-bible__book--active {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-bible__book-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--lj-text-subtle);
}

.pm-bible__book-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-bible__book-count {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}

.pm-bible__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-bible__head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-bible__title {
  min-width: 0;
  margin-right: 4px;
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-bible__version {
  width: 110px;
  margin-left: auto;
  flex-shrink: 0;
}

.pm-bible__note {
  margin: auto;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
}

.pm-bible__hint {
  margin: 0;
  padding: 3px 8px;
  flex-shrink: 0;
  border-top: 1px solid var(--lj-surface-border);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-chapters {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  align-content: start;
}

.pm-chapter {
  height: 30px;
  padding: 0;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font: inherit;
  font-family: var(--lj-font-mono);
  font-size: 12px;
  cursor: pointer;
}

.pm-chapter:hover,
.pm-chapter:focus-visible {
  outline: none;
  border-color: var(--lj-navy-active);
}

.pm-verses {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.pm-verse {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 8px 4px 5px;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--lj-surface-divider);
  cursor: pointer;
  user-select: none;
  transition: background 120ms var(--lj-ease);
}

.pm-verse:hover {
  background: var(--lj-hover-bg);
}

.pm-verse:focus-visible {
  outline: none;
  box-shadow: inset var(--lj-ui-focus);
}

.pm-verse--selected {
  background: var(--lj-live-active-bg);
}

.pm-verse--live {
  border-left-color: var(--lj-orange);
}

.pm-verse__num {
  width: 22px;
  flex-shrink: 0;
  padding-top: 1px;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  text-align: right;
}

.pm-verse--live .pm-verse__num {
  color: var(--lj-orange);
  font-weight: 700;
}

.pm-verse__text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
}

.pm-verse__actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 120ms var(--lj-ease);
}

.pm-verse:hover .pm-verse__actions,
.pm-verse:focus-within .pm-verse__actions {
  opacity: 1;
}

.pm-verse__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  cursor: pointer;
}

.pm-verse__btn:hover {
  border-color: var(--lj-navy-active);
}

.pm-verse__btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
