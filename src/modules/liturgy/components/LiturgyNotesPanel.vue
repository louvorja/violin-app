<template>
  <aside class="lit-notes-panel">
    <header class="lit-notes-header">
      <LjIcon :icon="ICONS.UI.NOTE_EDIT" size="14" />
      <span>{{ t("notes.title") }}</span>
      <div class="lit-notes-spacer" />
      <span class="lit-notes-day">{{ dayLabel }}</span>
    </header>

    <div class="lit-notes-toolbar" role="toolbar" :aria-label="t('notes.title')">
      <!-- O invólucro existe porque o Vue não carimba o atributo de escopo no
           gatilho do LjSelect — ele é emitido lá dentro, pela Reka. Sem ele, a
           largura declarada aqui não casa com nada e o campo estica na barra. -->
      <span class="lit-tb-font">
        <LjSelect
          v-model="fontName"
          size="sm"
          :items="fontItems"
          :aria-label="t('notes.font')"
          @update:model-value="exec('fontName', String($event))"
        />
      </span>
      <span class="lit-tb-size">
        <LjSelect
          v-model="fontSize"
          size="sm"
          :items="sizeItems"
          :aria-label="t('notes.size')"
          @update:model-value="changeSize(String($event))"
        />
      </span>

      <LjDivider vertical class="lit-tb-sep" />

      <LjTooltip :text="t('notes.bold')">
        <LjButton
          size="sm"
          variant="ghost"
          class="lit-tb-btn lit-tb-btn--bold"
          :class="{ 'is-active': formats.bold }"
          :aria-pressed="formats.bold"
          :aria-label="t('notes.bold')"
          @mousedown.prevent
          @click="exec('bold')"
        >
          B
        </LjButton>
      </LjTooltip>
      <LjTooltip :text="t('notes.italic')">
        <LjButton
          size="sm"
          variant="ghost"
          class="lit-tb-btn lit-tb-btn--italic"
          :class="{ 'is-active': formats.italic }"
          :aria-pressed="formats.italic"
          :aria-label="t('notes.italic')"
          @mousedown.prevent
          @click="exec('italic')"
        >
          I
        </LjButton>
      </LjTooltip>
      <LjTooltip :text="t('notes.under')">
        <LjButton
          size="sm"
          variant="ghost"
          class="lit-tb-btn lit-tb-btn--under"
          :class="{ 'is-active': formats.underline }"
          :aria-pressed="formats.underline"
          :aria-label="t('notes.under')"
          @mousedown.prevent
          @click="exec('underline')"
        >
          U
        </LjButton>
      </LjTooltip>
      <LjTooltip :text="t('notes.strike')">
        <LjButton
          size="sm"
          variant="ghost"
          class="lit-tb-btn lit-tb-btn--strike"
          :class="{ 'is-active': formats.strikeThrough }"
          :aria-pressed="formats.strikeThrough"
          :aria-label="t('notes.strike')"
          @mousedown.prevent
          @click="exec('strikeThrough')"
        >
          S
        </LjButton>
      </LjTooltip>

      <LjDivider vertical class="lit-tb-sep" />

      <LjPopover :title="t('notes.text_color')">
        <template #trigger>
          <LjButton
            size="sm"
            variant="ghost"
            class="lit-tb-btn lit-tb-color-btn"
            :title="t('notes.text_color')"
            :aria-label="t('notes.text_color')"
            @mousedown.prevent="guardarSelecao"
          >
            <span
              class="lit-tb-color-icon lit-tb-color-icon--text"
              :style="{ borderBottomColor: textColor }"
            >
              A
            </span>
          </LjButton>
        </template>
        <LjColorPicker
          :model-value="textColor"
          :presets="TEXT_COLOR_PRESETS"
          :label="t('notes.text_color')"
          @update:model-value="applyTextColor"
        />
      </LjPopover>

      <LjPopover :title="t('notes.bg_color')">
        <template #trigger>
          <LjButton
            size="sm"
            variant="ghost"
            class="lit-tb-btn lit-tb-color-btn"
            :title="t('notes.bg_color')"
            :aria-label="t('notes.bg_color')"
            @mousedown.prevent="guardarSelecao"
          >
            <span class="lit-tb-color-icon lit-tb-color-icon--bg" :style="{ background: bgColor }">
              A
            </span>
          </LjButton>
        </template>
        <LjColorPicker
          :model-value="bgColor"
          :presets="BG_COLOR_PRESETS"
          :label="t('notes.bg_color')"
          @update:model-value="applyBgColor"
        />
      </LjPopover>

      <LjDivider vertical class="lit-tb-sep" />

      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :class="{ 'is-active': formats.justifyLeft }"
        :aria-pressed="formats.justifyLeft"
        :icon="ICONS.FORMAT.ALIGN_LEFT"
        :title="t('notes.align_left')"
        :aria-label="t('notes.align_left')"
        @mousedown.prevent
        @click="exec('justifyLeft')"
      />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :class="{ 'is-active': formats.justifyCenter }"
        :aria-pressed="formats.justifyCenter"
        :icon="ICONS.FORMAT.ALIGN_CENTER"
        :title="t('notes.align_center')"
        :aria-label="t('notes.align_center')"
        @mousedown.prevent
        @click="exec('justifyCenter')"
      />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :class="{ 'is-active': formats.justifyRight }"
        :aria-pressed="formats.justifyRight"
        :icon="ICONS.FORMAT.ALIGN_RIGHT"
        :title="t('notes.align_right')"
        :aria-label="t('notes.align_right')"
        @mousedown.prevent
        @click="exec('justifyRight')"
      />

      <LjDivider vertical class="lit-tb-sep" />

      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :class="{ 'is-active': formats.insertUnorderedList }"
        :aria-pressed="formats.insertUnorderedList"
        :icon="ICONS.FORMAT.LIST_BULLETED"
        :title="t('notes.list_ul')"
        :aria-label="t('notes.list_ul')"
        @mousedown.prevent
        @click="exec('insertUnorderedList')"
      />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :class="{ 'is-active': formats.insertOrderedList }"
        :aria-pressed="formats.insertOrderedList"
        :icon="ICONS.FORMAT.LIST_NUMBERED"
        :title="t('notes.list_ol')"
        :aria-label="t('notes.list_ol')"
        @mousedown.prevent
        @click="exec('insertOrderedList')"
      />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        class="lit-tb-btn"
        :icon="ICONS.UI.ERASER"
        :title="t('notes.clear_format')"
        :aria-label="t('notes.clear_format')"
        @mousedown.prevent
        @click="exec('removeFormat')"
      />
    </div>

    <div
      ref="editor"
      class="lit-notes-area"
      contenteditable="true"
      :aria-label="t('notes.title')"
      :data-placeholder="t('notes.placeholder')"
      @input="onEditorInput"
      @blur="onEditorInput"
      @paste="onPaste"
      @keyup="onSelectionChange"
      @mouseup="onSelectionChange"
      @scroll.passive="rememberScroll"
    />

    <footer class="lit-notes-footer">
      <LjIcon :icon="ICONS.TIMER.CLOCK" size="13" />
      <span>{{ t("data.total") }}:</span>
      <strong class="lit-notes-footer__value">{{ formattedTotal }}</strong>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { setScrollPosition, restoreScrollPosition } from "@/helpers/ScrollMemory";
