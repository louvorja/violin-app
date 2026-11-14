<template>
  <LjDialog
    :model-value="modelValue"
    :title="title"
    :icon="icon"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="llb-toolbar">
      <LjInput
        ref="inputEl"
        v-model="query"
        :icon="ICONS.ACTIONS.SEARCH"
        :placeholder="t('library_search.find_label')"
        autocomplete="off"
        class="llb-search"
        @keydown="onKeydown"
      />
      <div class="llb-view-toggle" role="group" :aria-label="t('library_search.view_label')">
        <button
          type="button"
          class="llb-view"
          :class="{ 'llb-view--active': viewMode === 'thumbnails' }"
          :aria-pressed="viewMode === 'thumbnails'"
          :title="t('library_search.view_thumbnails')"
          @click="viewMode = 'thumbnails'"
        >
          <LjIcon :icon="ICONS.UI.VIEW_GRID" :size="16" />
        </button>
        <button
          type="button"
          class="llb-view"
          :class="{ 'llb-view--active': viewMode === 'list' }"
          :aria-pressed="viewMode === 'list'"
          :title="t('library_search.view_list')"
          @click="viewMode = 'list'"
        >
          <LjIcon :icon="ICONS.UI.VIEW_LIST" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="visibleCategories.length" class="llb-chips">
      <button
        type="button"
        class="llb-chip"
        :class="{ 'llb-chip--active': categoryFilter === null }"
        @click="selectCategory(null)"
      >
        {{ t("library_search.all_categories") }}
      </button>
      <button
        v-for="category in visibleCategories"
        :key="category.id"
        type="button"
        class="llb-chip"
        :class="{ 'llb-chip--active': categoryFilter === category.id }"
        @click="selectCategory(category.id)"
      >
        <LjIcon
          v-if="category.iconType === 'icon' && category.icon"
          :icon="category.icon"
          :size="13"
          :style="{ color: category.color }"
        />
        <img
          v-else-if="category.iconType === 'image' && category.icon"
          :src="category.icon"
          alt=""
          class="llb-chip-icon"
        />
        {{ category.name }}
      </button>
    </div>

    <div ref="viewport" class="llb-body">
      <div v-if="!flatItems.length" class="llb-empty">
        {{ query ? t("library_search.empty_search") : t("library_search.empty") }}
      </div>
      <template v-else>
        <LibraryGroupedView :groups="groups" :view="viewMode === 'thumbnails' ? 'grid' : 'list'">
          <template #grid-item="{ item }">
            <button
              type="button"
              class="llb-thumb"
              :class="{
                'llb-thumb--active': item.id === activeId,
                'llb-thumb--selected': item.id === selectedId,
              }"
              :data-library-active="item.id === activeId || undefined"
              :style="{ '--llb-item-color': itemColor(item) }"
              :title="item.name"
              @click="pick(item)"
            >
              <span class="llb-thumb-media">
                <img
                  v-if="item.thumbnail"
                  :src="item.thumbnail"
                  alt=""
                  loading="lazy"
                  draggable="false"
                />
                <LjIcon v-else :icon="item.icon || ICONS.UI.FILE_MULTIPLE" :size="28" />
                <span v-if="item.detail" class="llb-thumb-detail">{{ item.detail }}</span>
              </span>
              <span class="llb-thumb-name">{{ item.name }}</span>
              <span v-if="item.typeLabel" class="llb-thumb-type">{{ item.typeLabel }}</span>
            </button>
          </template>

          <template #list-item="{ item }">
            <button
              type="button"
              class="llb-row"
              :class="{
                'llb-row--active': item.id === activeId,
                'llb-row--selected': item.id === selectedId,
              }"
              :data-library-active="item.id === activeId || undefined"
              :style="{ '--llb-item-color': itemColor(item) }"
              :title="item.name"
              @click="pick(item)"
            >
              <span class="llb-row-icon">
                <img v-if="item.thumbnail" :src="item.thumbnail" alt="" draggable="false" />
                <LjIcon v-else :icon="item.icon || ICONS.UI.FILE_MULTIPLE" :size="18" />
              </span>
              <span class="llb-row-name">{{ item.name }}</span>
              <span v-if="item.typeLabel" class="llb-row-type">{{ item.typeLabel }}</span>
            </button>
          </template>
        </LibraryGroupedView>
      </template>
    </div>

    <template #footer>
      <span class="llb-count">{{ flatItems.length }} / {{ items.length }}</span>
      <span class="lj-u-spacer" />
      <span class="llb-hint">{{ t("library_search.keyboard_hint") }}</span>
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("actions.cancel") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
/**
 * LiturgyLibrarySearch — navegador genérico das bibliotecas da Liturgia.
 *
 * A mesma visualização serve para Biblioteca de Mídia, Som de Fundo e
 * Projeção de Fundo. O pai entrega os itens já normalizados (nome, miniatura,
 * categoria) e o componente cuida de busca, categorias, miniaturas/lista e
 * teclado. O padrão é miniaturas.
 */
