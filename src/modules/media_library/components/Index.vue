<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '700px' }"
    @close="stop"
  >
    <div
      class="media-root"
      :class="{ 'media-root--drag-over': isDragOver }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Toolbar -->
      <div class="media-toolbar">
        <LjTabs
          :model-value="libraryFilter"
          :tabs="filterTabs"
          :aria-label="t('library')"
          @update:model-value="libraryFilter = $event as LibraryFilter"
        />
        <span class="lj-u-spacer" />
        <LjButton size="sm" variant="subtle" :icon="ICONS.ACTIONS.ADD" @click="addFiles">
          {{ t("add_files") }}
        </LjButton>
      </div>

      <LjDivider />

      <!-- Split -->
      <div class="media-split">
        <!-- Library -->
        <div class="media-library">
          <div class="media-search">
            <LjInput
              v-model="searchQuery"
              clearable
              :icon="ICONS.ACTIONS.SEARCH"
              :placeholder="t('search')"
              :aria-label="t('search')"
            />
          </div>

          <!-- Chips de categorias (filtro) -->
          <div v-if="categories.length || uncategorizedCount > 0" class="media-chips">
            <span class="media-chips-title">{{ t("categories") }}</span>
            <div
              v-for="cat in categories"
              :key="cat.id"
              class="media-chip"
              :class="{ 'media-chip--active': selectedCategoryIds.has(cat.id) }"
              :style="{ '--chip-color': cat.color }"
              @click="toggleCategoryChip(cat.id)"
            >
              <span class="media-chip-icon-wrap">
                <Icon v-if="cat.iconType === 'icon'" :icon="cat.icon" :size="14" />
                <img v-else :src="cat.icon" class="media-chip-img" alt="" />
              </span>
              <span class="media-chip-name">{{ cat.name }}</span>
              <span class="media-chip-count">
                {{ files.filter((f) => f.categoryId === cat.id).length }}
              </span>
              <button
                type="button"
                class="media-chip-add"
                :title="t('add_files')"
                :aria-label="t('add_files')"
                @click.stop="beginAddWithCategory(cat.id)"
              >
                <Icon :icon="ICONS.ACTIONS.ADD" :size="12" />
              </button>
            </div>
            <div
              v-if="uncategorizedCount > 0"
              class="media-chip media-chip--uncategorized"
              :class="{ 'media-chip--active': selectedCategoryIds.has(UNCATEGORIZED_ID) }"
              @click="toggleCategoryChip(UNCATEGORIZED_ID)"
            >
              <span class="media-chip-icon-wrap">
                <Icon :icon="ICONS.UI.FILE_MULTIPLE" :size="14" />
              </span>
              <span class="media-chip-name">{{ t("uncategorized") }}</span>
              <span class="media-chip-count">{{ uncategorizedCount }}</span>
              <button
                type="button"
                class="media-chip-add"
                :title="t('add_files')"
                :aria-label="t('add_files')"
                @click.stop="beginAddWithCategory(UNCATEGORIZED_ID)"
              >
                <Icon :icon="ICONS.ACTIONS.ADD" :size="12" />
              </button>
            </div>
          </div>
          <div v-if="filteredFiles.length" class="media-grid">
            <div
              v-for="file in filteredFiles"
              :key="file.id"
              class="media-grid-item"
              @click="addToPlaylist(file)"
            >
              <img
                v-if="file.thumb"
                :src="file.thumb"
                class="media-grid-item-thumb"
                alt=""
                loading="lazy"
              />
              <div v-else class="media-grid-item-thumb media-grid-item-thumb--icon">
                <Icon :icon="fileTypeIcon(file.type)" :size="28" />
              </div>
              <div class="media-grid-item-name">{{ file.name }}</div>
              <div v-if="categoryName(file.categoryId)" class="media-grid-item-category">
                {{ categoryName(file.categoryId) }}
              </div>
              <div class="media-grid-item-actions">
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.EDIT"
                  :title="t('rename')"
                  :aria-label="t('rename')"
                  @click.stop="startRename(file)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.DELETE"
                  :title="t('delete')"
                  :aria-label="t('delete')"
                  @click.stop="removeFile(file)"
                />
              </div>
            </div>
          </div>
          <div v-else class="media-empty">
            <LjEmpty :icon="ICONS.UI.FOLDER_OPEN" :title="t('empty_library')" />
          </div>
        </div>

        <LjDivider vertical />

        <!-- Playlist -->
        <div class="media-playlist">
          <div class="media-playlist-header">
            <Icon :icon="ICONS.FORMAT.LIST_BULLETED" :size="16" />
            <span>{{ t("playlist") }} ({{ playlist.length }})</span>
            <span class="lj-u-spacer" />
            <LjButton
              v-if="playlist.length"
              size="sm"
              variant="ghost"
              icon-only
              class="media-btn-danger"
              :icon="ICONS.ACTIONS.DELETE"
              :title="t('clear')"
              :aria-label="t('clear')"
              @click="clearPlaylist"
            />
          </div>
          <LjDivider />
          <div v-if="playlist.length" class="media-playlist-items">
            <div
              v-for="(item, i) in playlist"
              :key="item.id"
              class="media-playlist-item"
              :class="{ 'media-playlist-item--active': i === currentIndex }"
              @click="playIndex(i)"
            >
              <div class="media-playlist-item-icon">
                <Icon :icon="item.typeIcon" :size="18" />
              </div>
              <div class="media-playlist-item-name">{{ item.name }}</div>
              <div class="media-playlist-item-actions">
                <LjButton
                  v-if="i === currentIndex && isPlaying"
                  size="sm"
                  variant="ghost"
                  icon-only
                  class="media-btn-accent"
                  :icon="ICONS.PLAYER.PLAY"
                  :title="t('project')"
                  :aria-label="t('project')"
                  @click.stop="playIndex(i)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.CLOSE"
                  :title="t('remove_from_playlist')"
                  :aria-label="t('remove_from_playlist')"
                  @click.stop="removeFromPlaylist(i)"
                />
              </div>
            </div>
          </div>
          <div v-else class="media-empty">
            <LjEmpty :icon="ICONS.PLAYER.PLAYLIST_REMOVE" :title="t('empty_playlist')" />
          </div>
        </div>
      </div>

      <!-- Player bar -->
      <div v-if="isPlaying && currentItem" class="media-playerbar">
        <div class="media-playerbar-info">
          <Icon :icon="currentItem.typeIcon" :size="16" />
          <span class="media-playerbar-name">{{ currentItem.name }}</span>
          <span class="media-playerbar-index">{{ currentIndex + 1 }} / {{ playlist.length }}</span>
        </div>
        <div class="media-playerbar-controls">
          <LjButton
            icon-only
            variant="ghost"
            :icon="ICONS.PLAYER.PREV"
            :title="t('prev')"
            :aria-label="t('prev')"
            :disabled="
              currentIndex <= 0 &&
              (!currentItem || currentItem.type !== 'pdf' || currentPdfPage <= 1)
            "
            @click="prev"
          />
          <LjButton
            icon-only
            variant="ghost"
            :icon="ICONS.PLAYER.NEXT"
            :title="t('next')"
            :aria-label="t('next')"
            :disabled="
              currentIndex >= playlist.length - 1 &&
              (!currentItem ||
                currentItem.type !== 'pdf' ||
                (currentPdfTotalPages > 0 && currentPdfPage >= currentPdfTotalPages))
            "
            @click="next"
          />
          <LjButton
            icon-only
            variant="ghost"
            class="media-btn-danger"
            :icon="ICONS.PLAYER.STOP"
            :title="t('stop')"
            :aria-label="t('stop')"
            @click="stop"
          />
        </div>
      </div>

      <!-- Rename dialog -->
      <LjDialog
        v-model="showRenameDialog"
        size="sm"
        :title="t('rename')"
        :icon="ICONS.ACTIONS.EDIT_OUTLINE"
      >
        <div class="media-rename">
          <LjInput
            v-model="renameInput"
            autofocus
            :aria-label="t('rename')"
            @keydown.enter="confirmRename"
          />
        </div>
        <template #footer>
          <LjButton size="sm" @click="showRenameDialog = false">{{ t("cancel") }}</LjButton>
          <LjButton size="sm" variant="primary" :disabled="!renameInput" @click="confirmRename">
            {{ t("rename") }}
          </LjButton>
        </template>
      </LjDialog>

      <!-- Hidden file input -->
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="image/*,video/*,.pdf,.heic,.heif"
        class="media-file-input"
        @change="onFilesSelected"
      />

      <!-- Seleção de categoria na importação -->
      <LjDialog v-model="showCategorySelect" size="sm" :title="t('select_category')">
        <div class="media-cat-list">
          <button
            type="button"
            class="media-cat-option"
            @click="selectCategoryForImport(UNCATEGORIZED_ID)"
          >
            {{ t("uncategorized") }}
          </button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            class="media-cat-option"
            @click="selectCategoryForImport(cat.id)"
          >
            {{ cat.name }}
          </button>
        </div>
      </LjDialog>

      <!-- Gerenciar Categorias -->
      <CategoryManagerDialog
        v-model="showManageDialog"
        :categories="categories"
        :saving="saving"
        :icon-options="iconOptions"
        :color-presets="colorPresets"
        module-id="media_library"
        @save="handleSaveCategory"
        @delete="handleDeleteCategory"
      />
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import CategoryManagerDialog, {
  type CategoryFileData,
} from "@/components/CategoryManagerDialog.vue";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjDivider, LjEmpty, LjInput, LjTabs } from "@/components/ui";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { openFileProjectionWindows, closeProjectionWindows } from "@/helpers/ProjectionWindows";
import $media from "@/composables/useMedia";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import $alert from "@/helpers/Alert";
import { ICONS } from "@/config/Icons";
import $idb from "@/helpers/IndexedDB";
import { ensureRenderableImage, isHeic, heicToJpeg } from "@/helpers/ImageConvert";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";
import { IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MediaFile {
  id: string;
  name: string;
  path: string;
  type: "image" | "video" | "pdf";
  thumb?: string;
  addedAt: number;
  data?: ArrayBuffer;
  mime?: string;
  categoryId?: string;
}

interface PlaylistItem {
  id: string;
  name: string;
  path: string;
  type: "image" | "video" | "pdf";
  typeIcon: string;
}

/** Filtro de tipo da barra de abas. */
type LibraryFilter = "all" | MediaFile["type"];

/** Ícone que representa o tipo do arquivo — na grade e na playlist. */
function fileTypeIcon(type: MediaFile["type"]): string {
  if (type === "image") return ICONS.MEDIA.IMAGE;
  if (type === "pdf") return ICONS.UI.FILE_PDF;
  return ICONS.MEDIA.VIDEO_FILE;
}

/* ------------------------------------------------------------------ */
/*  IDB helpers                                                        */
/* ------------------------------------------------------------------ */

const STORE_LIBRARY = DB_TABLE.MEDIA_LIBRARY;
const STORE_CATEGORY = DB_TABLE.MEDIA_LIBRARY_CATEGORY;

/** Id virtual dos itens adicionados sem categoria. */
const UNCATEGORIZED_ID = "";

async function loadLibrary(): Promise<MediaFile[]> {
  const all = await $idb.getAll<MediaFile>(STORE_LIBRARY);
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

async function saveFile(file: MediaFile): Promise<void> {
  const plain = { ...file };
  if (plain.data && plain.data.byteLength === 0) {
    delete plain.data;
  }
  await $idb.put(STORE_LIBRARY, plain);
}

async function deleteFile(id: string): Promise<void> {
  await $idb.del(STORE_LIBRARY, id);
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const moduleContainer = ref<{ t(key: string): string } | null>(null);
const t = (key: string): string => moduleContainer.value?.t(key) || key;

const libraryFilter = ref<LibraryFilter>("all");

const filterTabs = computed(() => [
  { value: "all", label: t("all") },
  { value: "image", label: t("images") },
  { value: "video", label: t("videos") },
  { value: "pdf", label: t("documents") },
]);

const searchQuery = ref("");
const files = ref<MediaFile[]>([]);

// ─── Categorias ──────────────────────────────────────────────────────

const categories = ref<CategoryFileData[]>([]);
const selectedCategoryIds = ref(new Set<string>());
const showManageDialog = ref(false);
const showCategorySelect = ref(false);
const saving = ref(false);
let pendingCategoryId: string | null = null;
const pendingDropEntries = ref<File[]>([]);

async function loadCategories(): Promise<void> {
  categories.value = (await $idb.getAll<CategoryFileData>(STORE_CATEGORY)).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function categoryName(categoryId?: string): string {
  if (!categoryId) return "";
  return categories.value.find((c) => c.id === categoryId)?.name || "";
}

const uncategorizedCount = computed(() => {
  const ids = new Set(categories.value.map((c) => c.id));
  return files.value.filter((f) => !f.categoryId || !ids.has(f.categoryId)).length;
});

function toggleCategoryChip(id: string): void {
  const next = new Set(selectedCategoryIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedCategoryIds.value = next;
}

/** Após carregar/salvar, garante que tudo fique visível. */
function selectAllCategoriesAndUncategorized(): void {
  const next = new Set(categories.value.map((c) => c.id));
  if (uncategorizedCount.value > 0) next.add(UNCATEGORIZED_ID);
  selectedCategoryIds.value = next;
}

/** Salva cópia plana — Proxy reativo não é clonável pelo IndexedDB. */
async function saveCategoryRecord(cat: CategoryFileData): Promise<void> {
  const plain = {
    id: String(cat.id),
    name: String(cat.name),
    icon: String(cat.icon),
    iconType: String(cat.iconType) as "icon" | "image",
    ...(cat.iconData && cat.iconData.byteLength > 0
      ? { iconData: cat.iconData, iconMime: String(cat.iconMime || "image/png") }
      : {}),
    color: String(cat.color),
  };
  await $idb.put(STORE_CATEGORY, plain);
}

async function handleSaveCategory(cat: CategoryFileData): Promise<void> {
  saving.value = true;
  try {
    await saveCategoryRecord(cat);
    await loadCategories();
    selectAllCategoriesAndUncategorized();
  } finally {
    saving.value = false;
  }
}

const iconOptions = Object.values(ICONS.CATEGORY).map((value) => ({ value }));

const colorPresets = [
  "#4CAF50",
  "#2196F3",
  "#9C27B0",
  "#FF9800",
  "#F44336",
  "#00BCD4",
  "#3F51B5",
  "#E91E63",
];

/** Excluir categoria apaga TAMBÉM os arquivos dela (padrão som de fundo). */
async function handleDeleteCategory(id: string): Promise<void> {
  const affected = files.value.filter((f) => f.categoryId === id);
  for (const f of affected) {
    await removeFile(f);
  }
  await $idb.del(STORE_CATEGORY, id);
  categories.value = categories.value.filter((c) => c.id !== id);
  const next = new Set(selectedCategoryIds.value);
  next.delete(id);
  selectedCategoryIds.value = next;
}
const playlist = ref<PlaylistItem[]>([]);
const currentIndex = ref(-1);
const isPlaying = ref(false);
const currentPdfPage = ref(1);
const currentPdfTotalPages = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);

/* ------------------------------------------------------------------ */
/*  Blob URL tracking                                                  */
/* ------------------------------------------------------------------ */

const createdObjectUrls = new Map<string, string>();

function revokeObjectUrl(id: string): void {
  const url = createdObjectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    createdObjectUrls.delete(id);
  }
}

function createObjectUrl(id: string, data: ArrayBuffer, mime: string): string {
  revokeObjectUrl(id);
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  createdObjectUrls.set(id, url);
  return url;
}

async function readFileData(file: File): Promise<{ data: ArrayBuffer; mime: string }> {
  const data = await file.arrayBuffer();
  return { data, mime: file.type || "application/octet-stream" };
}

/* ------------------------------------------------------------------ */
/*  Video thumbnail generation                                         */
/* ------------------------------------------------------------------ */

function generateVideoThumbnail(videoUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;

    let cleanup: (() => void) | null = null;

    const done = (thumb?: string) => {
      if (cleanup) cleanup();
      video.remove();
      resolve(thumb);
    };

    cleanup = () => {
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
    };

    video.onloadeddata = () => {
      video.currentTime = Math.max(0, Math.min(1, (video.duration || 1) - 0.25));
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(160 / video.videoWidth, 90 / video.videoHeight, 1);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.6));
      } else {
        done();
      }
    };

    video.onerror = () => done();

    video.src = videoUrl;
    video.load();
  });
}

