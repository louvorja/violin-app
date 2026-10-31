<template>
  <DialogRoot v-model:open="model">
    <DialogPortal>
      <DialogOverlay class="quicknav-overlay" />
      <DialogContent as-child v-bind="{ 'aria-describedby': undefined }">
        <div
          ref="cardRef"
          class="quicknav-card"
          @mousedown.prevent="focusInput"
          @touchend.prevent="focusInput"
        >
          <VisuallyHidden>
            <DialogTitle>{{ t("modules.bible.title") }}</DialogTitle>
          </VisuallyHidden>
          <input
            ref="inputRef"
            class="quicknav-hidden-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            @keydown="handleKeydown"
            @input="onInput"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
          />
          <div class="quicknav-steps">
            <div :class="['quicknav-step', { current: activeStep === 0 }]">
              <span class="quicknav-step-num">1</span>
              <span>{{ t("modules.bible.quicknav.step_book") }}</span>
            </div>
            <div class="quicknav-arrow">→</div>
            <div :class="['quicknav-step', { current: activeStep === 1 }]">
              <span class="quicknav-step-num">2</span>
              <span>{{ t("modules.bible.quicknav.step_chapter") }}</span>
            </div>
            <div class="quicknav-arrow">→</div>
            <div :class="['quicknav-step', { current: activeStep === 2 }]">
              <span class="quicknav-step-num">3</span>
              <span>{{ t("modules.bible.quicknav.step_verse") }}</span>
            </div>
          </div>

          <div v-if="!books" class="quicknav-display">
            <LjSpinner :size="24" />
          </div>

          <div v-else class="quicknav-display">
            <div class="quicknav-hint">
              <template v-if="activeStep === 0">
                {{ t("modules.bible.quicknav.hint_book") }}
              </template>
              <template v-else-if="activeStep === 1">
                {{ t("modules.bible.quicknav.hint_chapter") }}
              </template>
              <template v-else>{{ t("modules.bible.quicknav.hint_verse") }}</template>
            </div>
            <div class="quicknav-buffer">
              <span class="quicknav-text">{{ buffer || "—" }}</span>
              <span class="quicknav-cursor">|</span>
            </div>
            <div class="quicknav-preview">{{ feedback || " " }}</div>
            <div class="quicknav-footer">
              <span v-if="activeStep === 0" v-html="t('modules.bible.quicknav.foot_book')" />
              <span
                v-else-if="activeStep === 1"
                v-html="t('modules.bible.quicknav.foot_chapter')"
              />
              <span v-else v-html="t('modules.bible.quicknav.foot_verse')" />
            </div>
          </div>

          <button class="quicknav-close" @click="model = false">
            <LjIcon size="18" :icon="ICONS.ACTIONS.CLOSE" />
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { ICONS } from "@/config/Icons";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from "reka-ui";
import { useI18n } from "vue-i18n";
import { LjIcon, LjSpinner } from "@/components/ui";
import Database from "@/helpers/Database";
import AppData from "@/helpers/AppData";
import UserData from "@/helpers/UserData";
import Modules from "@/helpers/Modules";
import ProjectionWindows from "@/helpers/ProjectionWindows";
import Broadcast from "@/helpers/Broadcast";
import type { BibleBook, BibleSearchResult, BibleVersePayload, BibleVersion } from "@/types/Bible";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { buscarLivros } from "@/helpers/BibleBookSearch";
import { KEYS } from "@/constants/UserDataKeys";

type QuickNavState = "book" | "chapter" | "verse";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    initialBuffer?: string;
    versionId?: number | null;
    /** O controle remoto envia a seleção ao host pelo evento select. */
    projectLocally?: boolean;
  }>(),
  { projectLocally: true, versionId: null }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "select", result: BibleSearchResult): void;
}>();

const { t, locale } = useI18n();

const model = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

// Quick nav state
const state = ref<QuickNavState>("book");
const buffer = ref("");
const feedback = ref("");
const activeStep = ref(0);
const selectedBook = ref<BibleBook | null>(null);
const selectedChapter = ref<number>(0);
const chapterVerses = ref<Record<string, string>>({});
const chapterLoading = ref(false);
const selectedVersion = ref<BibleVersion | null>(null);
const cardRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
let chapterGeneration = 0;
let chapterLoad: Promise<void> | null = null;
let selectionGeneration = 0;
let _composing = false;
let _lastInput = "";

