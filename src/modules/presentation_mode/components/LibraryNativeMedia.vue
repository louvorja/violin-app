<template>
  <div v-if="!native.supported" class="pm-native__unsupported">
    <LjEmpty :icon="ICONS.MODULES.MEDIA_LIBRARY" :title="tm('native.desktop_only')" />
  </div>

  <div v-else class="pm-native" data-testid="pm-library-native">
    <aside class="pm-native__side">
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
          :name="tm('native.uncategorized')"
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
        no-details
        no-file-actions
        @select="onSelect"
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
          :title="tm('native.refresh')"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from "vue";
import FileGrid from "./FileGrid.vue";
import CategoryListItem from "./CategoryListItem.vue";
import { LjButton, LjEmpty, LjIcon, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Modules from "@/helpers/Modules";
import Strings from "@/helpers/Strings";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import {
  ALL,
  useNativeMediaLibrary,
  type NativeMediaCategory,
} from "../composables/useNativeMediaLibrary";
import type { Playable, PlayOptions } from "../program/playable";

/**
 * A aba da Biblioteca de Mídia: o acervo que o operador já organizou no módulo
 * nativo, por categoria, sem precisar sair do Modo apresentação. Projeta,
 * manda ao retorno e ao programa como a aba Arquivos; organizar fica lá
 * ("Gerenciar" abre o módulo).
 */

defineProps<{ livePath: string | null; returnPath: string | null }>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  stop: [];
  "show-on-return": [entry: LibraryEntry | null];
}>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const native = useNativeMediaLibrary();
const selectedPath = ref<string | null>(null);
const search = ref("");

const visibleEntries = computed(() => {
  const query = Strings.fold(search.value.trim());
  if (!query) return native.entries.value;
  return native.entries.value.filter((entry) => Strings.fold(entry.name).includes(query));
});

const filePlayable = (entry: LibraryEntry): Playable => ({ type: "file", entry });

function onSelect(entry: LibraryEntry): void {
  selectedPath.value = entry.path;
  emit("preview", filePlayable(entry));
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
onBeforeUnmount(() => native.disposeCategoryIcons());
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