async function generateAndStoreThumb(file: MediaFile): Promise<void> {
  if (file.thumb) return;
  const url = resolvePath(file.path);
  const thumb = await generateVideoThumbnail(url);
  if (thumb) {
    file.thumb = thumb;
    await saveFile(file);
  }
}

/* ------------------------------------------------------------------ */
/*  Drag & drop                                                        */
/* ------------------------------------------------------------------ */

const isDragOver = ref(false);
let dragCounter = 0;

function onDragEnter(): void {
  isDragOver.value = true;
  dragCounter++;
}

function onDragOver(): void {
  isDragOver.value = true;
}

function onDragLeave(): void {
  dragCounter--;
  if (dragCounter <= 0) {
    isDragOver.value = false;
    dragCounter = 0;
  }
}

async function onDrop(e: DragEvent): Promise<void> {
  isDragOver.value = false;
  dragCounter = 0;
  const droppedFiles = e.dataTransfer?.files;
  if (!droppedFiles?.length) return;

  const valid: File[] = [];
  for (const f of Array.from(droppedFiles)) {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    const isMedia = IMAGE_EXT.includes(ext) || VIDEO_EXT.includes(ext) || ext === "pdf";
    if (isMedia) valid.push(f);
  }
  if (!valid.length) {
    $alert.error({
      text: "Tipo de arquivo não suportado. Use imagens, vídeos ou PDF.",
    });
    return;
  }

  // Seleção de categoria (Sem categoria sempre disponível), depois importa.
  pendingDropEntries.value = valid;
  pendingCategoryId = null;
  showCategorySelect.value = true;
}

