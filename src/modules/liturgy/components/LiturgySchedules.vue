<template>
  <LjDialog
    :model-value="modelValue"
    :title="t('schedules.title')"
    :icon="ICONS.CALENDAR.MULTISELECT"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="ls-panes">
      <aside class="ls-pane ls-pane--left">
        <div class="ls-head">
          <span>{{ t("schedules.categories") }}</span>
          <span class="lj-u-spacer" />
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.ADD"
            :title="t('schedules.add_category')"
            :aria-label="t('schedules.add_category')"
            @click="addCategory"
          />
        </div>

        <ul class="ls-cats">
          <li v-if="scheduledCategories.length === 0" class="ls-cats__hint">
            {{ t("schedules.no_categories") }}
          </li>
          <li
            v-for="c in scheduledCategories"
            :key="c.id"
            class="ls-cat"
            :class="{ 'is-active': activeCatId === c.id }"
            @click="setActiveCatId(c.id)"
          >
            <input
              type="color"
              class="ls-cat__color"
              :value="c.cor || DEFAULT_CATEGORY_COLOR"
              :title="t('actions.change_color')"
              :aria-label="t('actions.change_color')"
              @input="updateCatColor(c.id, ($event.target as HTMLInputElement).value)"
            />

            <LjInput
              v-if="editingCatId === c.id"
              v-model="editingCatName"
              size="sm"
              class="ls-cat__input"
              @blur="doSaveCatName(c.id)"
              @keyup.enter="doSaveCatName(c.id)"
              @keyup.esc="editingCatId = null"
            />
            <span v-else class="ls-cat__name" @dblclick="startEditingCategory(c)">
              {{ c.nome }}
            </span>

            <span class="lj-u-spacer" />

            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              :icon="ICONS.ACTIONS.EDIT"
              :title="t('actions.edit')"
              :aria-label="t('actions.edit')"
              @click.stop="startEditingCategory(c)"
            />
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              class="ls-danger"
              :icon="ICONS.ACTIONS.CLOSE"
              :title="t('actions.remove')"
              :aria-label="t('actions.remove')"
              @click.stop="removeCategory(c.id)"
            />
          </li>
        </ul>
      </aside>

      <section class="ls-pane ls-pane--right">
        <div class="ls-head">
          <span v-if="activeCategory">{{ activeCategory.nome }}</span>
          <span v-else>{{ t("schedules.select_category") }}</span>
          <span class="lj-u-spacer" />
          <LjButton
            v-if="activeCategory"
            size="sm"
            variant="primary"
            :icon="ICONS.ACTIONS.ADD"
            @click="addScheduledItem"
          >
            {{ t("schedules.add_item") }}
          </LjButton>
        </div>

        <div v-if="!activeCategory" class="ls-empty">
          <LjEmpty
            :icon="ICONS.CALENDAR.MULTISELECT"
            :title="t('schedules.select_category_hint')"
          />
        </div>

        <div v-else class="ls-table">
          <div class="ls-row ls-row--head">
            <span></span>
            <span>{{ t("schedules.date") }}</span>
            <span>{{ t("schedules.item_name") }}</span>
            <span>{{ t("schedules.file") }}</span>
            <span></span>
          </div>

          <div v-if="categoryItems.length === 0" class="ls-empty">
            <LjEmpty :icon="ICONS.UI.FILE" :title="t('schedules.no_items')" />
          </div>

          <div v-for="it in categoryItems" :key="it.id" class="ls-row">
            <Icon :icon="fileTypeIcon(String(it.arquivo || ''))" :size="16" class="ls-row__icon" />
            <!-- `ScheduledItem` indexa campos como `unknown`: o v-model direto
                 não tipa, então a leitura vira string e a escrita é explícita. -->
            <LjInput
              :model-value="String(it.data ?? '')"
              type="date"
              size="md"
              class="ls-cell"
              @update:model-value="it.data = $event"
              @change="updateScheduled(it)"
            />
            <LjInput
              :model-value="fileName(String(it.arquivo || ''))"
              size="md"
              class="ls-cell"
              readonly
            />
            <LjInput
              :model-value="String(it.arquivo ?? '')"
              size="md"
              class="ls-cell"
              @update:model-value="it.arquivo = $event"
              @change="updateScheduled(it)"
            />
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              class="ls-danger"
              :icon="ICONS.ACTIONS.CLOSE"
              :title="t('actions.remove')"
              :aria-label="t('actions.remove')"
              @click="removeScheduled(it.id)"
            />
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <LjButton size="sm" variant="primary" @click="$emit('update:modelValue', false)">
        {{ t("actions.close") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import pt from "../lang/pt.json";
import es from "../lang/es.json";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjEmpty, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { ScheduledCategory, ScheduledItem } from "@/types/Liturgy";

const TRANSLATIONS: Record<string, Record<string, unknown>> = { pt, es };

function _t(key: string, locale: string): string {
  const dict = TRANSLATIONS[locale] ?? TRANSLATIONS.pt;
  const path = key.split(".");
  let cur: unknown = dict;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in cur) cur = (cur as Record<string, unknown>)[k];
    else return key;
  }
  return typeof cur === "string" ? cur : key;
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    scheduledCategories?: ScheduledCategory[];
    activeCatId?: string | number | null;
    activeCategory?: ScheduledCategory | null;
    categoryItems?: ScheduledItem[];
    setActiveCatId: (id: string | number) => void;
    addCategory: () => void;
    saveCategoryName: (id: string | number, name: string) => void;
    updateCategoryColor: (id: string | number, color: string) => void;
    removeCategory: (id: string | number) => void;
    addScheduledItem: () => void;
    updateScheduled: (it: ScheduledItem) => void;
    removeScheduled: (id: string | number) => void;
  }>(),
  {
    modelValue: false,
    scheduledCategories: () => [],
    activeCatId: null,
    activeCategory: null,
    categoryItems: () => [],
  }
);