// Data
const books = ref<BibleBook[] | null>(null);
const versions = ref<BibleVersion[]>([]);
let _booksLang = "";

function reset(): void {
  chapterGeneration++;
  selectionGeneration++;
  state.value = "book";
  buffer.value = "";
  feedback.value = "";
  activeStep.value = 0;
  selectedBook.value = null;
  selectedChapter.value = 0;
  chapterVerses.value = {};
  chapterLoading.value = false;
  chapterLoad = null;
  selectedVersion.value = null;
  _composing = false;
}

/* Ordinal, acento e espaços ficam com o helper — a tela só apresenta. */
function searchBooks(input: string, list: BibleBook[]): BibleBook[] {
  return buscarLivros(input, list);
}

function checkBookMatch(): void {
  if (buffer.value.length === 0) {
    feedback.value = "";
    return;
  }
  if (!books.value) return;
  const matches = searchBooks(buffer.value, books.value);
  if (matches.length === 0) {
    feedback.value = "—";
  } else if (matches.length === 1) {
    commitBook(matches[0]);
  } else {
    feedback.value =
      matches
        .slice(0, 4)
        .map((b) => b.abbreviation ?? b.name)
        .join(", ") + (matches.length > 4 ? " …" : "");
  }
}

function commitBook(b: BibleBook): void {
  feedback.value = `${b.name}`;
  selectedBook.value = b;
  state.value = "chapter";
  buffer.value = "";
  activeStep.value = 1;
  feedback.value = `${b.name} → cap. `;
}

function commitChapter(val: number): void {
  const book = selectedBook.value;
  const version = selectedVersion.value;
  if (!book || !version) return;
  const generation = ++chapterGeneration;
  selectedChapter.value = val;
  state.value = "verse";
  buffer.value = "";
  activeStep.value = 2;
  feedback.value = `${book.name} ${val}:`;
  chapterVerses.value = {};
  chapterLoading.value = true;
  const bibleFile = `bible_${version.id_bible_version}_${book.id_bible_book}_${val}`;
  chapterLoad = (async () => {
    try {
      const data = await Database.get(bibleFile);
      if (generation !== chapterGeneration) return;
      chapterVerses.value =
        data && typeof data === "object" && !Array.isArray(data)
          ? Object.fromEntries(
              Object.entries(data).filter(
                ([key, text]) => /^[1-9]\d*$/.test(key) && typeof text === "string"
              )
            )
          : {};
    } catch (error) {
      if (generation !== chapterGeneration) return;
      console.error("[BibleSpotlight] Erro ao carregar capítulo:", error);
    } finally {
      if (generation === chapterGeneration) chapterLoading.value = false;
    }
  })();
}

async function commitVerse(val: number): Promise<void> {
  const generation = chapterGeneration;
  const typedVerse = buffer.value;
  await chapterLoad;
  if (generation !== chapterGeneration || state.value !== "verse" || buffer.value !== typedVerse)
    return;
  if (!selectedBook.value || !selectedVersion.value) return;
  const text = chapterVerses.value[String(val)];
  if (!text) return;
  const reference = `${selectedBook.value.name} ${selectedChapter.value}:${val}`;
  const result: BibleSearchResult = {
    id_bible_book: selectedBook.value.id_bible_book,
    id_bible_version: selectedVersion.value.id_bible_version,
    book: selectedBook.value.name,
    chapter: selectedChapter.value,
    verse: val,
    reference,
    text,
  };
  selectResult(result);
}

async function selectResult(res: BibleSearchResult): Promise<void> {
  const generation = ++selectionGeneration;
  if (props.projectLocally && res.text && res.reference) {
    const payload: BibleVersePayload = {
      text: res.text,
      reference: res.reference,
      book_id: res.id_bible_book,
      chapter: res.chapter,
      verses: [res.verse],
      version_id: res.id_bible_version,
      version: selectedVersion.value?.abbreviation,
      active: true,
    };
    UserData.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    await ProjectionWindows.openBibleWindow();
    if (generation !== selectionGeneration) return;
    Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE_INTENT, payload);
    Modules.open("bible");
    Broadcast.send(BROADCAST_TYPE.RIBBON_SELECT_PAGE, { pageId: "ctx_bible" });
  }
  emit("select", res);
  model.value = false;
}

