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
            <LjPopover :title="t('actions.change_color')">
              <template #trigger>
                <button
                  type="button"
                  class="ls-cat__color"
                  :style="{ background: c.cor || DEFAULT_CATEGORY_COLOR }"
                  :title="t('actions.change_color')"
                  :aria-label="t('actions.change_color')"
                  @click.stop
                />
              </template>
              <LjColorPicker
                :model-value="c.cor || DEFAULT_CATEGORY_COLOR"
                :presets="COLORS"
                :label="t('actions.change_color')"
                @update:model-value="updateCatColor(c.id, $event)"
              />
            </LjPopover>

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
              :title="t('actions.delete')"
              :aria-label="t('actions.delete')"
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

        <div v-else-if="categoryItems.length === 0" class="ls-empty">
          <LjEmpty :icon="ICONS.UI.FILE" :title="t('schedules.no_items')" />
        </div>

        <LjTable v-else density="compact" sticky hover class="ls-table">
          <thead>
            <tr>
              <th class="ls-col-icon" />
              <th class="ls-col-date">{{ t("schedules.date") }}</th>
              <th>{{ t("schedules.item_name") }}</th>
              <th>{{ t("schedules.file") }}</th>
              <th class="ls-col-action" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in categoryItems" :key="it.id">
              <td class="ls-col-icon">
                <LjIcon
                  :icon="fileTypeIcon(String(it.arquivo || ''))"
                  :size="16"
                  class="ls-row__icon"
                />
              </td>
              <!-- `ScheduledItem` indexa campos como `unknown`: o v-model direto
                   não tipa, então a leitura vira string e a escrita é explícita. -->
              <td class="ls-col-date">
                <LjInput
                  :model-value="String(it.data ?? '')"
                  type="date"
                  size="sm"
                  class="ls-cell"
                  @update:model-value="it.data = $event"
                  @change="updateScheduled(it)"
                />
              </td>
              <td>
                <LjInput
                  :model-value="fileName(String(it.arquivo || ''))"
                  size="sm"
                  class="ls-cell"
                  readonly
                />
              </td>
              <td>
                <LjInput
                  :model-value="String(it.arquivo ?? '')"
                  size="sm"
                  class="ls-cell"
                  @update:model-value="it.arquivo = $event"
                  @change="updateScheduled(it)"
                />
              </td>
              <td class="ls-col-action">
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  class="ls-danger"
                  :icon="ICONS.ACTIONS.CLOSE"
                  :title="t('actions.delete')"
                  :aria-label="t('actions.delete')"
                  @click="removeScheduled(it.id)"
                />
              </td>
            </tr>
          </tbody>
        </LjTable>
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
import { useLiturgyI18n } from "../i18n";
import { ref } from "vue";
import {
  LjButton,
  LjColorPicker,
  LjDialog,
  LjEmpty,
  LjIcon,
  LjInput,
  LjPopover,
  LjTable,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { ScheduledCategory, ScheduledItem } from "@/types/Liturgy";
import { COLORS } from "../composables/useLiturgyItems";

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

const { t } = useLiturgyI18n();

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

.ls-cat__color {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid rgba(var(--lj-on-surface-ch), 0.25);
  border-radius: 50%;
  cursor: pointer;
  forced-color-adjust: none;
}

.ls-cat__color:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* ── Tabela de itens agendados ────────────────────────────────────────── */

.ls-table {
  flex: 1;
  min-height: 0;
}

.ls-col-icon {
  width: 34px;
  text-align: center;
}

.ls-col-date {
  width: 140px;
}

.ls-col-action {
  width: 34px;
  text-align: center;
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

.ls-cat .ls-danger:hover,
.ls-table :deep(.ls-danger:hover) {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}
</style>
