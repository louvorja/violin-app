<template>
  <div v-if="!native.supported" class="pm-native__unsupported">
    <LjEmpty :icon="ICONS.MODULES.MEDIA_LIBRARY" :title="tm('native.desktop_only')" />
  </div>

  <div
    v-else
    class="pm-native"
    :class="{ 'pm-native--embedded': embedded, 'pm-native--details': !!details }"
    data-testid="pm-library-native"
  >
    <aside v-if="!embedded" class="pm-native__side">
      <div class="pm-native__search">
        <LjInput
          v-model="search"
          size="sm"
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="t('components.ui.search_placeholder')"
          clearable
          data-testid="pm-native-search"
        />
      </div>
      <nav class="pm-folders" :aria-label="tm('native.categories')">
        <CategoryListItem
          category-id="*"
          :name="tm('library.all')"
          :icon="ICONS.MODULES.MEDIA_LIBRARY"
          icon-type="icon"
          color="var(--lj-orange)"
          :count="native.countOf(ALL)"
          :active="native.filter.value === ALL"
          data-testid="pm-native-all"
          @select="native.filter.value = ALL"
        />
        <CategoryListItem
          v-for="category in native.categories.value"
          :key="category.id"
          :category-id="category.id"
          :name="category.name"
          :icon="categoryIcon(category)"
          :icon-type="categoryIconType(category)"
          :color="category.color || 'var(--lj-orange)'"
          :count="native.countOf(category.id)"
          :active="native.filter.value === category.id"
          :data-testid="`pm-native-category-${category.id}`"
          @select="native.filter.value = category.id"
        />
        <CategoryListItem
          v-if="native.hasUncategorized.value"
          category-id=""
          :name="t('shell.category.uncategorized')"
          :icon="ICONS.UI.FOLDER_OPEN"
          icon-type="icon"
          color="var(--lj-orange)"
          :count="native.countOf('')"
          :active="native.filter.value === ''"
          data-testid="pm-native-uncategorized"
          @select="native.filter.value = ''"
        />
      </nav>
    </aside>

    <div class="pm-files">
      <div class="pm-native__toolbar">
        <LjInput
          v-if="embedded"
          v-model="search"
          size="sm"
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="tm('native.search')"
          clearable
          data-testid="pm-native-search"
        />
        <LjTabs
          :model-value="typeFilter"
          :tabs="typeTabs"
          :aria-label="tm('library.media_type_filter')"
          @update:model-value="typeFilter = $event as MediaTypeFilter"
        />
      </div>
      <p v-if="native.loading.value && !native.loaded.value" class="pm-files__empty">
        {{ tm("library.loading") }}
      </p>
      <div v-else-if="!native.entries.value.length" class="pm-files__empty">
        <p>{{ native.records.value.length ? tm("native.empty_category") : tm("native.empty") }}</p>
        <LjButton size="sm" :icon="ICONS.MODULES.MEDIA_LIBRARY" @click="openNativeLibrary">
          {{ tm("native.open") }}
        </LjButton>
      </div>
      <div v-else-if="!visibleEntries.length" class="pm-files__empty">
        <p>{{ tm("native.no_results") }}</p>
      </div>
      <FileGrid
        v-else
        data-testid="pm-native-grid"
        :entries="visibleEntries"
        :selected-path="selectedPath"
        :live-path="livePath"
        :return-path="returnPath"
        no-file-actions
        :extra-menu="nativeMenu"
        @select="onSelect"
        @details="openDetails"
        @open="(e: LibraryEntry) => emit('play', filePlayable(e))"
        @play="(e: LibraryEntry, o?: PlayOptions) => emit('play', filePlayable(e), o)"
        @stop="emit('stop')"
        @add="(item: ProgramItem) => emit('add', item)"
        @show-on-return="(e: LibraryEntry | null) => emit('show-on-return', e)"
      />
      <footer class="pm-files__foot">
        <LjIcon :icon="ICONS.MODULES.MEDIA_LIBRARY" :size="12" />
        <span class="pm-files__count">{{ countLabel }}</span>
        <!-- Guardados como bytes (HEIC arrastado): não há arquivo para o módulo abrir. -->
        <span
          v-if="native.unavailable.value"
          class="pm-native__unavailable"
          :title="tm('native.unavailable_hint')"
          data-testid="pm-native-unavailable"
        >
          {{
            t(
              `modules.${ModuleEnum.PRESENTATION_MODE}.native.unavailable`,
              native.unavailable.value
            )
          }}
        </span>
        <span class="pm-native__spacer" />
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.REFRESH"
          :title="t('actions.refresh')"
          :disabled="native.loading.value"
          data-testid="pm-native-refresh"
          @click="native.load()"
        />
        <LjButton
          size="sm"
          variant="ghost"
          :icon="ICONS.UI.OPEN_IN_NEW"
          data-testid="pm-native-open"
          @click="openNativeLibrary"
        >
          {{ tm("native.manage") }}
        </LjButton>
      </footer>
    </div>

    <aside v-if="details" class="pm-native__details pm-details" data-testid="pm-native-details">
      <div class="pm-details__head">
        <span class="pm-details__title">{{ details.name }}</span>
        <button
          type="button"
          class="pm-details__star pm-details__close"
          :title="t('actions.close')"
          :aria-label="t('actions.close')"
          data-testid="pm-native-details-close"
          @click="closeDetails"
        >
          <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="15" />
        </button>
      </div>
      <dl class="pm-details__table">
        <dt>{{ tm("library.extension") }}</dt>
        <dd>{{ details.ext.toUpperCase() || "—" }}</dd>
        <template v-if="details.size > 0">
          <dt>{{ tm("library.size") }}</dt>
          <dd>{{ formatSize(details.size) }}</dd>
        </template>
        <template v-if="detailsMeta?.width">
          <dt>{{ tm("library.resolution") }}</dt>
          <dd>{{ detailsMeta.width }}×{{ detailsMeta.height }}</dd>
        </template>
        <template v-if="detailsMeta?.duration">
          <dt>{{ tm("library.duration") }}</dt>
          <dd>{{ DateTime.shortTime(detailsMeta.duration) }}</dd>
        </template>
        <dt>{{ tm("library.modified") }}</dt>
        <dd>{{ formatDate(details.mtimeMs) }}</dd>
        <dt>{{ tm("library.path") }}</dt>
        <dd class="pm-details__path" :title="details.path">{{ details.path }}</dd>
      </dl>
      <div class="pm-details__actions">
        <LjButton
          variant="primary"
          block
          :icon="ICONS.PROJECTION.START"
          data-testid="pm-native-details-send"
          @click="playDetails"
        >
          {{ tm("library.send") }}
        </LjButton>
        <LjButton
          block
          :icon="ICONS.ACTIONS.ADD"
          data-testid="pm-native-details-add"
          @click="addDetails"
        >
          {{ tm("library.add_to_program") }}
        </LjButton>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from "vue";
