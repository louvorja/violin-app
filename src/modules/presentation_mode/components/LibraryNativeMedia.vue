<template>
  <div v-if="!native.supported" class="pm-native__unsupported">
    <LjEmpty :icon="ICONS.MODULES.MEDIA_LIBRARY" :title="tm('native.desktop_only')" />
  </div>

  <div v-else class="pm-native" data-testid="pm-library-native">
    <nav class="pm-folders" :aria-label="tm('native.categories')">
      <button
        type="button"
        class="pm-folder"
        :class="{ 'pm-folder--active': native.filter.value === ALL }"
        data-testid="pm-native-all"
        @click="native.filter.value = ALL"
      >
        <LjIcon :icon="ICONS.MODULES.MEDIA_LIBRARY" :size="15" />
        <span class="pm-folder__label">{{ tm("library.all") }}</span>
        <span class="pm-folder__count">{{ native.countOf(ALL) }}</span>
      </button>
      <button
        v-for="category in native.categories.value"
        :key="category.id"
        type="button"
        class="pm-folder"
        :class="{ 'pm-folder--active': native.filter.value === category.id }"
        :title="category.name"
        :data-testid="`pm-native-category-${category.id}`"
        @click="native.filter.value = category.id"
      >
        <!-- A cor que a categoria tem na Biblioteca de Mídia. -->
        <span class="pm-native__swatch" :style="{ color: category.color || undefined }">
          <LjIcon :icon="ICONS.UI.FOLDER" :size="15" />
        </span>
        <span class="pm-folder__label">{{ category.name }}</span>
        <span class="pm-folder__count">{{ native.countOf(category.id) }}</span>
      </button>
      <button
        v-if="native.hasUncategorized.value"
        type="button"
        class="pm-folder"
        :class="{ 'pm-folder--active': native.filter.value === '' }"
        data-testid="pm-native-uncategorized"
        @click="native.filter.value = ''"
      >
        <LjIcon :icon="ICONS.UI.FOLDER_OPEN" :size="15" />
        <span class="pm-folder__label">{{ tm("native.uncategorized") }}</span>
        <span class="pm-folder__count">{{ native.countOf("") }}</span>
      </button>
    </nav>

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
      <FileGrid
        v-else
        data-testid="pm-native-grid"
        :entries="native.entries.value"
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
import { computed, onActivated, onMounted, ref } from "vue";
import FileGrid from "./FileGrid.vue";
import { LjButton, LjEmpty, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Modules from "@/helpers/Modules";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import { ALL, useNativeMediaLibrary } from "../composables/useNativeMediaLibrary";
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

const filePlayable = (entry: LibraryEntry): Playable => ({ type: "file", entry });

function onSelect(entry: LibraryEntry): void {
  selectedPath.value = entry.path;
  emit("preview", filePlayable(entry));
}

const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.library.items_count`, native.entries.value.length)
);

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

/* A barra de categorias é a mesma lista de pastas da aba Arquivos. */
.pm-folders {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-folder {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  flex-shrink: 0;
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

.pm-folder:hover {
  background: var(--lj-hover-bg);
}

.pm-folder :deep(svg) {
  flex-shrink: 0;
  color: var(--lj-orange);
}

/* A cor da categoria vence o laranja das pastas. */
.pm-native__swatch {
  display: inline-flex;
  color: var(--lj-orange);
}

.pm-native__swatch :deep(svg) {
  color: inherit;
}

.pm-folder--active {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-folder__label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-folder__count {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
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
