<template>
  <aside class="lit-notes-panel">
    <header class="lit-notes-header">
      <LjIcon :icon="ICONS.UI.NOTE_EDIT" size="14" />
      <span>{{ t("notes.title") }}</span>
      <div class="lj-u-spacer" />
      <span class="lit-notes-day">{{ dayLabel }}</span>
    </header>

    <div
      ref="editor"
      class="lit-notes-area"
      contenteditable="true"
      :data-placeholder="t('notes.placeholder')"
      @input="onEditorInput"
      @blur="onEditorInput"
      @keyup="guardarSelecao"
      @mouseup="guardarSelecao"
    />

    <div class="lit-notes-toolbar">
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

      <div class="lit-tb-sep" />

      <button
        class="lit-tb-btn lit-tb-btn--bold"
        :title="t('notes.bold')"
        @mousedown.prevent
        @click="exec('bold')"
      >
        N
      </button>
      <button
        class="lit-tb-btn lit-tb-btn--italic"
        :title="t('notes.italic')"
        @mousedown.prevent
        @click="exec('italic')"
      >
        I
      </button>
      <button
        class="lit-tb-btn lit-tb-btn--strike"
        :title="t('notes.strike')"
        @mousedown.prevent
        @click="exec('strikeThrough')"
      >
        S
      </button>
      <button
        class="lit-tb-btn lit-tb-btn--under"
        :title="t('notes.under')"
        @mousedown.prevent
        @click="exec('underline')"
      >
        a̲b̲c̲
      </button>

      <div class="lit-tb-sep" />

      <label class="lit-tb-color" :title="t('notes.text_color')">
        <span class="lit-tb-color-icon">A</span>
        <input
          type="color"
          :value="textColor"
          @input="
            (e) => {
              const v = (e.target as HTMLInputElement).value;
              textColor = v;
              exec('foreColor', v);
            }
          "
        />
      </label>
      <label class="lit-tb-color" :title="t('notes.bg_color')">
        <span class="lit-tb-color-icon" :style="{ background: bgColor }">A</span>
        <input
          type="color"
          :value="bgColor"
          @input="
            (e) => {
              const v = (e.target as HTMLInputElement).value;
              bgColor = v;
              exec('hiliteColor', v);
            }
          "
        />
      </label>

      <div class="lit-tb-sep" />

      <button
        class="lit-tb-btn"
        :title="t('notes.align_left')"
        @mousedown.prevent
        @click="exec('justifyLeft')"
      >
        <LjIcon :icon="ICONS.FORMAT.ALIGN_LEFT" size="14" />
      </button>
      <button
        class="lit-tb-btn"
        :title="t('notes.align_center')"
        @mousedown.prevent
        @click="exec('justifyCenter')"
      >
        <LjIcon :icon="ICONS.FORMAT.ALIGN_CENTER" size="14" />
      </button>
      <button
        class="lit-tb-btn"
        :title="t('notes.align_right')"
        @mousedown.prevent
        @click="exec('justifyRight')"
      >
        <LjIcon :icon="ICONS.FORMAT.ALIGN_RIGHT" size="14" />
      </button>

      <div class="lit-tb-sep" />

      <button
        class="lit-tb-btn"
        :title="t('notes.list_ul')"
        @mousedown.prevent
        @click="exec('insertUnorderedList')"
      >
        <LjIcon :icon="ICONS.FORMAT.LIST_BULLETED" size="14" />
      </button>
      <button
        class="lit-tb-btn"
        :title="t('notes.list_ol')"
        @mousedown.prevent
        @click="exec('insertOrderedList')"
      >
        <LjIcon :icon="ICONS.FORMAT.LIST_NUMBERED" size="14" />
      </button>
    </div>

    <footer class="lit-notes-footer">
      <LjIcon :icon="ICONS.TIMER.CLOCK" size="12" />
      <span>{{ t("data.total") }}: {{ totalDuration }}min</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { LjIcon, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, watch, onMounted } from "vue";