async function loadBooks(): Promise<void> {
  const lang = locale.value === "es" ? "es" : "pt";
  if (books.value && _booksLang === lang) return;
  try {
    const [data, versionData] = await Promise.all([
      Database.get(`${lang}_bible_book`),
      Database.get(`${lang}_bible_version`).catch(() => null),
    ]);
    if (Array.isArray(data)) {
      _booksLang = lang;
      books.value = data.filter(
        (book): book is BibleBook =>
          Number.isSafeInteger(book?.id_bible_book) &&
          book.id_bible_book > 0 &&
          typeof book.name === "string" &&
          (book.abbreviation === undefined || typeof book.abbreviation === "string") &&
          Number.isSafeInteger(book.chapters) &&
          book.chapters > 0
      );
    }
    versions.value = Array.isArray(versionData)
      ? versionData.filter(
          (version): version is BibleVersion =>
            Number.isSafeInteger(version?.id_bible_version) &&
            version.id_bible_version > 0 &&
            typeof version.name === "string" &&
            typeof version.abbreviation === "string"
        )
      : [];
  } catch (e) {
    console.error("[BibleSpotlight] Erro ao carregar livros:", e);
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (_composing || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === "Escape") {
    model.value = false;
    e.stopPropagation();
    return;
  }

  if (state.value === "book") {
    /* Dígitos também: "1 samuel" e "2pedro" são formas de pedir o ordinal. */
    if (/^[a-zA-Z0-9]$/.test(e.key)) {
      buffer.value += e.key.toLowerCase();
      e.preventDefault();
      e.stopPropagation();
      checkBookMatch();
      return;
    }
    if (e.key === "Backspace") {
      buffer.value = buffer.value.slice(0, -1);
      e.preventDefault();
      e.stopPropagation();
      if (buffer.value.length === 0) {
        activeStep.value = 0;
        feedback.value = "";
      } else {
        checkBookMatch();
      }
      return;
    }
    if (e.key === "Enter" && buffer.value.length > 0 && books.value) {
      e.preventDefault();
      e.stopPropagation();
      const matches = searchBooks(buffer.value, books.value);
      if (matches.length === 1) commitBook(matches[0]);
      return;
    }
  }

  if (state.value === "chapter") {
    const max = selectedBook.value?.chapters ?? 0;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const candidate = buffer.value + e.key;
      const val = parseInt(candidate, 10);
      if (val < 1 || val > max) return;
      buffer.value = candidate;
      if (val * 10 > max) {
        commitChapter(val);
      }
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      buffer.value = buffer.value.slice(0, -1);
      if (buffer.value.length === 0) {
        state.value = "book";
        activeStep.value = 0;
        feedback.value = "";
      }
      return;
    }
    if (e.key === " " || e.key === "." || e.key === ":" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (buffer.value.length > 0) {
        const val = parseInt(buffer.value, 10);
        if (val >= 1 && val <= max) commitChapter(val);
      }
      return;
    }
  }

  if (state.value === "verse") {
    const keys = Object.keys(chapterVerses.value).map(Number);
    const max = keys.length > 0 ? Math.max(...keys) : 0;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const candidate = buffer.value + e.key;
      const val = parseInt(candidate, 10);
      if (!Number.isSafeInteger(val) || val < 1 || (!chapterLoading.value && val > max)) return;
      buffer.value = candidate;
      const base = feedback.value.replace(/:(\s*\d*)$/, "");
      feedback.value = `${base}:${val}`;
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      buffer.value = buffer.value.slice(0, -1);
      if (buffer.value.length === 0) {
        chapterGeneration++;
        chapterLoad = null;
        chapterLoading.value = false;
        chapterVerses.value = {};
        state.value = "chapter";
        activeStep.value = 1;
        feedback.value = `${selectedBook.value?.name} → cap. `;
      } else {
        const base = feedback.value.replace(/:(\s*\d*)$/, "");
        feedback.value = `${base}:${buffer.value}`;
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const val = parseInt(buffer.value, 10);
      if (val > 0) commitVerse(val);
      return;
    }
  }
}

function focusInput(): void {
  inputRef.value?.focus();
}

function onCompositionStart(): void {
  _composing = true;
}

function onCompositionEnd(e: CompositionEvent): void {
  _composing = false;
  if (e.data) {
    const target = e.target as HTMLInputElement;
    target.value = "";
    _handleChars(e.data);
  }
}

