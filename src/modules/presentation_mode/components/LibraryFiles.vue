<template>
  <div v-if="!lib.supported" class="pm-library__unsupported">
    <LjEmpty :icon="ICONS.UI.FOLDER_OPEN" :title="tm('library.desktop_only')" />
  </div>

  <div v-else class="pm-library__body" :class="{ 'pm-library__body--details': !!details }">
    <nav class="pm-folders" :aria-label="tm('library.folders')">
      <button
        type="button"
        class="pm-folder"
        :class="{ 'pm-folder--active': lib.source.value === ALL }"
        @click="lib.openSource(ALL)"
      >
        <LjIcon :icon="ICONS.UI.FOLDER_MULTIPLE" :size="15" />
        <span class="pm-folder__label">{{ tm("library.all") }}</span>
        <span class="pm-folder__count">{{ lib.counts.value[ALL] ?? "" }}</span>
      </button>
      <button
        type="button"
        class="pm-folder"
        :class="{ 'pm-folder--active': lib.source.value === FAVORITES }"
        @click="lib.openSource(FAVORITES)"
      >
        <LjIcon :icon="ICONS.UI.FOLDER_HEART" :size="15" />
        <span class="pm-folder__label">{{ tm("library.favorites") }}</span>
        <span class="pm-folder__count">{{ lib.counts.value[FAVORITES] ?? "" }}</span>
      </button>
      <!-- Todos e Favoritos ficam fixos no topo; as pastas do operador se arrastam. -->
      <draggable
        :model-value="lib.folders.value"
        item-key="path"
        tag="div"
        class="pm-folders__user"
        :animation="150"
        ghost-class="pm-folder--ghost"
        @update:model-value="lib.reorderFolders"
      >
        <template #item="{ element: folder }">
          <LjContextMenu :items="folderMenu(folder)">
            <div
              class="pm-folder pm-folder--user"
              :class="{ 'pm-folder--active': lib.source.value === folder.path }"
              role="button"
              tabindex="0"
              :title="folder.path"
              @click="lib.openSource(folder.path)"
              @keydown.enter.self="lib.openSource(folder.path)"
            >
              <LjIcon :icon="ICONS.UI.FOLDER" :size="15" />
              <span class="pm-folder__label">{{ folder.label }}</span>
              <span class="pm-folder__count">{{ lib.counts.value[folder.path] ?? "" }}</span>
              <button
                type="button"
                class="pm-folder__remove"
                :title="tm('library.remove_folder')"
                :aria-label="tm('library.remove_folder')"
                @click.stop="confirmRemove(folder.path)"
              >
                <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="11" />
              </button>
            </div>
          </LjContextMenu>
        </template>
      </draggable>
      <button
        type="button"
        class="pm-folder pm-folder--add"
        data-testid="pm-library-add-folder"
        @click="lib.addFolder()"
      >
        <LjIcon :icon="ICONS.UI.FOLDER_PLUS" :size="15" />
        <span class="pm-folder__label">{{ tm("library.add_folder") }}</span>
      </button>
    </nav>

    <div class="pm-files">
      <SeriesBar
        v-if="seriesDir"
        :dir="seriesDir"
        :doc="seriesDoc"
        :progress="seriesProgress"
        @preview="(file: string) => byName(file) && onClick(byName(file)!)"
        @play="(file: string) => byName(file) && emit('play', filePlayable(byName(file)!))"
      />
      <div v-if="emptyMessage" class="pm-files__empty">
        <p>{{ emptyMessage }}</p>
        <LjButton
          v-if="!lib.folders.value.length"
          size="sm"
          :icon="ICONS.UI.FOLDER_PLUS"
          @click="lib.addFolder()"
        >
          {{ tm("library.add_folder") }}
        </LjButton>
      </div>
      <FileGrid
        v-else
        data-testid="pm-library-grid"
        :entries="lib.entries.value"
        :selected-path="selected?.path ?? null"
        :live-path="livePath"
        :return-path="returnPath"
        :played-at="playedOn"
        :next-name="seriesProgress?.next ?? null"
        :extra-menu="seriesMenuFor"
        @select="onClick"
        @open="onOpen"
        @play="(e: LibraryEntry, o?: PlayOptions) => emit('play', filePlayable(e), o)"
        @stop="emit('stop')"
        @details="openDetails"
        @add="(item: ProgramItem) => emit('add', item)"
        @show-on-return="(e: LibraryEntry | null) => emit('show-on-return', e)"
      />
      <footer class="pm-files__foot">
        <LjButton
          v-if="lib.canGoUp.value"
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.ARROW_LEFT"
          :title="tm('library.up')"
          @click="lib.goUp()"
        />
        <LjIcon v-else :icon="ICONS.UI.FOLDER" :size="12" />
        <!-- rtl corta o começo do caminho; o bdi mantém a ordem dos caracteres. -->
        <span class="pm-files__path" :title="locationLabel">
          <bdi dir="ltr">{{ locationLabel }}</bdi>
        </span>
        <span class="pm-files__count">{{ countLabel }}</span>
        <LjButton
          v-if="cloudFiles.length"
          size="sm"
          variant="ghost"
          :icon="ICONS.ACTIONS.CLOUD_DOWNLOAD"
          data-testid="pm-cloud-download-all"
          :title="tm('cloud.download_all_title')"
          @click="downloadPaths(cloudFiles, locationLabel)"
        >
          {{ tm("cloud.download_all", { n: cloudFiles.length }) }}
        </LjButton>
        <LjButton
          v-if="seriesDir && !seriesDoc"
          size="sm"
          variant="ghost"
          :icon="ICONS.MEDIA.PLAYLIST"
          class="pm-files__make-series"
          data-testid="pm-series-make"
          @click="series.openDialog(seriesDir)"
        >
          {{ tm("series.make") }}
        </LjButton>
        <span class="pm-files__hint">{{ tm("library.hint") }}</span>
      </footer>
    </div>

    <!-- Detalhes só a pedido — (i) ou menu de contexto. Abrir no clique
         deslocava a grade no meio do duplo clique. -->
    <aside v-if="details" class="pm-details" data-testid="pm-library-details">
      <div class="pm-details__head">
        <span class="pm-details__title">{{ details.name }}</span>
        <button
          type="button"
          class="pm-details__star"
          :aria-pressed="lib.isFavorite(details)"
          :title="lib.isFavorite(details) ? tm('library.unfavorite') : tm('library.favorite')"
          @click="lib.toggleFavorite(details)"
        >
          <LjIcon
            :icon="lib.isFavorite(details) ? ICONS.UI.STAR : ICONS.UI.STAR_OUTLINE"
            :size="15"
          />
        </button>
        <button
          type="button"
          class="pm-details__star pm-details__close"
          :title="t('actions.close')"
          :aria-label="t('actions.close')"
          data-testid="pm-library-details-close"
          @click="detailsPath = null"
        >
          <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="15" />
        </button>
      </div>
      <dl class="pm-details__table">
        <dt>{{ tm("library.extension") }}</dt>
        <dd>{{ details.ext.toUpperCase() }}</dd>
        <dt>{{ tm("library.size") }}</dt>
        <dd>{{ formatSize(details.size) }}</dd>
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
      </dl>
      <div class="pm-details__actions">
        <LjButton
          variant="primary"
          block
          :icon="ICONS.PROJECTION.START"
          data-testid="pm-library-send"
          @click="emit('play', filePlayable(details))"
        >
          {{ tm("library.send") }}
        </LjButton>
        <LjButton
          block
          :icon="ICONS.ACTIONS.ADD"
          data-testid="pm-library-add"
          @click="emit('add', fileItem(details, detailsMeta))"
        >
          {{ tm("library.add_to_program") }}
        </LjButton>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import FileGrid from "./FileGrid.vue";