import {
  LjButton,
  LjColorPicker,
  LjDivider,
  LjIcon,
  LjPopover,
  LjSelect,
  LjTooltip,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, reactive, ref, watch, onMounted, onActivated, nextTick } from "vue";
import { formatarDuracao } from "../agenda";
import { applySafeNoteHtml, sanitizeNoteHtml } from "../sanitizeNoteHtml";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    dayLabel?: string;
    noteHtml?: string;
    totalDuration?: number;
    onInput: (event: Event) => void;
  }>(),
  { active: true, dayLabel: "", noteHtml: "", totalDuration: 0 }
);

const { t } = useLiturgyI18n();

const editor = ref<HTMLElement | null>(null);

const formattedTotal = computed(() =>
  props.totalDuration > 0 ? formatarDuracao(props.totalDuration) : `0${t("units.min")}`
);

function rememberScroll() {
  if (editor.value) setScrollPosition("liturgy:notas", editor.value.scrollTop);
}

function restoreScroll() {
  void nextTick(() => {
    restoreScrollPosition(editor.value, "liturgy:notas");
  });
}

const FONTS = ["Tahoma", "Arial", "Times New Roman", "Verdana", "Georgia", "Courier New"];
const SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];

const fontItems = FONTS.map((f) => ({ value: f, label: f }));
const sizeItems = SIZES.map((s) => ({ value: String(s), label: String(s) }));