import FileGrid from "./FileGrid.vue";
import CategoryListItem from "./CategoryListItem.vue";
import {
  LjButton,
  LjEmpty,
  LjIcon,
  LjInput,
  LjTabs,
  type LjMenuItem,
  type LjTab,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import DateTime from "@/helpers/DateTime";
import Modules from "@/helpers/Modules";
import Platform from "@/helpers/Platform";
import Strings from "@/helpers/Strings";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { fileKind, useFileLibrary, type LibraryEntry } from "../composables/useFileLibrary";
import { useMediaMeta } from "../composables/useMediaMeta";
import {
  ALL,
  useNativeMediaLibrary,
  type NativeMediaCategory,
} from "../composables/useNativeMediaLibrary";
import { fileItem } from "../program/items";
import type { Playable, PlayOptions } from "../program/playable";

/**
 * A aba da Biblioteca de Mídia: o acervo que o operador já organizou no módulo
 * nativo, por categoria, sem precisar sair do Modo apresentação. Projeta,
 * manda ao retorno e ao programa como a aba Arquivos; organizar fica lá
 * ("Gerenciar" abre o módulo).
 */

const props = defineProps<{
  livePath: string | null;
  returnPath: string | null;
  /** Renderiza só a grade (o Modo apresentação já tem as categorias na lateral). */
  embedded?: boolean;
}>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  stop: [];
  "show-on-return": [entry: LibraryEntry | null];
}>();

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const native = useNativeMediaLibrary();
const lib = useFileLibrary();
const { meta, request } = useMediaMeta();
const selectedPath = ref<string | null>(null);
const search = ref("");
const details = ref<LibraryEntry | null>(null);
type MediaTypeFilter = "all" | "video" | "image" | "audio" | "document";
const typeFilter = ref<MediaTypeFilter>("all");

const typeTabs = computed<LjTab[]>(() => [
  { value: "all", label: tm("library.all") },
  { value: "video", label: tm("library.videos") },
  { value: "image", label: tm("library.images") },
  { value: "audio", label: tm("library.audio") },
  { value: "document", label: tm("library.documents") },
]);

function matchesType(entry: LibraryEntry, filter: Exclude<MediaTypeFilter, "all">): boolean {
  const kind = fileKind(entry.ext);
  if (filter === "document") return kind === "pdf" || kind === "powerpoint" || kind === "slja";
  return kind === filter;
}