import { computed, nextTick, ref, watch } from "vue";
import { LjButton, LjDialog, LjIcon, LjInput } from "@/components/ui";
import LibraryGroupedView from "@/components/LibraryGroupedView.vue";
import { ICONS } from "@/config/Icons";
import { useListNavigation } from "@/composables/useListNavigation";
import { useLiturgyI18n } from "../i18n";

export interface LibrarySearchItem {
  id: string;
  name: string;
  icon?: string;
  detail?: string;
  categoryId?: string;
  thumbnail?: string;
  typeLabel?: string;
  /** Cor da categoria/item, aplicada como fundo atenuado no card. */
  color?: string;
  /** Tipo da biblioteca de origem (image, video, audio, pdf, …). */
  type?: string;
}

export interface LibrarySearchCategory {
  id: string;
  name: string;
  icon?: string;
  iconType?: "icon" | "image";
  color?: string;
}

interface Group {
  id: string;
  name: string;
  items: LibrarySearchItem[];
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    items?: LibrarySearchItem[];
    categories?: LibrarySearchCategory[];
    title?: string;
    icon?: string;
    emptyText?: string;
    selectedId?: string;
    defaultView?: "thumbnails" | "list";
  }>(),
  {
    modelValue: false,
    items: () => [],
    categories: () => [],
    title: "",
    icon: ICONS.ACTIONS.SEARCH,
    emptyText: "",
    selectedId: "",
    defaultView: "thumbnails",
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [item: LibrarySearchItem];
}>();

const { t } = useLiturgyI18n();
const query = ref("");
const viewMode = ref<"thumbnails" | "list">(props.defaultView);
const categoryFilter = ref<string | null>(null);
const inputEl = ref<{ focus: () => void } | null>(null);
const viewport = ref<HTMLElement | null>(null);

const categoryById = computed(
  () => new Map(props.categories.map((category) => [category.id, category]))
);

function itemColor(item: LibrarySearchItem): string {
  return item.color || categoryById.value.get(item.categoryId || "")?.color || "transparent";
}

const itemsWithCategory = computed(() =>
  props.items.map((item) => ({
    ...item,
    categoryId: item.categoryId || "",
  }))
);

const knownCategoryIds = computed(() => new Set(props.categories.map((category) => category.id)));

const filteredItems = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return itemsWithCategory.value.filter((item) => {
    if (categoryFilter.value !== null) {
      const uncategorized = !item.categoryId || !knownCategoryIds.value.has(item.categoryId);
      const matches = categoryFilter.value
        ? item.categoryId === categoryFilter.value
        : uncategorized;
      if (!matches) return false;
    }
    return !q || item.name.toLocaleLowerCase().includes(q);
  });
});

const visibleCategories = computed(() => {
  const used = new Set(itemsWithCategory.value.map((item) => item.categoryId).filter(Boolean));
  const categories = props.categories
    .filter((category) => used.has(category.id))
    .map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      iconType: category.iconType,
      color: category.color,
    }));
  const hasUncategorized = itemsWithCategory.value.some(
    (item) => !item.categoryId || !knownCategoryIds.value.has(item.categoryId)
  );
  if (hasUncategorized || itemsWithCategory.value.length > 0) {
    categories.push({
      id: "",
      name: t("library_search.uncategorized"),
      icon: ICONS.UI.FILE_MULTIPLE,
      iconType: "icon",
      color: "var(--lj-text-subtle)",
    });
  }
  return categories;
});

const groups = computed<Group[]>(() => {
  if (categoryFilter.value !== null) {
    const category = categoryById.value.get(categoryFilter.value);
    return [
      {
        id: categoryFilter.value || "uncategorized",
        name: category?.name || t("library_search.uncategorized"),
        items: filteredItems.value,
      },
    ];
  }

  const result: Group[] = [];
  for (const category of props.categories) {
    const items = filteredItems.value.filter((item) => item.categoryId === category.id);
    if (items.length) result.push({ id: category.id, name: category.name, items });
  }
  const withoutCategory = filteredItems.value.filter(
    (item) => !item.categoryId || !knownCategoryIds.value.has(item.categoryId)
  );
  if (withoutCategory.length) {
    result.push({
      id: "uncategorized",
      name: t("library_search.uncategorized"),
      items: withoutCategory,
    });
  }
  if (!result.length) result.push({ id: "all", name: "", items: filteredItems.value });
  return result;
});