/** Importa um arquivo arrastado (com caminho no desktop ou blob na web). */
async function importDroppedEntry(f: File, categoryId: string): Promise<void> {
  const filePath = (f as any).path;
  if (filePath && !isHeic(f.name, (f as File).type)) {
    const name = f.name;
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const isImage = IMAGE_EXT.includes(ext);
    const isVideo = VIDEO_EXT.includes(ext);
    const isPdf = ext === "pdf";
    if (!isImage && !isVideo && !isPdf) return;
    const fileType = isPdf ? ("pdf" as const) : isImage ? ("image" as const) : ("video" as const);
    const file: MediaFile = {
      id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name,
      path: filePath,
      type: fileType,
      addedAt: Date.now(),
      categoryId,
    };
    if (isImage) file.thumb = buildThumbPath(filePath);
    await saveFile(file);
    files.value.unshift(file);
    if (isVideo) generateAndStoreThumb(file);
  } else {
    // Sem caminho (web) ou HEIC/HEIF: converte e armazena autocontido.
    const { blob, name } = await ensureRenderableImage(f.name, f);
    const isImage =
      IMAGE_EXT.includes(name.split(".").pop()?.toLowerCase() || "") ||
      blob.type.startsWith("image/");
    const isVideo = VIDEO_EXT.includes(f.name.split(".").pop()?.toLowerCase() || "");
    const isPdf = f.type === "application/pdf" || f.name?.toLowerCase().endsWith(".pdf");
    if (!isImage && !isVideo && !isPdf) return;
    const fileType = isPdf ? ("pdf" as const) : isImage ? ("image" as const) : ("video" as const);
    const fileId = "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const path = URL.createObjectURL(blob);
    const { data, mime } = await readFileData(new File([blob], name, { type: blob.type }));
    const file: MediaFile = {
      id: fileId,
      name,
      path,
      type: fileType,
      addedAt: Date.now(),
      data,
      mime,
      categoryId,
    };
    if (isImage) file.thumb = path;
    createdObjectUrls.set(fileId, path);
    await saveFile(file);
    files.value.unshift(file);
    if (isVideo) generateAndStoreThumb(file);
  }
}

