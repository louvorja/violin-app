<template>
  <div class="pm-folder-stage" data-testid="pm-folder-stage">
    <SeriesBar
      v-if="doc"
      :dir="item.folder ?? ''"
      :doc="doc"
      :progress="progress"
      @preview="(file: string) => selectByName(file)"
      @play="(file: string) => playByName(file)"
    />
    <p v-if="!files" class="pm-folder-stage__empty">{{ tm("library.loading") }}</p>
    <p v-else-if="!files.length" class="pm-folder-stage__empty">{{ tm("folder.empty") }}</p>
    <FileGrid
      v-else
      class="pm-folder-stage__grid"
      :entries="files"
      :selected-path="selectedPath"
      :live-path="livePath"
      :return-path="returnPath"
      :played-at="playedOn"
      :next-name="progress?.next ?? null"
      :extra-menu="menuFor"
      no-details
      @select="(e: LibraryEntry) => (selectedPath = e.path)"
      @open="play"
      @play="(e: LibraryEntry, o?: PlayOptions) => play(e, o)"
      @stop="emit('stop')"
      @add="(added: ProgramItem) => emit('add', added)"
      @show-on-return="(e: LibraryEntry | null) => emit('show-on-return', e)"
    />
    <footer class="pm-folder-stage__bar">
      <LjIcon :icon="ICONS.UI.FOLDER" :size="12" />
      <span class="pm-folder-stage__path" :title="item.folder">
        <bdi dir="ltr">{{ item.folder }}</bdi>
      </span>
      <LjButton
        size="sm"
        variant="ghost"
        :icon="ICONS.UI.FOLDER_OPEN"
        data-testid="pm-folder-open-library"
        @click="emit('open-library')"
      >
        {{ tm("folder.open_library") }}
      </LjButton>
      <span class="pm-folder-stage__hint">{{ tm("folder.hint") }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import type { PlayOptions } from "../program/playable";
import { useFolderItems } from "../composables/useFolderItems";
import { useFolderSeries } from "../composables/useSeries";
import FileGrid from "./FileGrid.vue";
import SeriesBar from "./SeriesBar.vue";

/**
 * Pasta do programa no palco: os arquivos dela com os mesmos cartões e o
 * mesmo menu da biblioteca, e a barra da série quando a pasta é série. Um
 * clique escolhe; duplo clique ou ▶ manda ao ar — com dezenas de arquivos,
 * o clique simples não pode mandar nada por engano.
 */

const props = defineProps<{
  item: ProgramItem;
  livePath: string | null;
  returnPath: string | null;
}>();

const emit = defineEmits<{
  play: [entry: LibraryEntry, options?: PlayOptions];
  stop: [];
  add: [item: ProgramItem];
  "show-on-return": [entry: LibraryEntry | null];
  "open-library": [];
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const folders = useFolderItems();

const files = computed(() => (props.item.folder ? folders.filesOf(props.item.folder) : []));
const selectedPath = ref<string | null>(null);

const { doc, progress, playedOn, menuFor } = useFolderSeries(
  {
    location: computed(() => props.item.folder ?? null),
    entries: computed(() => files.value ?? []),
  },
  { locale, tm }
);

const byName = (name: string) => files.value?.find((e) => e.name === name) ?? null;

function selectByName(name: string): void {
  selectedPath.value = byName(name)?.path ?? null;
}

function playByName(name: string): void {
  const entry = byName(name);
  if (entry) play(entry);
}

function play(entry: LibraryEntry, options?: PlayOptions): void {
  if (!entry.isDir) emit("play", entry, options);
}
</script>

<style scoped>
.pm-folder-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* A grade vem da biblioteca (fundo claro); no palco o fundo é escuro. */
.pm-folder-stage__grid :deep(.pm-file__name) {
  color: var(--lj-white);
}

.pm-folder-stage__bar :deep(.lj-btn) {
  color: var(--lj-white);
}

.pm-folder-stage__empty {
  margin: auto;
  color: var(--lj-white-alpha-50);
}

.pm-folder-stage__bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-4);
  border-top: 1px solid var(--lj-white-alpha-10);
  color: var(--lj-white-alpha-50);
  font-size: 11px;
}

.pm-folder-stage__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}

.pm-folder-stage__hint {
  margin-left: auto;
  white-space: nowrap;
}
</style>