import SeriesBar from "./SeriesBar.vue";
import { useFolderSeries } from "../composables/useSeries";
import draggable from "vuedraggable";
import { LjButton, LjContextMenu, LjEmpty, LjIcon, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import DateTime from "@/helpers/DateTime";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  ALL,
  FAVORITES,
  readFolder,
  useFileLibrary,
  type LibraryEntry,
} from "../composables/useFileLibrary";
import { useMediaMeta } from "../composables/useMediaMeta";
import { useCloudFiles } from "../composables/useCloudFiles";
import type { ProgramItem } from "@/types/Presentation";
import { fileItem, folderItem } from "../program/items";
import type { Playable, PlayOptions } from "../program/playable";

/**
 * Aba Arquivos da biblioteca: as pastas do computador que o operador
 * adicionou, com miniaturas e detalhes. Um clique leva o arquivo para a
 * prévia do palco; ▶ ou duplo clique projeta.
 */

defineProps<{
  /** Caminho do arquivo que está no ar, para a borda de destaque e o ✕. */
  livePath: string | null;
  returnPath: string | null;
}>();

const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  stop: [];
  /** Imagem ou vídeo só no retorno de palco; `null` tira. */
  "show-on-return": [entry: LibraryEntry | null];
}>();

const filePlayable = (entry: LibraryEntry): Playable => ({ type: "file", entry });

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const lib = useFileLibrary();
const { meta, request } = useMediaMeta();
const cloud = useCloudFiles();

const selected = computed(() => lib.selected.value);

const detailsPath = ref<string | null>(null);
const details = computed(() => lib.entries.value.find((e) => e.path === detailsPath.value) ?? null);
const detailsMeta = computed(() => (details.value ? (meta.get(details.value.path) ?? null) : null));

function openDetails(entry: LibraryEntry): void {
  detailsPath.value = entry.path;
  request(entry, { priority: true });
}