/* ------------------------------------------------------------------ */
/*  Rename / Delete                                                    */
/* ------------------------------------------------------------------ */

const showRenameDialog = ref(false);
const renamingFile = ref<MediaFile | null>(null);
const renameInput = ref("");

function startRename(file: MediaFile): void {
  renamingFile.value = file;
  renameInput.value = file.name;
  showRenameDialog.value = true;
}

async function confirmRename(): Promise<void> {
  const file = renamingFile.value;
  if (!file || !renameInput.value.trim()) return;
  file.name = renameInput.value.trim();
  await saveFile(file);
  showRenameDialog.value = false;
  renamingFile.value = null;
}

async function removeFile(file: MediaFile): Promise<void> {
  revokeObjectUrl(file.id);
  const idx = playlist.value.findIndex((p) => p.id === file.id);
  if (idx >= 0) {
    if (idx === currentIndex.value) stop();
    else if (idx < currentIndex.value) currentIndex.value--;
    playlist.value.splice(idx, 1);
    savePlaylist();
  }
  await deleteFile(file.id);
  files.value = files.value.filter((f) => f.id !== file.id);
}

/* ------------------------------------------------------------------ */
/*  Computed                                                           */
/* ------------------------------------------------------------------ */

const filteredFiles = computed(() => {
  let list = files.value;
  if (selectedCategoryIds.value.size > 0) {
    list = list.filter((f) => selectedCategoryIds.value.has(f.categoryId || UNCATEGORIZED_ID));
  }
  if (libraryFilter.value !== "all") {
    list = list.filter((f) => f.type === libraryFilter.value);
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((f) => f.name.toLowerCase().includes(q));
  }
  return list;
});