const flatItems = computed(() => groups.value.flatMap((group) => group.items));
const startIndex = () => {
  const index = flatItems.value.findIndex((item) => item.id === props.selectedId);
  return index >= 0 ? index : 0;
};
const nav = useListNavigation<LibrarySearchItem>({
  items: () => flatItems.value,
  container: viewport,
  activeSelector: '[data-library-active="true"]',
  start: startIndex,
});
const activeId = computed(() => nav.active.value?.id || "");

watch(flatItems, () => nav.reset());

function selectCategory(categoryId: string | null): void {
  categoryFilter.value = categoryId;
}

function pick(item: LibrarySearchItem): void {
  emit("pick", item);
  emit("update:modelValue", false);
}

function selectActive(): void {
  const item = nav.active.value;
  if (item) pick(item);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    selectActive();
    return;
  }
  const grid = viewMode.value === "thumbnails";
  const delta =
    event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : grid && event.key === "ArrowRight"
          ? 1
          : grid && event.key === "ArrowLeft"
            ? -1
            : 0;
  if (!delta) return;
  event.preventDefault();
  nav.move(delta);
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    query.value = "";
    categoryFilter.value = null;
    viewMode.value = props.defaultView;
    nav.reset();
    nextTick(() => inputEl.value?.focus());
  },
  { immediate: true }
);
</script>

<style scoped>
.llb-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}
.llb-search {
  flex: 1;
  min-width: 0;
}
.llb-view-toggle {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
}
.llb-view {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  background: transparent;
  color: var(--lj-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.llb-view:hover,
.llb-view--active {
  border-color: var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
}
.llb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
  margin: var(--lj-space-3) 0;
}
.llb-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 4px 9px;
  border: 1px solid var(--lj-surface-border);
  border-radius: 999px;
  background: transparent;
  color: var(--lj-text-muted);
  font: inherit;
  font-size: var(--lj-text-sm);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.llb-chip:hover,
.llb-chip--active {
  border-color: var(--lj-navy);
  background: color-mix(in srgb, var(--lj-navy) 10%, transparent);
  color: var(--lj-text);
}
.llb-chip-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
}
.llb-body {
  max-height: 54vh;
  overflow-y: auto;
  padding-right: 2px;
}
.llb-empty {
  padding: var(--lj-space-5);
  text-align: center;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}
.llb-group {
  margin-top: var(--lj-space-4);
}
.llb-group:first-child {
  margin-top: 0;
}
.llb-group-title {
  margin: 0 0 var(--lj-space-2);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
}
.llb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: var(--lj-space-3);
}
.llb-thumb {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-sm);
  background: color-mix(in srgb, var(--llb-item-color, transparent) 10%, transparent);
  color: var(--lj-text);
  text-align: left;
  cursor: pointer;
}
.llb-thumb:hover,
.llb-thumb--active {
  border-color: var(--lj-surface-border);
  background: color-mix(
    in srgb,
    var(--llb-item-color, var(--lj-navy)) 18%,
    var(--lj-surface-bg-soft)
  );
}
.llb-thumb--selected {
  border-color: var(--lj-navy);
}
.llb-thumb-media {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--lj-radius-xs);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
}
.llb-thumb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.llb-thumb-detail {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 4px;
  border-radius: var(--lj-radius-xs);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
}
.llb-thumb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-xs);
}
.llb-thumb-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lj-text-muted);
  font-size: 10px;
}
.llb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.llb-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-3);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-sm);
  background: color-mix(in srgb, var(--llb-item-color, transparent) 10%, transparent);
  color: var(--lj-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.llb-row:hover,
.llb-row--active {
  border-color: var(--lj-surface-border);
  background: color-mix(
    in srgb,
    var(--llb-item-color, var(--lj-navy)) 18%,
    var(--lj-surface-bg-soft)
  );
}
.llb-row--selected {
  border-color: var(--lj-navy);
}
.llb-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 26px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
}
.llb-row-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.llb-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.llb-row-type {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}
.llb-count {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}
.llb-hint {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
  margin-right: var(--lj-space-3);
}
@media (max-width: 640px) {
  .llb-hint {
    display: none;
  }
}
</style>