function onClick(entry: LibraryEntry): void {
  lib.select(entry);
  if (!entry.isDir) emit("preview", filePlayable(entry));
}

onMounted(() => {
  if (lib.supported) void lib.load();
});

/* ─── Nuvem ─── */

const cloudFiles = computed(() =>
  lib.entries.value.filter((e) => !e.isDir && cloud.stateOf(e.path) === "cloud").map((e) => e.path)
);

function downloadPaths(paths: string[], where: string): void {
  void cloud.downloadAll(paths, tm("cloud.task", { where }));
}

watch(details, (entry) => {
  if (entry) request(entry, { priority: true });
});

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

function onOpen(entry: LibraryEntry): void {
  if (entry.isDir) void lib.enter(entry);
  else emit("play", filePlayable(entry));
}

/** Menu da pasta na barra lateral: abrir, levar ao programa, baixar da nuvem, tirar da lista. */
function folderMenu(folder: { path: string; label: string }): LjMenuItem[] {
  return [
    {
      label: tm("library.open_folder"),
      icon: ICONS.UI.FOLDER_OPEN,
      action: () => void lib.openSource(folder.path),
    },
    {
      label: tm("folder.add_to_program"),
      icon: ICONS.ACTIONS.ADD,
      action: () => emit("add", folderItem(folder.path, folder.label)),
    },
    {
      label: tm("cloud.download_folder"),
      icon: ICONS.ACTIONS.CLOUD_DOWNLOAD,
      action: () => void downloadFolder(folder.path, folder.label),
    },
    { separator: true },
    {
      label: tm("library.remove_folder"),
      icon: ICONS.ACTIONS.CLOSE,
      action: () => confirmRemove(folder.path),
    },
  ];
}

async function downloadFolder(path: string, label: string): Promise<void> {
  const files = await readFolder(path);
  void cloud.downloadAll(
    (files ?? []).filter((e) => !e.isDir).map((e) => e.path),
    tm("cloud.task", { where: label })
  );
}

function confirmRemove(path: string): void {
  $alert.yesno(
    {
      title: `modules.${ModuleEnum.PRESENTATION_MODE}.library.remove_folder`,
      text: `modules.${ModuleEnum.PRESENTATION_MODE}.library.remove_folder_text`,
    },
    (resp?: string) => {
      if (resp === "yes") void lib.removeFolder(path);
    }
  );
}

/* ─── Série: a pasta aberta pode guardar o histórico do que já passou ─── */

const {
  series,
  dir: seriesDir,
  doc: seriesDoc,
  progress: seriesProgress,
  playedOn,
  menuFor: seriesMenuFor,
} = useFolderSeries({ location: lib.location, entries: lib.entries }, { locale, tm });
const byName = (name: string) =>
  lib.entries.value.find(
    (e) => e.name === name && !e.isDir && e.path.startsWith(seriesDir.value ?? "")
  ) ?? null;

const locationLabel = computed(() => {
  if (lib.source.value === ALL) return tm("library.all");
  if (lib.source.value === FAVORITES) return tm("library.favorites");
  return lib.location.value ?? "";
});

const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.library.items_count`, lib.fileCount.value)
);

const emptyMessage = computed(() => {
  if (lib.loading.value && !lib.entries.value.length) return tm("library.loading");
  if (!lib.folders.value.length && lib.source.value !== FAVORITES) return tm("library.no_folders");
  if (lib.missing.value) return tm("library.missing");
  if (!lib.entries.value.length) {
    return lib.source.value === FAVORITES ? tm("library.no_favorites") : tm("library.empty");
  }
  return "";
});
</script>

<style scoped>
.pm-library__unsupported {
  padding: var(--lj-space-4);
}

.pm-library__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-library__body--details {
  grid-template-columns: 168px minmax(0, 1fr) 222px;
}

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

.pm-folder__remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-folder--user:hover .pm-folder__remove,
.pm-folder__remove:focus-visible {
  display: flex;
}

.pm-folder--user:hover .pm-folder__count {
  display: none;
}

.pm-folders__user {
  display: flex;
  flex-direction: column;
}

.pm-folder--user {
  cursor: grab;
}

.pm-folder--ghost {
  opacity: 0.5;
}

.pm-folder--add {
  color: var(--lj-orange);
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
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

.pm-files__empty p {
  margin: 0;
}

.pm-files__make-series {
  flex-shrink: 0;
  color: var(--lj-orange);
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

.pm-files__path {
  min-width: 0;
  font-family: var(--lj-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.pm-files__count {
  flex-shrink: 0;
}

.pm-files__hint {
  margin-left: auto;
  flex-shrink: 0;
  white-space: nowrap;
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

.pm-details--empty {
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--lj-text-subtle);
  text-align: center;
  font-size: 11px;
}

.pm-details--empty p {
  margin: 0;
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

.pm-details__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}
</style>