const currentItem = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < playlist.value.length
    ? playlist.value[currentIndex.value]
    : null
);

/* ------------------------------------------------------------------ */
/*  Library management                                                 */
/* ------------------------------------------------------------------ */

function buildThumbPath(filePath: string): string | undefined {
  if (Platform.isDesktop && filePath.startsWith("/")) {
    return "louvorja://local" + filePath;
  }
  return undefined;
}

/** Entrada do botão Adicionar: abre seleção de categoria antes do picker. */
function addFiles(): void {
  pendingDropEntries.value = [];
  pendingCategoryId = null;
  showCategorySelect.value = true;
}

/** "+" no chip: já importa direto para a categoria, sem diálogo. */
function beginAddWithCategory(catId: string): void {
  pendingCategoryId = catId;
  pendingDropEntries.value = [];
  if (Platform.isDesktop && (Platform.api as any)?.storage?.chooseFile) {
    void doAddFiles(catId);
  } else {
    fileInput.value?.click();
  }
}

async function doAddFiles(categoryId: string): Promise<void> {
  const api = Platform.api as LouvorjaApi | null;
  if (Platform.isDesktop && api?.storage?.chooseFile) {
    const result = await api.storage.chooseFile();
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    for (const rawPath of paths) {
      const name = rawPath.split("/").pop() || rawPath.split("\\").pop() || rawPath;
      const ext = name.split(".").pop()?.toLowerCase() || "";
      const isImage = IMAGE_EXT.includes(ext);
      const isVideo = VIDEO_EXT.includes(ext);
      const isPdf = ext === "pdf";
      if (!isImage && !isVideo && !isPdf) continue;
      const fileType = isPdf ? ("pdf" as const) : isImage ? ("image" as const) : ("video" as const);
      const file: MediaFile = {
        id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name,
        path: rawPath,
        type: fileType,
        addedAt: Date.now(),
        categoryId,
      };
      if (isImage) file.thumb = buildThumbPath(rawPath);
      await saveFile(file);
      files.value.unshift(file);
      if (isVideo) generateAndStoreThumb(file);
    }
  } else {
    fileInput.value?.click();
  }
}

/** Escolha de categoria feita no diálogo (drop ou botão Adicionar). */
async function selectCategoryForImport(catId: string): Promise<void> {
  pendingCategoryId = catId;
  showCategorySelect.value = false;
  await nextTick();

  if (pendingDropEntries.value.length) {
    const entries = [...pendingDropEntries.value];
    pendingDropEntries.value = [];
    for (const f of entries) {
      await importDroppedEntry(f, catId);
    }
    selectAllCategoriesAndUncategorized();
    return;
  }
  await doAddFiles(catId);
}