function onInput(e: Event): void {
  if (_composing) return;
  const target = e.target as HTMLInputElement;
  const val = target.value;
  target.value = "";
  if (val.length > _lastInput.length) {
    const chars = val.slice(_lastInput.length);
    _handleChars(chars);
  }
  _lastInput = "";
}

function _handleChars(chars: string): void {
  for (const ch of chars) {
    handleKeydown(new KeyboardEvent("keydown", { key: ch }));
  }
}

watch(
  model,
  async (val: boolean) => {
    reset();
    if (val) {
      const initial = props.initialBuffer;
      const generation = chapterGeneration;
      await loadBooks();
      if (generation !== chapterGeneration) return;
      const requestedVersion =
        props.versionId ??
        (props.projectLocally
          ? AppData.get<number>(KEYS.MODULES.BIBLE.DATA.ID_BIBLE_VERSION)
          : null);
      const versionId =
        typeof requestedVersion === "number" &&
        Number.isSafeInteger(requestedVersion) &&
        requestedVersion > 0
          ? requestedVersion
          : (versions.value[0]?.id_bible_version ?? 1);
      selectedVersion.value = versions.value.find(
        (version) => version.id_bible_version === versionId
      ) ?? { id_bible_version: versionId, abbreviation: "", name: "" };
      await nextTick();
      cardRef.value?.focus();
      inputRef.value?.focus();
      _lastInput = "";
      if (initial) {
        buffer.value = initial;
        checkBookMatch();
      }
    }
  },
  { immediate: true }
);

onUnmounted(reset);
</script>

<!-- Sem `scoped`: o cartao vai para um portal no <body> e o Vue nao carimba o
     atributo de escopo la. O isolamento vem do prefixo `quicknav-`. -->
<style>
.quicknav-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--lj-z-dialog);
  background: var(--lj-black-alpha-40);
}

.quicknav-card {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: calc(var(--lj-z-dialog) + 1);
  width: 480px;
  max-width: 90vw;
  background: var(--lj-surface-bg, #1e1e1e);
  border: 1px solid var(--lj-surface-border, #444);
  border-radius: var(--lj-radius-md);
  padding: 32px 36px 28px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  outline: none;
}

.quicknav-steps {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quicknav-step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--lj-radius-pill);
  font-size: 13px;
  font-weight: 500;
  color: var(--lj-text-muted, #888);
  background: transparent;
  transition: all var(--lj-transition-normal);
}

.quicknav-step.current {
  color: #fff;
  background: var(--lj-primary, #1976d2);
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.35);
}

.quicknav-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  background: currentColor;
  color: var(--lj-surface-bg, #1e1e1e);
}

.quicknav-step.current .quicknav-step-num {
  background: #fff;
  color: var(--lj-primary, #1976d2);
}

.quicknav-arrow {
  font-size: 16px;
  color: var(--lj-text-muted, #555);
  font-weight: 300;
}

.quicknav-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.quicknav-hint {
  font-size: 15px;
  color: var(--lj-text-muted, #888);
  letter-spacing: 0.3px;
}

.quicknav-buffer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 2px;
  min-height: 56px;
  font-variant-numeric: tabular-nums;
}

.quicknav-preview {
  font-size: 20px;
  font-weight: 700;
  color: var(--lj-text-muted, #999);
  min-height: 20px;
  text-align: center;
}

.quicknav-text {
  color: var(--lj-text, #eee);
}

.quicknav-text:empty::before {
  content: "—";
  color: var(--lj-text-muted, #555);
}

.quicknav-cursor {
  display: inline-block;
  width: 3px;
  margin-left: 4px;
  animation: quicknav-blink 1s step-end infinite;
}

@keyframes quicknav-blink {
  50% {
    opacity: 0;
  }
}

.quicknav-footer {
  font-size: 13px;
  color: var(--lj-text-muted, #666);
}

.quicknav-footer kbd {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-family: inherit;
  background: var(--lj-surface-border, #333);
  border-radius: var(--lj-radius-sm);
  border: 1px solid var(--lj-text-muted, #555);
  margin: 0 2px;
}

.quicknav-close {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--lj-text-muted, #888);
  border-radius: var(--lj-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--lj-transition-normal);
}

.quicknav-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--lj-text, #eee);
}

.quicknav-card:focus {
  outline: none;
}

.quicknav-hidden-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  font-size: 16px;
  border: none;
  outline: none;
  background: transparent;
  cursor: text;
  pointer-events: none;
  resize: none;
  z-index: 0;
}
</style>