defineEmits<{ "update:modelValue": [value: boolean] }>();

const { locale } = useI18n();
const t = (key: string) => _t(key, locale.value);

/** Cor de uma categoria ainda sem cor escolhida — dado, não token de tema. */
const DEFAULT_CATEGORY_COLOR = "#1976d2";

const editingCatId = ref<string | number | null>(null);
const editingCatName = ref("");

function startEditingCategory(c: ScheduledCategory) {
  editingCatId.value = c.id;
  editingCatName.value = c.nome;
}

function doSaveCatName(id: string | number) {
  props.saveCategoryName(id, editingCatName.value);
  editingCatId.value = null;
}

function updateCatColor(id: string | number, color: string) {
  props.updateCategoryColor(id, color);
}

const FILE_ICON_MAP: Record<string, string> = {
  mp4: ICONS.MEDIA.VIDEO_FILE,
  webm: ICONS.MEDIA.VIDEO_FILE,
  mkv: ICONS.MEDIA.VIDEO_FILE,
  mov: ICONS.MEDIA.VIDEO_FILE,
  avi: ICONS.MEDIA.VIDEO_FILE,
  m4v: ICONS.MEDIA.VIDEO_FILE,
  mp3: ICONS.MUSIC.NOTE,
  wav: ICONS.MUSIC.NOTE,
  ogg: ICONS.MUSIC.NOTE,
  flac: ICONS.MUSIC.NOTE,
  aac: ICONS.MUSIC.NOTE,
  m4a: ICONS.MUSIC.NOTE,
  opus: ICONS.MUSIC.NOTE,
  wma: ICONS.MUSIC.NOTE,
  jpg: ICONS.MEDIA.IMAGE,
  jpeg: ICONS.MEDIA.IMAGE,
  png: ICONS.MEDIA.IMAGE,
  webp: ICONS.MEDIA.IMAGE,
  gif: ICONS.MEDIA.IMAGE,
  bmp: ICONS.MEDIA.IMAGE,
  heic: ICONS.MEDIA.IMAGE,
  heif: ICONS.MEDIA.IMAGE,
  pdf: ICONS.UI.FILE_PDF,
};

function fileTypeIcon(path?: string): string {
  if (!path) return ICONS.UI.FILE;
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return FILE_ICON_MAP[ext] || ICONS.UI.FILE;
}

function fileName(path?: string): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() || path;
}
</script>

<!-- O conteúdo do diálogo vai para um portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele e `scoped`
     funciona — inclusive na raiz dos primitivos filhos. -->
<style scoped>
/* ── Duas colunas ─────────────────────────────────────────────────────── */

/* Sem primitivo de painel dividido: o corpo do LjDialog já rola, então a
   moldura fica aqui e cada coluna rola por conta própria. */
.ls-panes {
  display: flex;
  min-height: 400px;
  max-height: 60vh;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  overflow: hidden;
}

.ls-pane {
  display: flex;
  flex-direction: column;
}

.ls-pane--left {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.ls-pane--right {
  flex: 1;
  min-width: 0;
}

.ls-head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-divider);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

/* ── Lista de categorias ──────────────────────────────────────────────── */

.ls-cats {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

/* Lista densa: uma linha de texto pesa menos que um LjEmpty emoldurado. */
.ls-cats__hint {
  padding: var(--lj-space-4);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.ls-cat {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-3) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-divider);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  cursor: pointer;
}

.ls-cat:hover {
  background: var(--lj-surface-bg-hover);
}

.ls-cat.is-active {
  background: var(--lj-ui-accent-soft);
  color: var(--lj-ui-accent-text);
  font-weight: var(--lj-weight-medium);
}

.ls-cat__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls-cat__input {
  flex: 1;
  min-width: 0;
}

/* Não há primitivo de cor: o <input type="color"> nativo abre o seletor do
   sistema, como o LiturgyManageDialog já faz. Aqui ele vira a própria
   bolinha da categoria. */
.ls-cat__color {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: var(--lj-ui-border);
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
}

.ls-cat__color::-webkit-color-swatch-wrapper {
  padding: 0;
}

.ls-cat__color::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}

.ls-cat__color:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* ── Tabela de itens agendados ────────────────────────────────────────── */

.ls-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* Sem primitivo de tabela: grade de colunas fixas sobre os mesmos tokens. */
.ls-row {
  display: grid;
  grid-template-columns: 30px 130px 1fr 1fr 30px;
  gap: var(--lj-space-2);
  align-items: center;
  padding: var(--lj-space-2) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.ls-row--head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  text-transform: uppercase;
}

.ls-row__icon {
  color: var(--lj-text-muted);
}

/* O LjInput é inline-flex e encolhe para o conteúdo: na célula ele ocupa tudo. */
.ls-cell {
  width: 100%;
}

.ls-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-6);
}

/* Ação destrutiva discreta: mantém o fantasma do LjButton e só troca a cor.
   O seletor descendente supera a regra `.lj-btn--ghost` do próprio primitivo. */
.ls-cat .ls-danger,
.ls-row .ls-danger {
  color: var(--lj-danger);
}

.ls-cat .ls-danger:hover,
.ls-row .ls-danger:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}
</style>