async function onFilesSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  for (const f of Array.from(input.files)) {
    const filePath = (f as any).path;
    if (filePath && !isHeic(f.name, (f as File).type)) {
      const name = f.name;
      const ext = name.split(".").pop()?.toLowerCase() || "";
      const isImage = IMAGE_EXT.includes(ext);
      const isVideo = VIDEO_EXT.includes(ext);
      const isPdf = ext === "pdf";
      if (!isImage && !isVideo && !isPdf) continue;
      const fileType = isPdf ? ("pdf" as const) : isImage ? ("image" as const) : ("video" as const);
      const file: MediaFile = {
        id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name,
        path: filePath,
        type: fileType,
        addedAt: Date.now(),
        categoryId: pendingCategoryId ?? UNCATEGORIZED_ID,
      };
      if (isImage) file.thumb = buildThumbPath(filePath);
      await saveFile(file);
      files.value.unshift(file);
      if (isVideo) generateAndStoreThumb(file);
    } else {
      // Sem caminho (web/drag-drop) ou HEIC/HEIF: armazena autocontido com
      // os bytes convertidos para JPEG — o Chromium não decodifica HEIC.
      const { blob, name } = await ensureRenderableImage(f.name, f);
      const isImage =
        IMAGE_EXT.includes(name.split(".").pop()?.toLowerCase() || "") ||
        blob.type.startsWith("image/");
      const isVideo = VIDEO_EXT.includes(f.name.split(".").pop()?.toLowerCase() || "");
      const isPdf = f.type === "application/pdf" || f.name?.toLowerCase().endsWith(".pdf");
      if (!isImage && !isVideo && !isPdf) continue;
      const fileType = isPdf ? ("pdf" as const) : isImage ? ("image" as const) : ("video" as const);
      const fileId = "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const path = URL.createObjectURL(blob);
      const { data, mime } = await readFileData(new File([blob], name, { type: blob.type }));
      const file: MediaFile = {
        id: fileId,
        name,
        path,
        type: fileType,
        addedAt: Date.now(),
        data,
        mime,
        categoryId: pendingCategoryId ?? UNCATEGORIZED_ID,
      };
      if (isImage) file.thumb = path;
      createdObjectUrls.set(fileId, path);
      await saveFile(file);
      files.value.unshift(file);
      if (isVideo) generateAndStoreThumb(file);
    }
  }
  input.value = "";
}

/* ------------------------------------------------------------------ */
/*  Playlist                                                           */
/* ------------------------------------------------------------------ */

const PLAYLIST_KEY = "modules.media_library.playlist";

function savePlaylist(): void {
  const data = playlist.value.map(({ id, name, path, type }) => ({ id, name, path, type }));
  $userdata.set(PLAYLIST_KEY, data);
}

function loadPlaylist(): void {
  $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, false);
  const saved = $userdata.get<
    { id: string; name: string; path: string; type: "image" | "video" | "pdf" }[]
  >(PLAYLIST_KEY, []);
  if (saved?.length) {
    playlist.value = saved.map((item) => ({
      ...item,
      typeIcon: fileTypeIcon(item.type),
    }));
  }
}

function addToPlaylist(file: MediaFile): void {
  const item: PlaylistItem = {
    id: file.id,
    name: file.name,
    path: file.path,
    type: file.type,
    typeIcon: fileTypeIcon(file.type),
  };
  playlist.value.push(item);
  savePlaylist();
}

function removeFromPlaylist(index: number): void {
  if (index === currentIndex.value) stop();
  else if (index < currentIndex.value) currentIndex.value--;
  playlist.value.splice(index, 1);
  savePlaylist();
}

function clearPlaylist(): void {
  stop();
  playlist.value = [];
  savePlaylist();
}

/* ------------------------------------------------------------------ */
/*  Projection                                                         */
/* ------------------------------------------------------------------ */

function resolvePath(raw: string): string {
  if (raw.startsWith("http") || raw.startsWith("blob:") || raw.startsWith("louvorja://"))
    return raw;
  if (Platform.isDesktop && raw.startsWith("/")) return "louvorja://local" + raw;
  return raw;
}

// Cache de objectURLs de HEIC já convertidos para projeção (por item.id).
const heicProjectionCache = new Map<string, string>();

/**
 * HEIC/HEIF não decodifica no Chromium — converte para JPEG na hora e
 * cacheia o objectURL por item. Registros convertidos na importação não
 * passam por aqui.
 */
async function resolveRenderableUrl(item: PlaylistItem): Promise<string> {
  const raw = resolvePath(item.path);
  if (!isHeic(item.name)) return raw;

  const cached = heicProjectionCache.get(item.id);
  if (cached) return cached;

  const bytes = await fetch(raw).then((r) => r.blob());
  const jpeg = await heicToJpeg(bytes);
  const url = URL.createObjectURL(jpeg);
  heicProjectionCache.set(item.id, url);
  return url;
}

async function playIndex(index: number): Promise<void> {
  const item = playlist.value[index];
  if (!item) return;
  if (currentIndex.value === index && isPlaying.value) return;

  currentIndex.value = index;
  isPlaying.value = true;
  $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, true);
  currentPdfPage.value = 1;
  currentPdfTotalPages.value = 0;

  const url = isHeic(item.name) ? await resolveRenderableUrl(item) : resolvePath(item.path);
  const isVideo = item.type === "video";

  const payload: Record<string, unknown> = { url, type: item.type, title: item.name };
  if (item.type === "pdf") {
    payload.page = 1;
  }

  localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify(payload));

  await openFileProjectionWindows();

  $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, payload);

  if (isVideo) {
    $media.openAudio({ url, title: item.name });
    $appdata.set("modules.media.config.video_file", true);
  } else {
    $media.stop();
    $appdata.set("modules.media.config.video_file", false);
  }
}