const fontName = ref("Tahoma");
const fontSize = ref("12");
/** Cores do texto que o operador escreve — dado dele, não token do tema. */
const textColor = ref("#000000");
const bgColor = ref("#ffeb3b");

const TEXT_COLOR_PRESETS = [
  "#000000",
  "#475569",
  "#dc2626",
  "#d97706",
  "#16a34a",
  "#1b4f8a",
  "#7c3aed",
  "#ffffff",
];

const BG_COLOR_PRESETS = [
  "#ffeb3b",
  "#fed7aa",
  "#fecaca",
  "#bbf7d0",
  "#bfdbfe",
  "#e9d5ff",
  "#e2e8f0",
  "#ffffff",
];

function applyTextColor(v: string) {
  const prevFocus = document.activeElement as HTMLElement | null;
  textColor.value = v;
  exec("foreColor", v);
  if (prevFocus?.closest(".lj-color-picker")) prevFocus.focus();
}

function applyBgColor(v: string) {
  const prevFocus = document.activeElement as HTMLElement | null;
  bgColor.value = v;
  exec("hiliteColor", v);
  if (prevFocus?.closest(".lj-color-picker")) prevFocus.focus();
}

const formats = reactive({
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  justifyLeft: false,
  justifyCenter: false,
  justifyRight: false,
  insertUnorderedList: false,
  insertOrderedList: false,
});

function atualizarEstadoFormatacao() {
  try {
    formats.bold = document.queryCommandState("bold");
    formats.italic = document.queryCommandState("italic");
    formats.underline = document.queryCommandState("underline");
    formats.strikeThrough = document.queryCommandState("strikeThrough");
    formats.justifyLeft = document.queryCommandState("justifyLeft");
    formats.justifyCenter = document.queryCommandState("justifyCenter");
    formats.justifyRight = document.queryCommandState("justifyRight");
    formats.insertUnorderedList = document.queryCommandState("insertUnorderedList");
    formats.insertOrderedList = document.queryCommandState("insertOrderedList");
  } catch {
    // Alguns ambientes (ex.: jsdom) não implementam queryCommandState.
  }
}

/**
 * `execCommand` age sobre a seleção corrente do documento. Os botões da barra
 * usam `@mousedown.prevent` para nunca tirar o cursor de dentro do editor, mas
 * o seletor de fonte abre um painel que recebe foco de verdade, e o seletor de
 * cor abre a janela do sistema: nos dois casos a seleção do operador se perde
 * no caminho e a formatação cairia no lugar errado — ou em lugar nenhum.
 * Guardamos o trecho antes de sair e o devolvemos antes de formatar.
 */
let selecaoGuardada: Range | null = null;

function guardarSelecao() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.value) return;
  const range = sel.getRangeAt(0);
  if (editor.value.contains(range.commonAncestorContainer)) {
    selecaoGuardada = range.cloneRange();
  }
}

function onSelectionChange() {
  guardarSelecao();
  atualizarEstadoFormatacao();
}

function restaurarSelecao() {
  if (!editor.value) return;
  editor.value.focus();
  if (!selecaoGuardada) return;
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(selecaoGuardada);
}

function exec(cmd: string, value?: string) {
  if (!editor.value) return;
  restaurarSelecao();
  // execCommand é deprecated mas continua funcionando em Electron/Chrome para edição local.
  document.execCommand(cmd, false, value);
  guardarSelecao();
  atualizarEstadoFormatacao();
  emitInput();
}

function changeSize(v: string) {
  fontSize.value = v;
  if (!editor.value) return;
  restaurarSelecao();
  // `styleWithCSS` deve ficar DESLIGADO para `fontSize` gerar `<font size="7">`;
  // com ele ligado, o Chromium gera `<span style="font-size: -webkit-xxx-large">`
  // e a substituição abaixo nunca encontrava o elemento.
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("fontSize", false, "7");
  const fonts = editor.value.querySelectorAll('font[size="7"]');
  fonts.forEach((f) => {
    const span = document.createElement("span");
    span.style.fontSize = `${v}px`;
    span.replaceChildren(...Array.from(f.childNodes));
    f.replaceWith(span);
  });
  guardarSelecao();
  emitInput();
}

function onPaste(event: ClipboardEvent) {
  const html = event.clipboardData?.getData("text/html");
  if (!html) return;
  event.preventDefault();
  const safe = sanitizeNoteHtml(html);
  document.execCommand("insertHTML", false, safe);
  guardarSelecao();
  emitInput();
}