const props = withDefaults(
  defineProps<{
    dayLabel?: string;
    noteHtml?: string;
    totalDuration?: number;
    onInput: (event: Event) => void;
  }>(),
  { dayLabel: "", noteHtml: "", totalDuration: 0 }
);

const { t } = useLiturgyI18n();

const editor = ref<HTMLElement | null>(null);

const FONTS = ["Tahoma", "Arial", "Times New Roman", "Verdana", "Georgia", "Courier New"];
const SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];

const fontItems = FONTS.map((f) => ({ value: f, label: f }));
const sizeItems = SIZES.map((s) => ({ value: String(s), label: String(s) }));

const fontName = ref("Tahoma");
const fontSize = ref("12");
/** Cores do texto que o operador escreve — dado dele, não token do tema. */
const textColor = ref("#000000");
const bgColor = ref("#ffeb3b");

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
  emitInput();
}

function changeSize(v: string) {
  fontSize.value = v;
  if (!editor.value) return;
  restaurarSelecao();
  // execCommand fontSize aceita 1-7. Usamos um span com CSS via styleWithCSS.
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand("fontSize", false, "7");
  // Substitui font tags do execCommand por span com size em px
  const fonts = editor.value?.querySelectorAll('font[size="7"]') ?? [];
  fonts.forEach((f) => {
    const span = document.createElement("span");
    span.style.fontSize = `${v}px`;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
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

function syncFromProp() {
  if (!editor.value) return;
  // Não sobrescreve enquanto o usuário está editando — quebraria o cursor.
  if (document.activeElement === editor.value) return;
  const incoming = props.noteHtml ?? "";
  if (editor.value.innerHTML !== incoming) {
    editor.value.innerHTML = incoming;
  }
}

onMounted(() => {
  syncFromProp();
});

watch(() => props.noteHtml, syncFromProp);
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
  font-weight: var(--lj-weight-medium);
  font-size: var(--lj-text-base);
  border-bottom: 1px solid var(--lj-surface-divider);
  background: rgba(var(--lj-on-surface-ch), 0.04);
  flex-shrink: 0;
}
.lit-notes-day {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lit-notes-area {
  flex: 1;
  margin: 0;
  padding: var(--lj-space-5);
  border: 0;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-size: var(--lj-text-md);
  font-family: Tahoma, sans-serif;
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

.lit-notes-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-1);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-top: 1px solid var(--lj-surface-divider);
  background: rgba(var(--lj-on-surface-ch), 0.03);
  flex-shrink: 0;
}

.lit-tb-font :deep(.lj-select) {
  width: 116px;
}
.lit-tb-size :deep(.lj-select) {
  width: 60px;
}

.lit-tb-sep {
  width: 1px;
  height: var(--lj-space-6);
  background: var(--lj-surface-border-strong);
  margin: 0 var(--lj-space-2);
}

.lit-tb-btn {
  width: 26px;
  height: var(--lj-ui-h-sm);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  background: transparent;
  color: var(--lj-text);
  cursor: pointer;
  font-size: var(--lj-text-base);
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.lit-tb-btn:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-surface-border-strong);
}
.lit-tb-btn:focus-visible,
.lit-tb-color:focus-within {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.lit-tb-btn--bold {
  font-weight: 700;
}
.lit-tb-btn--italic {
  font-style: italic;
}
.lit-tb-btn--strike {
  text-decoration: line-through;
}

.lit-tb-color {
  position: relative;
  width: 26px;
  height: var(--lj-ui-h-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
  overflow: hidden;
}
.lit-tb-color:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-surface-border-strong);
}
.lit-tb-color-icon {
  font-weight: var(--lj-weight-bold);
  font-size: var(--lj-text-base);
  line-height: 1;
  pointer-events: none;
  padding: 0 var(--lj-space-1);
}
.lit-tb-color input[type="color"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.lit-notes-footer {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-5);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  border-top: 1px solid var(--lj-surface-divider);
  background: rgba(var(--lj-on-surface-ch), 0.03);
  flex-shrink: 0;
}
</style>