async function togglePlay(): Promise<void> {
  if (isPlaying.value) {
    await stop();
    return;
  }
  if (playlist.value.length) {
    await playIndex(0);
  }
}

async function next(): Promise<void> {
  const item = playlist.value[currentIndex.value];
  if (item?.type === "pdf") {
    const total = currentPdfTotalPages.value;
    if (total > 0 && currentPdfPage.value >= total) {
      if (currentIndex.value < playlist.value.length - 1) {
        await playIndex(currentIndex.value + 1);
      } else {
        await stop();
      }
      return;
    }
    currentPdfPage.value++;
    $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, { page: currentPdfPage.value });
    return;
  }
  if (currentIndex.value < playlist.value.length - 1) {
    await playIndex(currentIndex.value + 1);
  } else {
    await stop();
  }
}

async function prev(): Promise<void> {
  const item = playlist.value[currentIndex.value];
  if (item?.type === "pdf") {
    if (currentPdfPage.value <= 1) {
      if (currentIndex.value > 0) {
        await playIndex(currentIndex.value - 1);
      }
      return;
    }
    currentPdfPage.value--;
    $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, { page: currentPdfPage.value });
    return;
  }
  if (currentIndex.value > 0) {
    await playIndex(currentIndex.value - 1);
  }
}

function stop(): void {
  isPlaying.value = false;
  $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, false);
  currentIndex.value = -1;
  localStorage.removeItem("lj_file_projection");
  $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
  closeProjectionWindows();
  $appdata.set("modules.media.config.video_file", false);
  $media.close(true);
}

/* ------------------------------------------------------------------ */
/*  Ribbon actions                                                     */
/* ------------------------------------------------------------------ */

useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload) => {
  const data = payload as { module?: string; action?: string; payload?: unknown } | null;
  if (data?.module !== "media_library") return;
  switch (data.action) {
    case "add":
      addFiles();
      break;
    case "clear":
      clearPlaylist();
      break;
    case "manage_categories":
      showManageDialog.value = true;
      break;
    case "play":
      togglePlay();
      break;
    case "next":
      next();
      break;
    case "prev":
      prev();
      break;
    case "stop":
      stop();
      break;
  }
});

// Recebe page/totalPages da janela de projeção
useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_PAGE, (payload) => {
  const data = payload as { page?: number; totalPages?: number };
  if (typeof data.page === "number") {
    currentPdfPage.value = data.page;
  }
  if (typeof data.totalPages === "number") {
    currentPdfTotalPages.value = data.totalPages;
  }
});

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onMounted(async () => {
  files.value = await loadLibrary();
  await loadCategories();
  selectAllCategoriesAndUncategorized();
  loadPlaylist();
  for (const f of files.value) {
    if (f.path.startsWith("blob:")) {
      if (f.data && f.mime) {
        const url = createObjectUrl(f.id, f.data, f.mime);
        f.path = url;
        if (f.type === "image") f.thumb = url;
      }
      continue;
    }
    if (
      Platform.isDesktop &&
      (f.type === "image" || f.type === "video") &&
      f.path.startsWith("/")
    ) {
      if (!f.thumb || !f.thumb.startsWith("louvorja://")) {
        f.thumb = buildThumbPath(f.path);
      }
    }
    if (f.type === "video" && !f.thumb) {
      generateAndStoreThumb(f);
    }
  }
});

onBeforeUnmount(() => {
  for (const url of createdObjectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  createdObjectUrls.clear();
  stop();
});
</script>

<style scoped>
.media-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.media-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-2) var(--lj-space-5);
  min-height: 40px;
  flex-shrink: 0;
}

.media-split {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Bloco, não flex: `flex-direction` e `gap` aqui são inertes. Mantido como
   estava — ligar o flex muda a altura da grade e da área vazia. */
.media-library {
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--lj-space-4);
  gap: var(--lj-space-2);
  min-width: 0;
}

.media-search {
  margin-bottom: var(--lj-space-5);
}

.media-search :deep(.lj-input) {
  width: 100%;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--lj-space-4);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-content: start;
  align-items: start;
  padding-bottom: var(--lj-space-4);
}

.media-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-4) var(--lj-space-2);
  border-radius: var(--lj-radius-lg);
  cursor: pointer;
  transition:
    background var(--lj-transition-normal),
    border-color var(--lj-transition-normal);
  border: 1px solid transparent;
  position: relative;
}

.media-grid-item:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-surface-border);
}

.media-grid-item-actions {
  position: absolute;
  top: var(--lj-space-3);
  right: 0;
  display: flex;
  opacity: 0;
  transition: opacity var(--lj-transition-fast);
  border-radius: var(--lj-radius-sm);
  /* Translúcido de propósito: a miniatura continua legível por baixo. */
  background: color-mix(in srgb, var(--lj-surface-bg) 80%, transparent);
}