function emitInput() {
  if (!editor.value) return;
  const ev = new CustomEvent("input", { bubbles: false });
  Object.defineProperty(ev, "target", {
    writable: false,
    value: { innerHTML: editor.value.innerHTML },
  });
  props.onInput(ev as unknown as Event);
}

function onEditorInput() {
  emitInput();
}

function syncFromProp(force = false) {
  if (!editor.value) return;
  // Não sobrescreve enquanto o usuário está editando o mesmo dia — quebraria o cursor.
  if (!force && document.activeElement === editor.value) return;
  const incoming = props.noteHtml ?? "";
  const safeHtml = sanitizeNoteHtml(incoming);
  if (editor.value.innerHTML !== safeHtml) {
    applySafeNoteHtml(editor.value, safeHtml);
  }
}

onMounted(() => {
  syncFromProp(true);
  restoreScroll();
});

onActivated(restoreScroll);

watch(
  () => props.noteHtml,
  () => syncFromProp(false)
);
// Ao trocar de dia, sincroniza mesmo se o editor estava focado.
watch(
  () => props.dayLabel,
  () => syncFromProp(true)
);
watch(
  () => props.active,
  (active) => {
    if (active) restoreScroll();
  }
);
</script>

<style scoped>
.lit-notes-panel {
  width: 320px;
  min-width: 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg);
  min-height: 0;
}

.lit-notes-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-5);
  font-weight: var(--lj-weight-semibold);
  font-size: var(--lj-text-base);
  border-bottom: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
  flex-shrink: 0;
}

.lit-notes-spacer {
  flex: 1;
}

.lit-notes-day {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: var(--lj-weight-semibold);
}

.lit-notes-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-1);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-bottom: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
  flex-shrink: 0;
}

.lit-notes-area {
  flex: 1;
  margin: 0;
  padding: var(--lj-space-5);
  border: 0;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-size: var(--lj-text-md);
  font-family: var(--lj-font-shell);
  outline: none;
  line-height: 1.5;
  overflow-y: auto;
  min-height: 0;
}
.lit-notes-area:empty::before {
  content: attr(data-placeholder);
  color: var(--lj-text-subtle);
  pointer-events: none;
}

.lit-tb-font :deep(.lj-select) {
  width: 116px;
}
.lit-tb-size :deep(.lj-select) {
  width: 60px;
}

.lit-tb-sep {
  height: var(--lj-space-6);
  align-self: center;
  margin: 0 var(--lj-space-1);
}

.lit-tb-btn {
  min-width: 24px;
  padding-inline: var(--lj-space-2);
}

.lit-tb-btn.is-active {
  background: var(--lj-ui-accent-soft);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
}

.lit-tb-btn--bold {
  font-weight: var(--lj-weight-bold);
}
.lit-tb-btn--italic {
  font-style: italic;
}
.lit-tb-btn--under {
  text-decoration: underline;
}
.lit-tb-btn--strike {
  text-decoration: line-through;
}

.lit-tb-color-btn {
  padding-inline: var(--lj-space-1);
}

.lit-tb-color-icon {
  font-weight: var(--lj-weight-bold);
  font-size: var(--lj-text-sm);
  line-height: 1.1;
  padding: 1px var(--lj-space-1);
  border-radius: 2px;
}
.lit-tb-color-icon--text {
  border-bottom: 2px solid var(--lj-text);
}
.lit-tb-color-icon--bg {
  color: var(--lj-gray-900);
  forced-color-adjust: none;
}

.lit-notes-footer {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-5);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  border-top: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
  flex-shrink: 0;
}

.lit-notes-footer__value {
  color: var(--lj-text);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 600px) {
  .lit-notes-panel {
    width: 100%;
    max-width: 100%;
    flex: 1 1 auto;
    border-left: 0;
  }

  .lit-notes-toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    touch-action: pan-x;
  }

  .lit-notes-toolbar::-webkit-scrollbar {
    display: none;
  }

  .lit-tb-font,
  .lit-tb-size,
  .lit-tb-btn,
  .lit-tb-sep {
    flex: 0 0 auto;
  }

  .lit-tb-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .lit-tb-font :deep(.lj-select),
  .lit-tb-size :deep(.lj-select) {
    min-height: 44px;
  }
}
</style>