const visibleEntries = computed(() => {
  let list = native.entries.value;
  const filter = typeFilter.value;
  if (filter !== "all") {
    list = list.filter((entry) => matchesType(entry, filter));
  }
  const query = Strings.fold(search.value.trim());
  if (query) list = list.filter((entry) => Strings.fold(entry.name).includes(query));
  return list;
});

const filePlayable = (entry: LibraryEntry): Playable => ({ type: "file", entry });

function onSelect(entry: LibraryEntry): void {
  selectedPath.value = entry.path;
  emit("preview", filePlayable(entry));
}

const detailsMeta = computed(() => (details.value ? (meta.get(details.value.path) ?? null) : null));

function openDetails(entry: LibraryEntry): void {
  selectedPath.value = entry.path;
  details.value = entry;
  request(entry, { priority: true });
}

function closeDetails(): void {
  details.value = null;
}

function playDetails(): void {
  if (details.value) emit("play", filePlayable(details.value));
}

function addDetails(): void {
  if (details.value) emit("add", fileItem(details.value, meta.get(details.value.path) ?? null));
}

function nativeMenu(entry: LibraryEntry): LjMenuItem[] {
  return [
    { separator: true },
    {
      label: tm(`file_actions.reveal_${Platform.platform === "darwin" ? "mac" : "other"}`),
      icon: ICONS.UI.FOLDER_OPEN,
      action: () => lib.reveal(entry),
    },
    { label: tm("native.manage"), icon: ICONS.UI.OPEN_IN_NEW, action: openNativeLibrary },
  ];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(locale.value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.library.items_count`, visibleEntries.value.length)
);

/** Ícone próprio da categoria; pasta só quando ela não tem ícone nenhum. */
function categoryIcon(category: NativeMediaCategory): string {
  const image = native.categoryImageOf(category);
  if (image) return image;
  return category.iconType === "image" ? ICONS.MEDIA.IMAGE : category.icon || ICONS.UI.FOLDER;
}

function categoryIconType(category: NativeMediaCategory): "icon" | "image" {
  return native.categoryImageOf(category) ? "image" : "icon";
}

function openNativeLibrary(): void {
  Modules.open(ModuleEnum.MEDIA_LIBRARY);
}

// O acervo muda na Biblioteca de Mídia; a aba relê ao aparecer de novo.
onMounted(() => {
  if (native.supported) void native.load();
});
onActivated(() => {
  if (native.supported && native.loaded.value) void native.load();
});
onBeforeUnmount(() => {
  // A lateral da aba Mídia continua montada quando só a grade sai; apagar as
  // URLs dos ícones ali deixaria as categorias sem imagem.
  if (!props.embedded) native.disposeCategoryIcons();
});
</script>

<style scoped>
.pm-native__unsupported {
  padding: var(--lj-space-4);
}

.pm-native {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-native--embedded {
  grid-template-columns: minmax(0, 1fr);
}

.pm-native--details {
  grid-template-columns: 168px minmax(0, 1fr) 222px;
}

.pm-native--embedded.pm-native--details {
  grid-template-columns: minmax(0, 1fr) 222px;
}

.pm-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  border-left: 1px solid var(--lj-surface-border);
}

.pm-details__head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.pm-details__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--lj-orange);
  overflow-wrap: anywhere;
}

.pm-details__star {
  display: flex;
  padding: 2px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-orange);
  cursor: pointer;
}

.pm-details__star:hover {
  background: var(--lj-hover-bg);
}

.pm-details__table {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 8px;
  margin: 0;
  font-size: 11px;
}

.pm-details__table dt {
  color: var(--lj-text-subtle);
}

.pm-details__table dd {
  margin: 0;
  font-family: var(--lj-font-mono);
  text-align: right;
}

.pm-details__path {
  text-align: left;
  overflow-wrap: anywhere;
}

.pm-details__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}

.pm-native__toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3) 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-native__toolbar :deep(.lj-input) {
  width: 160px;
  min-width: 0;
}

/* A barra de categorias usa a mesma linha de filtro das abas de fundo. */
.pm-native__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-native__search {
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3) 0;
}

.pm-native__search :deep(.lj-input) {
  width: 100%;
  min-width: 0;
}

.pm-folders {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-2) 0;
  scrollbar-width: none;
}

.pm-files {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-files__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

.pm-files__empty p {
  margin: 0;
}

.pm-files__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  flex-shrink: 0;
  border-top: 1px solid var(--lj-surface-border);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-files__count {
  flex-shrink: 0;
}

.pm-native__unavailable {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--lj-warning);
}

.pm-native__spacer {
  flex: 1;
}
</style>