.media-grid-item:hover .media-grid-item-actions {
  opacity: 1;
}

.media-grid-item-thumb {
  width: 100%;
  height: 70px;
  object-fit: contain;
  border-radius: var(--lj-radius-lg);
  overflow: hidden;
  background: var(--lj-surface-bg-soft);
}

.media-grid-item-thumb--icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lj-text-subtle);
}

.media-grid-item-name {
  font-size: var(--lj-text-sm);
  line-height: 1.3;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
  width: 100%;
  color: var(--lj-text);
}

.media-grid-item-category {
  font-size: var(--lj-text-xs);
  padding: 0 var(--lj-space-3) var(--lj-space-1);
  color: var(--lj-text-subtle);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

/* ── Chips de categorias (filtro) ── */
.media-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-4) var(--lj-space-4);
}

.media-chips-title {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--lj-text-muted);
}

.media-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-1) var(--lj-space-5);
  /* Pílula — o raio acompanha a altura, fora da escala de raios do sistema. */
  border-radius: 999px;
  border: 1.5px solid var(--chip-color);
  background: transparent;
  color: var(--chip-color);
  cursor: pointer;
  font-size: var(--lj-text-base);
  font-family: inherit;
  transition:
    background var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
  opacity: 0.55;
  outline: none;
  white-space: nowrap;
}

.media-chip:hover {
  opacity: 0.85;
}

.media-chip--active {
  background: color-mix(in srgb, var(--chip-color) 20%, transparent);
  opacity: 1;
}

.media-chip--uncategorized {
  --chip-color: var(--lj-text-subtle);
}

.media-chip-icon-wrap {
  display: flex;
  align-items: center;
}

.media-chip-img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.media-chip-count {
  font-size: var(--lj-text-xs);
  background: color-mix(in srgb, var(--chip-color) 30%, transparent);
  border-radius: 999px;
  padding: 0 var(--lj-space-3);
  line-height: 16px;
}

.media-chip-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  padding: 0;
  opacity: 0.6;
  transition:
    opacity var(--lj-transition-fast),
    background var(--lj-transition-fast);
}

.media-chip-add:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--chip-color) 20%, transparent);
}

.media-playlist {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 200px;
  flex-shrink: 0;
}

.media-playlist-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-5);
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text);
  flex-shrink: 0;
}

.media-playlist-items {
  flex: 1;
  overflow-y: auto;
  padding: var(--lj-space-2) 0;
}

.media-playlist-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-3) var(--lj-space-5);
  cursor: pointer;
  transition: background var(--lj-transition-fast);
  border-left: 3px solid transparent;
}

.media-playlist-item:hover {
  background: var(--lj-surface-bg-hover);
}

.media-playlist-item--active {
  background: var(--lj-ui-accent-soft);
  border-left-color: var(--lj-ui-accent);
}

.media-playlist-item-icon {
  display: flex;
  flex-shrink: 0;
  color: var(--lj-text-subtle);
}

.media-playlist-item-name {
  flex: 1;
  font-size: var(--lj-text-base);
  color: var(--lj-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-playlist-item-actions {
  display: flex;
  gap: var(--lj-space-1);
  opacity: 0;
  transition: opacity var(--lj-transition-fast);
}

.media-playlist-item:hover .media-playlist-item-actions {
  opacity: 1;
}

.media-playerbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-3) var(--lj-space-6);
  border-top: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
  flex-shrink: 0;
}

.media-playerbar-info {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  flex: 1;
  min-width: 0;
  color: var(--lj-text);
}

.media-playerbar-name {
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-playerbar-index {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.media-playerbar-controls {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  flex-shrink: 0;
}

/* Botão fantasma tingido: a forma vem do primitivo, a cor de estado daqui. */
.media-playlist-header .media-btn-danger,
.media-playerbar-controls .media-btn-danger {
  color: var(--lj-danger);
}

.media-playlist-header .media-btn-danger:hover,
.media-playerbar-controls .media-btn-danger:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}

.media-playlist-item-actions .media-btn-accent {
  color: var(--lj-ui-accent-text);
}

.media-root--drag-over {
  outline: 3px dashed var(--lj-ui-accent);
  outline-offset: -6px;
  background: var(--lj-ui-accent-soft);
}

.media-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  padding: var(--lj-space-6);
}

.media-file-input {
  display: none;
}

/* ── Diálogos ── */

/* `class` num LjInput cai no <input> interno (inheritAttrs: false), não na
   moldura — a largura tem de vir do envoltório, via :deep(). */
.media-rename :deep(.lj-input) {
  width: 100%;
}

.media-cat-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
}

.media-cat-option {
  display: flex;
  align-items: center;
  min-height: var(--lj-ui-h-lg);
  padding: 0 var(--lj-space-5);
  border: none;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--lj-transition-fast);
}

.media-cat-option:hover {
  background: var(--lj-surface-bg-hover);
}

.media-cat-option:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
