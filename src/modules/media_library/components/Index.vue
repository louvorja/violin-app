<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: mobileLayout ? '0' : '700px' }"
    @close="stop"
  >
    <div
      class="media-root"
      :class="{ 'media-root--drag-over': isDragOver, 'media-root--mobile': mobileLayout }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <nav v-if="mobileLayout" class="media-mobile-nav" :aria-label="tm('title')">
        <button
          type="button"
          class="media-mobile-nav__button"
          :class="{ 'is-active': mobileView === 'library' }"
          :aria-current="mobileView === 'library' ? 'page' : undefined"
          @click="mobileView = 'library'"
        >
          {{ tm("library") }}
        </button>
        <button
          type="button"
          class="media-mobile-nav__button"
          :class="{ 'is-active': mobileView === 'playlist' }"
          :aria-current="mobileView === 'playlist' ? 'page' : undefined"
          @click="mobileView = 'playlist'"
        >
          {{ tm("playlist") }} ({{ playlist.length }})
        </button>
      </nav>

      <!-- Toolbar -->
      <div v-show="!mobileLayout || mobileView === 'library'" class="media-toolbar">
        <LjTabs
          :model-value="libraryFilter"
          :tabs="filterTabs"
          :aria-label="tm('library')"
          @update:model-value="libraryFilter = $event as LibraryFilter"
        />
        <span class="lj-u-spacer" />
        <LjButton
          size="sm"
          variant="subtle"
          :icon="ICONS.ACTIONS.ADD"
          class="media-add-button"
          @click="addFiles"
        >
          {{ tm("add_files") }}
        </LjButton>
      </div>

      <LjDivider v-show="!mobileLayout || mobileView === 'library'" />

      <!-- Split -->
      <div class="media-split">
        <!-- Library -->
        <div v-show="!mobileLayout || mobileView === 'library'" class="media-library">
          <!-- Aba Canva: conteúdo remoto, navegação por pastas, sem busca local. -->
          <CanvaTab v-if="libraryFilter === 'canva'" />

          <!-- PDF no telão: painel do operador (slide atual, próximo, todos, fontes) -->
          <PdfOperatorPanel
            v-else-if="painelVisivel && palco"
            :url="palco.url"
            :title="palco.title"
            :page="nativoAtivo ? (nativo.index ?? 0) + 1 : currentPdfPage"
            :total="nativoAtivo ? (nativo.total ?? 0) : currentPdfTotalPages"
            :fonts="fontesNoPalco"
            :regenerating="regerando"
            :native="painelNativo"
            :features="arquivoNoPalco?.pptx?.features ?? null"
            :tm="tm"
            @goto="painelIrPara"
            @prev="painelAnterior"
            @next="painelProximo"
            @stop="pararTudo"
            @back="painelOculto = true"
            @install-font="instalarFonteManual"
            @regenerate="regerarNoPalco"
            @native-start="iniciarNativo(arquivoNoPalco)"
            @native-end="encerrarNativo"
            @black="nativoNav('black')"
          />

          <template v-else>
            <div class="media-search">
              <LjInput
                v-model="searchQuery"
                clearable
                :icon="ICONS.ACTIONS.SEARCH"
                :placeholder="tm('search')"
                :aria-label="tm('search')"
              />
            </div>

            <!-- Chips de categorias (filtro) -->
            <div v-if="categories.length || uncategorizedCount > 0" class="media-chips">
              <span class="media-chips-title">{{ tm("categories") }}</span>
              <div
                v-for="cat in categories"
                :key="cat.id"
                class="media-chip"
                :class="{ 'media-chip--active': selectedCategoryIds.has(cat.id) }"
                :style="{ '--chip-color': cat.color }"
                @click="toggleCategoryChip(cat.id)"
              >
                <span class="media-chip-icon-wrap">
                  <LjIcon v-if="cat.iconType === 'icon'" :icon="cat.icon" :size="14" />
                  <img v-else :src="cat.icon" class="media-chip-img" alt="" />
                </span>
                <span class="media-chip-name">{{ cat.name }}</span>
                <span class="media-chip-count">
                  {{ files.filter((f) => f.categoryId === cat.id).length }}
                </span>
                <button
                  type="button"
                  class="media-chip-add"
                  :title="tm('add_files')"
                  :aria-label="tm('add_files')"
                  @click.stop="beginAddWithCategory(cat.id)"
                >
                  <LjIcon :icon="ICONS.ACTIONS.ADD" :size="12" />
                </button>
              </div>
              <div
                v-if="uncategorizedCount > 0"
                class="media-chip media-chip--uncategorized"
                :class="{ 'media-chip--active': selectedCategoryIds.has(UNCATEGORIZED_ID) }"
                @click="toggleCategoryChip(UNCATEGORIZED_ID)"
              >
                <span class="media-chip-icon-wrap">
                  <LjIcon :icon="ICONS.UI.FILE_MULTIPLE" :size="14" />
                </span>
                <span class="media-chip-name">{{ tm("uncategorized") }}</span>
                <span class="media-chip-count">{{ uncategorizedCount }}</span>
                <button
                  type="button"
                  class="media-chip-add"
                  :title="tm('add_files')"
                  :aria-label="tm('add_files')"
                  @click.stop="beginAddWithCategory(UNCATEGORIZED_ID)"
                >
                  <LjIcon :icon="ICONS.ACTIONS.ADD" :size="12" />
                </button>
              </div>
            </div>
            <div v-if="filteredFiles.length" class="media-grid">
              <div
                v-for="file in filteredFiles"
                :key="file.id"
                class="media-grid-item"
                @click="tocarDaBiblioteca(file)"
              >
                <img
                  v-if="file.thumb"
                  :src="file.thumb"
                  class="media-grid-item-thumb"
                  alt=""
                  loading="lazy"
                  @error="thumbNaoCarregou(file)"
                />
                <div v-else class="media-grid-item-thumb media-grid-item-thumb--icon">
                  <LjIcon :icon="fileTypeIcon(file.type)" :size="28" />
                </div>
                <div class="media-grid-item-name">{{ file.name }}</div>
                <div v-if="categoryName(file.categoryId)" class="media-grid-item-category">
                  {{ categoryName(file.categoryId) }}
                </div>
                <!--
                  Ações do card. O "+" vem primeiro porque enfileirar é a ação
                  de rotina: o clique do card projeta o arquivo avulso, e é este
                  botão que o coloca na playlist para percorrer depois com as
                  setas.
                -->
                <div class="media-grid-item-actions">
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.ACTIONS.ADD"
                    :title="tm('add_to_playlist')"
                    :aria-label="tm('add_to_playlist')"
                    @click.stop="adicionarItem(file)"
                  />
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.ACTIONS.EDIT"
                    :title="tm('rename')"
                    :aria-label="tm('rename')"
                    @click.stop="startRename(file)"
                  />
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.ACTIONS.DELETE"
                    :title="tm('delete')"
                    :aria-label="tm('delete')"
                    @click.stop="removeFile(file)"
                  />
                </div>
              </div>
            </div>
            <div v-else class="media-empty">
              <LjEmpty :icon="ICONS.UI.FOLDER_OPEN" :title="tm('empty_library')" />
            </div>
          </template>
        </div>

        <LjDivider v-if="!mobileLayout" vertical />

        <!-- Playlist -->
        <div v-show="!mobileLayout || mobileView === 'playlist'" class="media-playlist">
          <div class="media-playlist-header">
            <LjIcon :icon="ICONS.FORMAT.LIST_BULLETED" :size="16" />
            <span>{{ tm("playlist") }} ({{ playlist.length }})</span>
            <span class="lj-u-spacer" />
            <LjButton
              v-if="playlist.length"
              size="sm"
              variant="ghost"
              icon-only
              class="media-btn-danger"
              :icon="ICONS.ACTIONS.DELETE"
              :title="tm('clear')"
              :aria-label="tm('clear')"
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
                <LjIcon :icon="item.typeIcon" :size="18" />
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
                  :title="tm('project')"
                  :aria-label="tm('project')"
                  @click.stop="playIndex(i)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.CLOSE"
                  :title="tm('remove_from_playlist')"
                  :aria-label="tm('remove_from_playlist')"
                  @click.stop="removeFromPlaylist(i)"
                />
              </div>
            </div>
          </div>
          <div v-else class="media-empty">
            <LjEmpty :icon="ICONS.PLAYER.PLAYLIST_REMOVE" :title="tm('empty_playlist')" />
          </div>
        </div>
      </div>

      <!--
        Player bar. Serve ao PDF da lista E ao projetado pela aba Canva — o
        telão é o mesmo, só muda de onde veio o item. No caso de um PDF, o
        índice vira "Página X / Y", porque "1 / 1" não diz nada quando o
        documento tem cinco.
      -->
      <div v-if="mostrarBarra" class="media-playerbar">
        <div class="media-playerbar-info">
          <LjIcon :icon="barraIcone" :size="16" />
          <span class="media-playerbar-name">{{ barraTitulo }}</span>
          <span class="media-playerbar-index">{{ barraIndice }}</span>
        </div>
        <div class="media-playerbar-controls">
          <LjButton
            v-if="palco && !painelVisivel"
            size="sm"
            variant="ghost"
            :icon="ICONS.UI.VIEW_GRID_OUTLINE"
            @click="
              painelOculto = false;
              libraryFilter = 'all';
            "
          >
            {{ tm("pptx.panel_open") }}
          </LjButton>
          <LjButton
            icon-only
            variant="ghost"
            :icon="ICONS.PLAYER.PREV"
            :title="tm('prev')"
            :aria-label="tm('prev')"
            :disabled="!podeVoltar"
            @click="prev"
          />
          <LjButton
            icon-only
            variant="ghost"
            :icon="ICONS.PLAYER.NEXT"
            :title="tm('next')"
            :aria-label="tm('next')"
            :disabled="!podeAvancar"
            @click="next"
          />
          <LjButton
            icon-only
            variant="ghost"
            class="media-btn-danger"
            :icon="ICONS.PLAYER.STOP"
            :title="tm('stop')"
            :aria-label="tm('stop')"
            @click="stop"
          />
        </div>
      </div>

      <!-- Andamento do PowerPoint (fontes + slides) -->
      <PptxImportDialog
        :state="importacao"
        :tm="tm"
        :regenerating="regerando"
        @close="importacao = null"
        @project="projetarImportado"
        @project-native="projetarImportadoNativo"
        @install-font="instalarFonteManual"
        @drop-fonts="instalarFontesArrastadas"
        @open-permission-settings="abrirAjustesPermissao"
        @retry="tentarImportarDeNovo"
      />

      <!-- Rename dialog -->
      <LjDialog
        v-model="showRenameDialog"
        size="sm"
        :title="tm('rename')"
        :icon="ICONS.ACTIONS.EDIT_OUTLINE"
      >
        <div class="media-rename">
          <LjInput
            v-model="renameInput"
            autofocus
            :aria-label="tm('rename')"
            @keydown.enter="confirmRename"
          />
        </div>
        <template #footer>
          <LjButton size="sm" @click="showRenameDialog = false">{{ tm("cancel") }}</LjButton>
          <LjButton size="sm" variant="primary" :disabled="!renameInput" @click="confirmRename">
            {{ tm("rename") }}
          </LjButton>
        </template>
      </LjDialog>

      <!-- Hidden file input -->
      <input
        ref="fileInput"
        type="file"
        multiple
        :accept="`image/*,video/*,audio/*,.pdf,.heic,.heif,${PPT_ACCEPT}`"
        class="media-file-input"
        @change="onFilesSelected"
      />

      <!-- Seleção de categoria na importação -->
      <LjDialog v-model="showCategorySelect" size="sm" :title="tm('select_category')">
        <div class="media-cat-list">
          <button
            type="button"
            class="media-cat-option"
            @click="selectCategoryForImport(UNCATEGORIZED_ID)"
          >
            {{ tm("uncategorized") }}
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
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import { useViewport } from "@/composables/useViewport";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import CategoryManagerDialog, {
  type CategoryFileData,
} from "@/components/CategoryManagerDialog.vue";
import { nextCategorySelection } from "@/helpers/CategorySelection";
import { LjButton, LjDialog, LjDivider, LjEmpty, LjIcon, LjInput, LjTabs } from "@/components/ui";
import CanvaTab from "./CanvaTab.vue";
import PdfOperatorPanel from "./PdfOperatorPanel.vue";
import PptxImportDialog from "./PptxImportDialog.vue";
import { openInPresentationMode } from "@/modules/presentation_mode/composables/openInPresentationMode";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { isOpen as isProjectionOpen } from "@/helpers/Projection";
import { PROJECTION_TYPE } from "@/constants/Projection";
import { nextFileProjectionEpoch } from "@/presentation/FileProjectionActivation";
import {
  closeFileProjectionWindows,
  closeProjectionWindows,
  openMediaWindow,
  openSiteWindow,
} from "@/helpers/ProjectionWindows";
import $media from "@/composables/useMedia";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import $path from "@/helpers/Path";
import $alert from "@/helpers/Alert";
import { reportLocalFileFailure } from "@/helpers/LocalFailureNotice";
import { localPathOf } from "@/helpers/FilePath";
import $snackbar from "@/helpers/Snackbar";
import { ICONS } from "@/config/Icons";
import $idb from "@/helpers/IndexedDB";
import { ensureRenderableImage, isHeic, heicToJpeg } from "@/helpers/ImageConvert";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import {
  PPT_ACCEPT,
  applyProgress,
  isFontFileName,
  isPowerPointName,
  parseFeatures,
  missingFonts,
  parseConvertResult,
  progressDetail,
  type PptxImportState,
} from "../pptxImport";
import {
  adotarProjecaoExterna,
  fileProjectionPageFor,
  newFileProjectionId,
} from "@/helpers/FileProjectionPage";

const { width: viewportWidth } = useViewport();
const mobileLayout = computed(() => !Platform.isDesktop && viewportWidth.value <= 1000);
const mobileView = ref<"library" | "playlist">("library");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MediaFile {
  id: string;
  name: string;
  path: string;
  type: "image" | "video" | "pdf" | "audio";
  thumb?: string;
  addedAt: number;
  data?: ArrayBuffer;
  mime?: string;
  categoryId?: string;
  /** PDF gerado de um PowerPoint: o .pptx de origem e a situação das fontes. */
  pptx?: {
    source: string;
    fonts: PptxFont[];
    /** Animações e mídias: o que o modo imagem deixa parado. */
    features?: PptxFeatures;
    /** Este PC pode apresentar com o próprio PowerPoint. */
    nativeAvailable?: boolean;
  };
}

interface PlaylistItem {
  id: string;
  name: string;
  path: string;
  type: "image" | "video" | "pdf" | "audio" | "site";
  typeIcon: string;
}

/** Filtro de tipo da barra de abas. `canva` troca a grade local pela remota. */
type LibraryFilter = "all" | MediaFile["type"] | "canva";

/** Ícone que representa o tipo do arquivo — na grade e na playlist. */
function fileTypeIcon(type: MediaFile["type"] | "site"): string {
  if (type === "image") return ICONS.MEDIA.IMAGE;
  if (type === "pdf") return ICONS.UI.FILE_PDF;
  if (type === "audio") return ICONS.MEDIA.AUDIO;
  // Item de URL do Canva (modo site): link, não arquivo.
  if (type === "site") return ICONS.UI.LINK;
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

/*
 * Assinatura do `tm` exposto pelo ModuleContainer. Os nomes aqui são contrato,
 * não variáveis — por isso o `_`, que é o que a regra de lint aceita para
 * argumento não usado.
 */
const moduleContainer = ref<{
  tm: (_key: string, _named?: Record<string, unknown>) => string;
} | null>(null);
const tm = (key: string, named?: Record<string, unknown>): string =>
  (named ? moduleContainer.value?.tm(key, named) : moduleContainer.value?.tm(key)) || key;

const libraryFilter = ref<LibraryFilter>("all");

/**
 * A Biblioteca colocou um ARQUIVO no telão?
 *
 * Áudio não conta: ele toca no player e não ocupa palco. A distinção é o que
 * permite "Parar" só calar o áudio sem fechar um PDF que esteja na tela.
 */
const projetandoDaBiblioteca = ref(false);

const filterTabs = computed(() => [
  { value: "all", label: tm("all") },
  { value: "image", label: tm("images") },
  { value: "audio", label: tm("audios") },
  { value: "video", label: tm("videos") },
  { value: "pdf", label: tm("documents") },
  { value: "canva", label: tm("canva.title") },
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
    const isNew = !categories.value.some((c) => String(c.id) === String(cat.id));
    await saveCategoryRecord(cat);
    await loadCategories();
    selectedCategoryIds.value = nextCategorySelection(
      selectedCategoryIds.value,
      String(cat.id),
      isNew
    );
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

/**
 * O que as setas fazem enquanto um item da lista está no ar.
 *
 * Indireção em vez de referência direta a `next`/`prev`: são funções
 * declaradas depois, e o registro precisa ser um objeto estável — assim o
 * `unregister` do `stop` casa com o que o `playIndex` registrou.
 */
const _navigationDelegado = {
  next: () => next(),
  prev: () => prev(),
};
// Fonte única com quem desliga a projeção de fora (fechar a janela pelo ESC).
// Um ref local aqui deixava a barra do player acesa com o projetor apagado.
const isPlaying = computed<boolean, boolean>({
  get: () => $userdata.get<boolean>(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, false) === true,
  set: (value: boolean) => $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, value),
});
const currentPdfPage = ref(1);
const currentPdfTotalPages = ref(0);
let currentPdfPlaybackId: string | undefined;
/*
 * PDF no telão que NÃO veio desta lista — o caso é a aba Canva, que projeta
 * direto por `$media.projectFile`.
 *
 * Sem isto a barra do player não aparecia, `next()` caía no ramo de playlist e
 * acabava em `stop()` (fechando a projeção na frente da congregação), e o
 * indicador de página não tinha onde morar. Adotar o `playback_id` que está no
 * telão é o que faz o PDF de fora usar exatamente os mesmos controles do PDF
 * da lista.
 */
const pdfExterno = ref<{ playback_id: string; title: string; declaredPageCount?: number } | null>(
  null
);
/** Aviso de contagem já dado para este PDF — não repete a cada página. */
let avisoContagemDado = false;
let playIndexGeneration = 0;
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

/**
 * Tempo máximo por miniatura.
 *
 * Sem isto, um vídeo que nunca carrega (caminho movido, rede presa) deixa o
 * `<video>` esperando para sempre. Como a fila é serial, isso travaria todas as
 * miniaturas seguintes.
 */
const MINIATURA_TIMEOUT_MS = 10_000;

function generateVideoThumbnail(videoUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let encerrado = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;

    let cleanup: (() => void) | null = null;

    const done = (thumb?: string) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      if (cleanup) cleanup();
      video.remove();
      resolve(thumb);
    };

    const timer = setTimeout(() => done(), MINIATURA_TIMEOUT_MS);

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

/*
 * Fila das miniaturas de vídeo.
 *
 * Abrir o módulo não pode disparar um `<video>` por arquivo: cada um é um
 * Range em `louvorja://local` que o próprio seek cancela pela metade, e uma
 * biblioteca com hundreds de vídeos viraria hundreds de carregamentos e
 * decodificadores ao mesmo tempo. Um por vez, com fila cancelável: as
 * miniaturas aparecem aos poucos e somem com o módulo.
 */
let _filaMiniaturas: MediaFile[] = [];
let _miniaturasDrenando = false;
let _filaMiniaturasCancelada = false;

async function _enfileirarMiniaturas(alvos: MediaFile[]): Promise<void> {
  _filaMiniaturas.push(...alvos.filter((f) => f.type === "video" && !f.thumb));
  if (_miniaturasDrenando) return;
  _miniaturasDrenando = true;
  try {
    while (_filaMiniaturas.length && !_filaMiniaturasCancelada) {
      const file = _filaMiniaturas.shift();
      if (!file) continue;
      try {
        await generateAndStoreThumb(file);
      } catch {
        /* Miniatura é cortesia: uma falha não para a fila nem o módulo. */
      }
    }
  } finally {
    _miniaturasDrenando = false;
  }
}

/**
 * Miniatura que não carregou é refeita.
 *
 * Um `thumb` pode vir envenenado por duas vias: o mount punha o caminho do
 * VÍDEO no lugar dele (MP4 num `<img>`), e um renomear depois disso grava esse
 * caminho no IndexedDB, porque `confirmRename` salva o objeto em memória. Sem
 * esta cura, o card fica com o ícone quebrado para sempre.
 *
 * Não há trava de repetição: o `<img>` só existe enquanto houver `thumb`, e uma
 * regeneração que falha deixa o campo vazio — o ciclo se encerra sozinho e o
 * card volta ao ícone do tipo de arquivo.
 */
function thumbNaoCarregou(file: MediaFile): void {
  file.thumb = undefined;
  /* Imagem com caminho quebrado (arquivo movido) vira o ícone do tipo: não há
     como gerar miniatura de um arquivo que não existe mais. */
  if (file.type !== "video") return;
  void _enfileirarMiniaturas([file]);
}

function _cancelarFilaMiniaturas(): void {
  _filaMiniaturasCancelada = true;
  _filaMiniaturas = [];
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

// Um aviso por lote: escolher dez áudios não deve empilhar dez alertas.
let unsupportedPending = false;
function noteUnsupported(): void {
  if (unsupportedPending) return;
  unsupportedPending = true;
  setTimeout(() => {
    unsupportedPending = false;
    $alert.error({ text: tm("unsupported_file_type"), translate: false });
  }, 0);
}

async function onDrop(e: DragEvent): Promise<void> {
  isDragOver.value = false;
  dragCounter = 0;
  const droppedFiles = e.dataTransfer?.files;
  if (!droppedFiles?.length) return;

  // Fonte arrastada (.ttf, .otf ou o .zip do DaFont): instala, não é mídia.
  const fontes = Array.from(droppedFiles).filter((f) => isFontFileName(f.name));
  if (fontes.length) {
    void instalarFontesArrastadas(fontes);
    if (fontes.length === droppedFiles.length) return;
  }

  const valid: File[] = [];
  for (const f of Array.from(droppedFiles)) {
    if (isFontFileName(f.name)) continue;
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    const isMedia =
      IMAGE_EXT.includes(ext) ||
      VIDEO_EXT.includes(ext) ||
      AUDIO_EXT.includes(ext) ||
      ext === "pdf" ||
      isPowerPointName(f.name);
    if (isMedia) valid.push(f);
  }
  if (valid.length + fontes.length < droppedFiles.length) noteUnsupported();
  if (!valid.length) return;

  // Seleção de categoria (Sem categoria sempre disponível), depois importa.
  pendingDropEntries.value = valid;
  pendingCategoryId = null;
  showCategorySelect.value = true;
}

/** Importa um arquivo arrastado (com caminho no desktop ou blob na web). */
async function importDroppedEntry(f: File, categoryId: string): Promise<void> {
  const filePath = localPathOf(f);
  if (isPowerPointName(f.name)) {
    await importPowerPoint(filePath, f.name, categoryId);
    return;
  }
  const tipoDoDrop = tipoDoArquivo(f.name, (f as File).type);
  if (!tipoDoDrop) return;
  /* Com caminho no disco, o registro guarda só o caminho; os bytes ficam onde
   * já estavam. HEIC é a exceção: não decodifica no Chromium e precisa ser
   * convertido antes de virar arquivo autocontido. */
  if (filePath && !isHeic(f.name, (f as File).type)) {
    const file: MediaFile = {
      id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: f.name,
      path: filePath,
      type: tipoDoDrop,
      addedAt: Date.now(),
      categoryId,
    };
    if (tipoDoDrop === "image") file.thumb = buildThumbPath(filePath);
    await saveFile(file);
    files.value.unshift(file);
    if (tipoDoDrop === "video") generateAndStoreThumb(file);
    return;
  }
  {
    // Sem caminho (web) ou HEIC/HEIF: armazena autocontido. Só IMAGEM passa
    // pela conversão; áudio e vídeo vão como vieram, senão o conversor tentaria
    // decodificar um mp3 como imagem.
    const { blob, name } =
      tipoDoDrop === "image"
        ? await ensureRenderableImage(f.name, f)
        : { blob: f as Blob, name: f.name };
    const fileType = tipoDoDrop;
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
    if (fileType === "image") file.thumb = path;
    createdObjectUrls.set(fileId, path);
    await saveFile(file);
    files.value.unshift(file);
    if (fileType === "video") generateAndStoreThumb(file);
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
  /* A aba Canva não tem arquivo local — quem monta a grade é o CanvaTab. */
  if (libraryFilter.value === "canva") return [];
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
/*  Player bar — a lista OU o PDF projetado de fora                    */
/* ------------------------------------------------------------------ */

/** O item da lista está no palco (é ele que a barra tradicional mostra). */
const barraLista = computed(() => isPlaying.value && !!currentItem.value);
/** Há um PDF no palco, venha ele da lista ou da aba Canva. */
const pdfNoPalco = computed(() => !!pdfExterno.value || currentItem.value?.type === "pdf");
const mostrarBarra = computed(() => barraLista.value || !!pdfExterno.value);
const barraTitulo = computed(() =>
  barraLista.value ? (currentItem.value?.name ?? "") : (pdfExterno.value?.title ?? "")
);
const barraIcone = computed(() =>
  barraLista.value ? (currentItem.value?.typeIcon ?? "") : fileTypeIcon("pdf")
);
const barraIndice = computed(() => {
  if (pdfNoPalco.value && currentPdfTotalPages.value > 0) {
    return tm("page_indicator", { page: currentPdfPage.value, total: currentPdfTotalPages.value });
  }
  return `${currentIndex.value + 1} / ${playlist.value.length}`;
});
/** Última página de um PDF de fora não tem "próxima": o botão apaga. */
const podeAvancar = computed(() => {
  if (pdfExterno.value) {
    return currentPdfTotalPages.value > 0
      ? currentPdfPage.value < currentPdfTotalPages.value
      : true;
  }
  return !(
    currentIndex.value >= playlist.value.length - 1 &&
    (!currentItem.value ||
      currentItem.value.type !== "pdf" ||
      (currentPdfTotalPages.value > 0 && currentPdfPage.value >= currentPdfTotalPages.value))
  );
});
const podeVoltar = computed(() => {
  if (pdfExterno.value) return currentPdfPage.value > 1;
  return !(
    currentIndex.value <= 0 &&
    (!currentItem.value || currentItem.value.type !== "pdf" || currentPdfPage.value <= 1)
  );
});

/* ------------------------------------------------------------------ */
/*  Library management                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  PowerPoint → PDF fiel (fontes instaladas antes)                    */
/* ------------------------------------------------------------------ */

const backgroundTasks = useBackgroundTasks();

/** Janela de andamento do PowerPoint sendo preparado (null = fechada). */
const importacao = ref<PptxImportState | null>(null);

/** Última importação, para "Tentar de novo" depois de autorizar o macOS. */
let retryImportacao: (() => void) | null = null;

/**
 * Converte o .pptx num PDF fiel e guarda o PDF na biblioteca, com o nome do
 * arquivo original. A conversão roda no main (fontes + PowerPoint/LibreOffice)
 * e o andamento aparece numa janela — e em "Processos em segundo plano", que
 * continua valendo se o operador fechar a janela.
 *
 * `substituir`: "Gerar de novo" do painel — atualiza o item existente em vez
 * de criar outro.
 */
async function importPowerPoint(
  filePath: string | null | undefined,
  name: string,
  categoryId: string,
  substituir?: MediaFile
): Promise<MediaFile | null> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!Platform.isDesktop || !api || !filePath) {
    $alert.error({ text: tm("pptx.desktop_only"), translate: false });
    return null;
  }
  const taskId = "pptx-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  backgroundTasks.registerTask(taskId, tm("pptx.task", { name }));
  importacao.value = { name, path: filePath, phase: "fonts", converter: "", fonts: [], error: "" };
  retryImportacao = () => void importPowerPoint(filePath, name, categoryId, substituir);
  const daJanela = () => importacao.value?.path === filePath;
  const off = api.onProgress((p) => {
    if (!p || p.path !== filePath) return;
    if (daJanela() && importacao.value) importacao.value = applyProgress(importacao.value, p);
    const info = progressDetail(p, tm);
    if (info) backgroundTasks.updateTask(taskId, info);
  });
  try {
    // Gerar de novo (substituir) sempre converte; importar usa o que já estiver pronto.
    const result = parseConvertResult(
      await api.convert(filePath, !!substituir, motorApresentacao())
    );
    if (!result.ok) {
      const macPermission = result.code === "mac_permission";
      const mensagem = macPermission ? tm("pptx.permission_denied") : result.message;
      backgroundTasks.updateTask(taskId, { status: "error", error: mensagem });
      if (daJanela() && importacao.value) {
        importacao.value = {
          ...importacao.value,
          phase: "error",
          error: mensagem,
          macPermission,
        };
      } else {
        $alert.error({
          text: macPermission
            ? tm("pptx.permission_denied")
            : tm("pptx.failed", { message: result.message }),
          translate: false,
        });
      }
      return null;
    }
    backgroundTasks.completeTask(taskId);
    if (result.permissionFallback) {
      $alert.info({ text: tm("pptx.permission_fallback"), translate: false });
    }
    const pptx = {
      source: filePath,
      fonts: result.fonts,
      features: result.features,
      nativeAvailable: result.nativeAvailable,
    };
    // IndexedDB não aceita Proxy do Vue: grava uma cópia simples.
    const pptxPlano = () => JSON.parse(JSON.stringify(pptx)) as NonNullable<MediaFile["pptx"]>;
    let file: MediaFile;
    if (substituir) {
      file = substituir;
      file.path = result.path;
      file.pptx = pptx;
      await saveFile({
        ...file,
        pptx: pptxPlano(),
      });
      files.value = [...files.value];
    } else {
      file = {
        id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name,
        path: result.path,
        type: "pdf",
        addedAt: Date.now(),
        categoryId,
        pptx,
      };
      await saveFile({
        ...file,
        pptx: pptxPlano(),
      });
      files.value.unshift(file);
    }

    if (daJanela() && importacao.value) {
      importacao.value = {
        ...importacao.value,
        phase: "done",
        fonts: result.fonts.map((f) => ({ ...f })),
        fontsError: result.fontsError || importacao.value.fontsError,
        fileId: file.id,
        features: result.features,
        nativeAvailable: result.nativeAvailable,
      };
      if (result.staleFonts) $alert.info({ text: tm("pptx.stale_fonts"), translate: false });
    } else {
      // A janela foi fechada (segue em segundo plano): avisa do jeito curto.
      const faltam = missingFonts(result.fonts);
      if (faltam.length) {
        $alert.info({
          text: tm("pptx.missing_fonts", { name, fonts: faltam.join(", ") }),
          translate: false,
        });
      } else if (result.staleFonts) {
        $alert.info({ text: tm("pptx.stale_fonts"), translate: false });
      } else {
        $snackbar.success(tm(result.cached ? "pptx.ready_cached" : "pptx.ready", { name }));
      }
    }
    return file;
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    backgroundTasks.updateTask(taskId, { status: "error", error: message });
    if (daJanela() && importacao.value) {
      importacao.value = { ...importacao.value, phase: "error", error: message };
    } else {
      $alert.error({ text: tm("pptx.failed", { message }), translate: false });
    }
    return null;
  } finally {
    off();
  }
}

/** Abre o painel de permissões do macOS (Arquivos e Pastas). */
function abrirAjustesPermissao(): void {
  void (Platform.api as LouvorjaApi | null)?.pptx?.openPermissionSettings?.();
}

/** Repete a importação depois de o operador autorizar o macOS. */
function tentarImportarDeNovo(): void {
  retryImportacao?.();
}

/** "Projetar agora" da janela de importação. */
async function projetarImportado(): Promise<void> {
  const id = importacao.value?.fileId;
  importacao.value = null;
  const file = files.value.find((f) => f.id === id);
  if (file) await tocarDaBiblioteca(file);
}

/* ------------------------------------------------------------------ */
/*  Painel do operador (PDF no telão)                                  */
/* ------------------------------------------------------------------ */

/**
 * O PDF que está no telão: de onde ler as miniaturas e, se veio de um
 * PowerPoint, as fontes. Preenchido por quem projeta (biblioteca, playlist ou
 * a aba Canva) e limpo quando a projeção acaba.
 */
const palco = ref<{ url: string; title: string; fileId?: string } | null>(null);
/** O operador voltou para a biblioteca com o PDF ainda no ar. */
const painelOculto = ref(false);
const regerando = ref(false);

const painelVisivel = computed(
  () =>
    !!palco.value &&
    (pdfNoPalco.value || nativoAtivo.value || nativoAbrindo.value) &&
    !painelOculto.value &&
    libraryFilter.value !== "canva"
);
const arquivoNoPalco = computed(() =>
  palco.value?.fileId ? (files.value.find((f) => f.id === palco.value?.fileId) ?? null) : null
);
const fontesNoPalco = computed(() => arquivoNoPalco.value?.pptx?.fonts ?? null);

/*
 * Itens adicionados antes da contagem de animações não a guardaram: o aviso
 * "este arquivo tem animações…" não aparecia. Conta uma vez, ao abrir o
 * painel, e grava no item.
 */
const featuresPedidas = new Set<string>();
watch(arquivoNoPalco, async (file) => {
  const pptx = file?.pptx;
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!file || !pptx?.source || pptx.features || !api?.features) return;
  if (featuresPedidas.has(file.id)) return;
  featuresPedidas.add(file.id);
  try {
    const r = await api.features(pptx.source);
    if (!r.ok) return;
    const atualizado = { ...file, pptx: { ...pptx, features: parseFeatures(r.features) } };
    await saveFile(JSON.parse(JSON.stringify(atualizado)) as MediaFile);
    const i = files.value.findIndex((f) => f.id === file.id);
    if (i >= 0) files.value[i] = atualizado;
  } catch {
    /* sem o aviso, o resto segue igual */
  }
});

/* ---------------- Modo nativo: o PowerPoint apresenta no PA ---------------- */

/** Estado da apresentação nativa, vindo do main. */
const nativo = ref<PptxNativeState>({ active: false });
const nativoAtivo = computed(() => nativo.value.active === true);
const nativoAbrindo = ref(false);
/** Com o programa escolhido em Opções, este computador apresenta com animações? */
const nativoNestePc = ref(false);
/** Já perguntamos ao main (antes disso vale o que o item guardou). */
const nativoConferido = ref(false);
/** Nome do programa que apresenta: "PowerPoint" ou "LibreOffice". */
const programaNativo = ref("PowerPoint");

/** Programa escolhido em Opções → Player de Áudio/Vídeo. */
function motorApresentacao(): "auto" | "powerpoint" | "libreoffice" {
  const m = $userdata.get<string>(KEYS.OPTIONS.FILE_PROJECTION.PRESENTATION_ENGINE, "auto");
  return m === "powerpoint" || m === "libreoffice" ? m : "auto";
}

/** Pergunta ao main o que dá para fazer com o programa escolhido agora. */
async function conferirProgramaNativo(): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api?.status) return;
  try {
    const s = await api.status(motorApresentacao());
    nativoNestePc.value = s?.native === true;
    if (typeof s?.converter === "string" && s.converter) programaNativo.value = s.converter;
    nativoConferido.value = true;
  } catch {
    /* fica o que o item guardou */
  }
}
watch(
  () => $userdata.get<string>(KEYS.OPTIONS.FILE_PROJECTION.PRESENTATION_ENGINE, "auto"),
  () => void conferirProgramaNativo()
);
let pararEscutaNativo: (() => void) | null = null;

/** O que o painel precisa saber do modo nativo (null = PDF comum, sem a opção). */
const painelNativo = computed(() => {
  const pptx = arquivoNoPalco.value?.pptx;
  if (!pptx && !nativoAtivo.value) return null;
  return {
    // Vale o que este PC tem com o programa escolhido; antes da resposta, o que o item guardou.
    available:
      !!pptx?.source &&
      (nativoConferido.value ? nativoNestePc.value : pptx.nativeAvailable === true),
    app:
      nativo.value.engine === "libreoffice"
        ? "LibreOffice"
        : nativo.value.engine === "powerpoint"
          ? "PowerPoint"
          : programaNativo.value,
    active: nativoAtivo.value,
    black: !!nativo.value.black,
    busy: nativoAbrindo.value,
  };
});

/*
 * Enquanto o PowerPoint apresenta, as setas do operador (e o passador de
 * slides, que manda as mesmas teclas) são dele. Sem o delegado elas caíam no
 * avanço de página do PDF e mexiam só no retorno.
 */
const _navegacaoNativa = {
  next: () => nativoNav("next"),
  prev: () => nativoNav("prev"),
};

function aoEstadoNativo(st: PptxNativeState): void {
  const estava = nativoAtivo.value;
  nativo.value = st && typeof st === "object" ? st : { active: false };
  if (nativo.value.active && !estava) $media.registerNavigationDelegate(_navegacaoNativa);
  if (!nativo.value.active && estava) $media.unregisterNavigationDelegate();
  if (nativo.value.active) {
    retornoNativoPagina((nativo.value.index ?? 0) + 1);
    return;
  }
  // O PowerPoint terminou (Esc nele ou fim dos slides): o painel e o retorno saem com ele.
  if (estava && !pdfNoPalco.value) {
    palco.value = null;
    fecharRetornoNativo();
  }
}

/*
 * Retorno do palestrante no modo nativo.
 *
 * O PA é do PowerPoint, mas o retorno continua sendo o do LouvorJA: a mesma
 * janela do modo imagem, com o slide atual e o próximo tirados do PDF já
 * gerado. A animação não aparece ali (é a imagem final do slide), o que basta
 * para quem está falando saber onde está e o que vem depois.
 */
let retornoNativoId: string | undefined;
/** Quando o PA do LouvorJA fechou para o PowerPoint entrar. */
let paFechadoEm = 0;
/** O que o retorno precisa para abrir o PDF (sem a página, que muda). */
let retornoNativoBase: Record<string, unknown> | null = null;

/** Manda o PDF inteiro para o retorno (abre ou reativa) na página atual. */
function enviarRetornoNativo(): void {
  if (!retornoNativoBase) return;
  // Época nova a cada envio: depois de um "clear" o retorno só aceita uma seleção nova.
  const atual = {
    ...retornoNativoBase,
    page: currentPdfPage.value,
    stage_epoch: nextFileProjectionEpoch(),
  };
  try {
    localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify(atual));
  } catch {
    /* cache de reabertura é opcional */
  }
  $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, atual);
}

async function abrirRetornoNativo(file: MediaFile, pagina: number): Promise<void> {
  if (!($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, false) as boolean)) return;
  const id = newFileProjectionId();
  retornoNativoId = id;
  // Mesmo playback_id: o nosso próprio listener reconhece e não "adota" de novo.
  currentPdfPlaybackId = id;
  currentPdfPage.value = pagina;
  retornoNativoBase = {
    url: resolvePath(file.path),
    type: "pdf",
    title: file.name,
    playback_id: id,
  };
  /*
   * O PA do LouvorJA acabou de fechar para o PowerPoint entrar, e a limpeza
   * dessa janela (useProjectionShutdown, ~2 s depois) fecha o retorno junto.
   * Por isso o retorno só abre depois dela, e é conferido uma vez em seguida.
   * Não insiste mais do que isso: se o operador fechar o retorno (Esc), fica fechado.
   */
  const desdeOFechamento = Date.now() - paFechadoEm;
  if (desdeOFechamento < 2600) await new Promise((r) => setTimeout(r, 2600 - desdeOFechamento));
  for (const espera of [0, 1200]) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    if (retornoNativoId !== id || (!nativoAtivo.value && !nativoAbrindo.value)) return;
    const aberto = await isProjectionOpen(PROJECTION_TYPE.FILE_RETURN);
    if (!aberto) {
      console.info("[pptx] abrindo o retorno do modo nativo", { espera });
      await openMediaWindow("return", "file");
      // O retorno nasce com o foco; as setas (e o passador) têm que continuar
      // chegando aqui, que é quem as manda ao PowerPoint.
      window.focus();
    }
    const reenviar = !espera || !aberto || currentPdfPlaybackId !== id;
    currentPdfPlaybackId = id;
    if (reenviar) enviarRetornoNativo();
  }
}

function retornoNativoPagina(pagina: number): void {
  if (!retornoNativoId) return;
  // Um "clear" atrasado do PA que fechou pode ter zerado o id: o retorno ainda é nosso.
  const mudouId = currentPdfPlaybackId !== retornoNativoId;
  currentPdfPlaybackId = retornoNativoId;
  if (!mudouId && currentPdfPage.value === pagina) return;
  currentPdfPage.value = pagina;
  if (mudouId) enviarRetornoNativo();
  else broadcastPdfPage();
}

function fecharRetornoNativo(): void {
  if (!retornoNativoId) return;
  retornoNativoId = undefined;
  retornoNativoBase = null;
  currentPdfPlaybackId = undefined;
  localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
  $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
  void closeFileProjectionWindows();
}

/**
 * "Apresentar com o PowerPoint": tira o PDF do telão do LouvorJA e pede ao
 * PowerPoint para apresentar o .pptx original no monitor do PA, a partir do
 * slide em que o operador estava.
 */
async function iniciarNativo(file: MediaFile | null | undefined): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api || !file?.pptx?.source || nativoAbrindo.value) return;
  const inicio = palco.value?.fileId === file.id ? Math.max(0, currentPdfPage.value - 1) : 0;
  const manter = { url: resolvePath(file.path), title: file.name, fileId: file.id };
  stop();
  paFechadoEm = Date.now();
  palco.value = manter;
  painelOculto.value = false;
  nativoAbrindo.value = true;
  try {
    const r = await api.nativeStart(file.pptx.source, inicio, motorApresentacao());
    if (!r.ok) {
      palco.value = null;
      $alert.error({
        text: tm("pptx.native_failed", { app: programaNativo.value, message: r.message }),
        translate: false,
      });
      return;
    }
    aoEstadoNativo(r.state);
    void abrirRetornoNativo(file, (r.state?.index ?? inicio) + 1);
  } catch (error) {
    palco.value = null;
    const message = (error as Error)?.message || String(error);
    $alert.error({
      text: tm("pptx.native_failed", { app: programaNativo.value, message }),
      translate: false,
    });
  } finally {
    nativoAbrindo.value = false;
  }
}

let ultimaNav: { action: string; em: number } = { action: "", em: 0 };

async function nativoNav(
  action: "next" | "prev" | "goto" | "black",
  index?: number
): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api || !nativoAtivo.value) return;
  /*
   * Uma tecla chega por mais de um caminho (atalho do módulo e navegação do
   * player): duas chamadas de "próximo" no mesmo toque pulavam a animação do
   * clique seguinte — o slide entrava e a animação dele já rodava junto.
   */
  if (action === "next" || action === "prev") {
    const agora = Date.now();
    if (ultimaNav.action === action && agora - ultimaNav.em < 350) return;
    ultimaNav = { action, em: agora };
  }
  const r = await api.nativeNav(action, index);
  if (r.ok) aoEstadoNativo(r.state);
}

async function encerrarNativo(): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api) return;
  const r = await api.nativeEnd();
  aoEstadoNativo(r.ok ? r.state : { active: false });
  palco.value = null;
  fecharRetornoNativo();
}

/** "Apresentar com o PowerPoint" da janela de importação. */
async function projetarImportadoNativo(): Promise<void> {
  const id = importacao.value?.fileId;
  importacao.value = null;
  await iniciarNativo(files.value.find((f) => f.id === id));
}

/* O painel serve aos dois modos: cada botão vai para quem está no telão. */
function painelIrPara(n: number): void {
  if (nativoAtivo.value) void nativoNav("goto", n - 1);
  else irParaPagina(n);
}
function painelProximo(): void {
  if (nativoAtivo.value) void nativoNav("next");
  else void next();
}
function painelAnterior(): void {
  if (nativoAtivo.value) void nativoNav("prev");
  else void prev();
}
function pararTudo(): void {
  if (nativoAtivo.value) void encerrarNativo();
  else stop();
}

function irParaPagina(n: number): void {
  const total = currentPdfTotalPages.value;
  if (n < 1 || (total > 0 && n > total)) return;
  currentPdfPage.value = n;
  broadcastPdfPage();
}

/** Botão "Instalar fonte…": diálogo nativo (.ttf, .otf ou .zip). */
async function instalarFonteManual(): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api) return;
  await depoisDeInstalar(await api.installFonts());
}

/** Fontes arrastadas para a biblioteca, o painel ou a janela de andamento. */
async function instalarFontesArrastadas(lista: File[]): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  const paths = lista.map((f) => localPathOf(f)).filter((p): p is string => !!p);
  if (!api || !paths.length) {
    $alert.error({ text: tm("pptx.desktop_only"), translate: false });
    return;
  }
  await depoisDeInstalar(await api.installFontPaths(paths));
}

/**
 * Fonte instalada: avisa quais famílias entraram e, se o PowerPoint aberto
 * (no painel ou na janela de andamento) tinha fonte faltando, gera de novo
 * sozinho — o operador arrasta o .zip e já vê o slide certo.
 */
async function depoisDeInstalar(r: PptxFontInstallResult): Promise<void> {
  if (!r.ok) {
    if (r.code !== "canceled") $alert.error({ text: r.message, translate: false });
    return;
  }
  const nomes = (r.families ?? []).join(", ");
  $snackbar.success(
    nomes
      ? tm("pptx.fonts_installed_names", { names: nomes })
      : tm("pptx.fonts_installed_count", { count: r.installed })
  );
  const doDialogo = importacao.value?.phase === "done" ? importacao.value.fileId : undefined;
  const alvo =
    (doDialogo && files.value.find((f) => f.id === doDialogo)) || arquivoNoPalco.value || null;
  if (alvo?.pptx && missingFonts(alvo.pptx.fonts).length) {
    await regerarArquivo(alvo, alvo.id === arquivoNoPalco.value?.id);
  }
}

/** Converte outra vez o .pptx de origem (ex.: depois de instalar uma fonte). */
async function regerarArquivo(file: MediaFile, projetar: boolean): Promise<void> {
  if (!file.pptx?.source || regerando.value) return;
  regerando.value = true;
  try {
    const novo = await importPowerPoint(file.pptx.source, file.name, file.categoryId ?? "", file);
    if (novo && projetar) await tocarDaBiblioteca(novo);
  } finally {
    regerando.value = false;
  }
}

/** "Gerar de novo" do painel. */
async function regerarNoPalco(): Promise<void> {
  if (arquivoNoPalco.value) await regerarArquivo(arquivoNoPalco.value, true);
}

function buildThumbPath(filePath: string): string | undefined {
  if (Platform.isDesktop) {
    return $path.local(filePath);
  }
  return undefined;
}

/**
 * Tipo de arquivo importável a partir do nome e do mime.
 *
 * O mime vem primeiro porque é o que distingue um `.mp4` de vídeo de um
 * `audio/mp4`, e porque o navegador acerta o tipo de `.m4a`/`.opus` mesmo
 * quando a extensão não está na lista. A extensão cobre o caso oposto: sistema
 * que entrega `application/octet-stream` para tudo.
 */
function tipoDoArquivo(name: string, mime?: string): MediaFile["type"] | null {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const tipo = (mime || "").toLowerCase();
  if (tipo.startsWith("image/")) return "image";
  if (tipo.startsWith("video/")) return "video";
  if (tipo.startsWith("audio/")) return "audio";
  if (tipo === "application/pdf") return "pdf";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return null;
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
    const result = await api.storage.chooseFile("media");
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    for (const rawPath of paths) {
      const name = rawPath.split(/[\\/]/).pop() || rawPath;
      if (isPowerPointName(name)) {
        await importPowerPoint(rawPath, name, categoryId);
        continue;
      }
      const fileType = tipoDoArquivo(name);
      if (!fileType) {
        noteUnsupported();
        continue;
      }
      const file: MediaFile = {
        id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name,
        path: rawPath,
        type: fileType,
        addedAt: Date.now(),
        categoryId,
      };
      if (fileType === "image") file.thumb = buildThumbPath(rawPath);
      await saveFile(file);
      files.value.unshift(file);
      if (fileType === "video") generateAndStoreThumb(file);
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
      try {
        await importDroppedEntry(f, catId);
      } catch (error) {
        if (!reportLocalFileFailure(error, [f.name])) throw error;
      }
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
    try {
      const filePath = localPathOf(f);
      if (isPowerPointName(f.name)) {
        await importPowerPoint(filePath, f.name, pendingCategoryId ?? UNCATEGORIZED_ID);
        continue;
      }
      const fileType = tipoDoArquivo(f.name, (f as File).type);
      if (!fileType) {
        noteUnsupported();
        continue;
      }
      if (filePath && !isHeic(f.name, (f as File).type)) {
        const file: MediaFile = {
          id: "file_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
          name: f.name,
          path: filePath,
          type: fileType,
          addedAt: Date.now(),
          categoryId: pendingCategoryId ?? UNCATEGORIZED_ID,
        };
        if (fileType === "image") file.thumb = buildThumbPath(filePath);
        await saveFile(file);
        files.value.unshift(file);
        if (fileType === "video") generateAndStoreThumb(file);
      } else {
        // Sem caminho (web/drag-drop) ou HEIC/HEIF: armazena autocontido. Só
        // IMAGEM é convertida (o Chromium não decodifica HEIC); áudio e vídeo
        // vão como vieram.
        const { blob, name } =
          fileType === "image"
            ? await ensureRenderableImage(f.name, f)
            : { blob: f as Blob, name: f.name };
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
        if (fileType === "image") file.thumb = path;
        createdObjectUrls.set(fileId, path);
        await saveFile(file);
        files.value.unshift(file);
        if (fileType === "video") generateAndStoreThumb(file);
      }
    } catch (error) {
      if (!reportLocalFileFailure(error, [f.name])) throw error;
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
  isPlaying.value = false;
  const saved = $userdata.get<
    { id: string; name: string; path: string; type: MediaFile["type"] }[]
  >(PLAYLIST_KEY, []);
  if (saved?.length) {
    playlist.value = saved.map((item) => {
      const libFile = files.value.find((f) => f.id === item.id);
      return {
        ...item,
        path: libFile?.path || item.path,
        typeIcon: fileTypeIcon(item.type),
      };
    });
  }
}

/**
 * O item de projeção que um arquivo da biblioteca gera.
 *
 * Playlist e clique no card produzem exatamente o mesmo objeto — a diferença é
 * só o que se faz com ele depois (enfileirar, ou mandar para o telão).
 */
function itemDe(file: MediaFile): PlaylistItem {
  return {
    id: file.id,
    name: file.name,
    path: file.path,
    type: file.type,
    typeIcon: fileTypeIcon(file.type),
  };
}

/** Ícone "+": enfileira o arquivo sem projeta-lo. */
function adicionarItem(file: MediaFile): void {
  addToPlaylist(file);
  /*
   * O clique no card deixou de adicionar, então a confirmação é a única coisa
   * que diz que o item entrou na playlist. A chave já existia, sem uso.
   */
  $snackbar.show(tm("added_to_playlist"));
}

function addToPlaylist(file: MediaFile): void {
  playlist.value.push(itemDe(file));
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
  if (Platform.isDesktop) return $path.local(raw);
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

  const bytes = await fetchWithTimeout(raw, { timeout: NET_TIMEOUT.MEDIA, source: "file" }).then(
    (r) => r.blob()
  );
  const jpeg = await heicToJpeg(bytes);
  const url = URL.createObjectURL(jpeg);
  heicProjectionCache.set(item.id, url);
  return url;
}

async function playIndex(index: number): Promise<void> {
  const item = playlist.value[index];
  if (!item) return;
  if (currentIndex.value === index && isPlaying.value) {
    /* Áudio já terminou: o player está parado, e tocar de novo é o esperado.
     * Para imagem/PDF a guarda continua valendo (reprojetar sem motivo pisca). */
    const atual = playlist.value[index];
    if (atual?.type !== "audio" || $appdata.get(KEYS.MODULES.MEDIA.IS_PLAYING) === true) return;
  }
  // Direção da navegação para o modo automático de transição da projeção.
  const backward = index < currentIndex.value;

  currentIndex.value = index;
  isPlaying.value = true;
  /*
   * As setas chegam em `Media.nextSlide()` (registradas uma vez em
   * `main-shell.js`). Quem responde depende do que está no ar: PDF vira página,
   * música anda no deck — e a lista da Biblioteca não é nenhum dos dois, ela
   * toca por `projectFile`. Sem este registro a seta era engolida e nada
   * acontecia. Delegar para o MESMO `next`/`prev` dos botões da barra é o que
   * faz seta e botão obedecerem à mesma regra (inclusive: PDF pagina antes de
   * trocar de item).
   */
  $media.registerNavigationDelegate(_navigationDelegado);
  currentPdfPage.value = 1;
  currentPdfTotalPages.value = 0;
  currentPdfPlaybackId = item.type === "pdf" ? newFileProjectionId() : undefined;
  /* Este item é que vai para o telão: um PDF adotado da aba Canva sai de cena. */
  pdfExterno.value = null;
  avisoContagemDado = false;

  await projetarItem(item, backward);
}

/**
 * Clique no card da biblioteca: projeta o arquivo AVULSO.
 *
 * Não entra na playlist — é a diferença em relação ao clique antigo. Por isso
 * o estado que é da lista volta ao zero: nenhum item tocando (a barra some) e
 * as setas voltam a ser do PDF e do deck de música, porque não há lista para
 * percorrer.
 *
 * `stop()` aqui seria errado: `projectFile` já troca o palco, e parar antes
 * daria um flash com a projeção anterior fechando.
 */
async function tocarDaBiblioteca(file: MediaFile): Promise<void> {
  /*
   * PowerPoint é executado no modo apresentação: a biblioteca adiciona e
   * remove (com as fontes e a conversão); o controle dos slides, a prévia e o
   * modo com animações ficam lá.
   */
  if (file.pptx?.source) {
    openInPresentationMode(file.pptx.source, file.name.replace(/\.[^.]+$/, ""));
    return;
  }
  currentIndex.value = -1;
  isPlaying.value = false;
  $media.unregisterNavigationDelegate();
  currentPdfPage.value = 1;
  currentPdfTotalPages.value = 0;
  currentPdfPlaybackId = file.type === "pdf" ? newFileProjectionId() : undefined;
  pdfExterno.value = null;
  avisoContagemDado = false;

  await projetarItem(itemDe(file), false);
  /*
   * PDF projetado pelo card não está na lista: sem isto nada o considerava
   * "no palco" — a barra com a página não aparecia e o Próximo caía no ramo
   * da playlist (que fecha a projeção). Fica com as mesmas regras do PDF de
   * fora (Canva): última página não fecha nada.
   */
  if (file.type === "pdf" && currentPdfPlaybackId && palco.value?.fileId === file.id) {
    pdfExterno.value = { playback_id: currentPdfPlaybackId, title: file.name };
  }
}

/**
 * Manda um arquivo da biblioteca ou um item da playlist para o telão.
 *
 * Corpo compartilhado: URL (HEIC é convertido antes), payload, o atalho do
 * leitor do sistema para vídeo e o `projectFile` propriamente dito. O
 * `playback_id` do PDF já está em `currentPdfPlaybackId` — quem chama é que
 * define a geração, e o `generation` protege contra uma projeção lenta que
 * perde o posto para a seguinte.
 */
/**
 * URL reproduzível de um áudio da biblioteca.
 *
 * No web o arquivo mora no IndexedDB: um blob NOVO por reprodução, porque o
 * player revoga a URL anterior ao trocar de fonte (`setSrc`). Reusar a URL
 * guardada no registro significaria tocar uma URL já revogada na segunda vez.
 */
function urlDoAudio(item: PlaylistItem): string {
  const file = files.value.find((f) => f.id === item.id);
  if (file?.data && file.mime) {
    return URL.createObjectURL(new Blob([file.data], { type: file.mime }));
  }
  return resolvePath(item.path);
}

/**
 * Leva o áudio da biblioteca ao PLAYER DE MÍDIA, MINIMIZADO.
 *
 * Áudio não tem o que projetar, e `projectFile` só aceita imagem/vídeo/PDF — por
 * isso ele entra pelo `openAudio`, o mesmo caminho que a liturgia usa. O player
 * fica minimizado (a janela não abre) e o telão fica como está
 * (`preserveFileProjection`), salvo se houver um vídeo tocando: aí ele sai,
 * senão os dois sons se sobreporiam.
 */
async function tocarAudio(item: PlaylistItem): Promise<void> {
  const src = urlDoAudio(item);
  if (!src) return;
  await $media.openAudio({
    url: src,
    title: item.name,
    mediaType: "audio",
    minimized: true,
    preserveFileProjection: true,
  });
}

async function projetarItem(item: PlaylistItem, backward: boolean): Promise<void> {
  const generation = ++playIndexGeneration;

  /* Áudio não tem o que projetar: toca no player e o telão fica como está. */
  if (item.type === "audio") {
    await tocarAudio(item);
    return;
  }
  /* Qualquer outra mídia assume o palco: `projectFile` cala o áudio por conta
   * própria (`stopExistingAudio`). */

  /*
   * Item de URL (Canva em modo site): não é arquivo — a projeção é a janela de
   * site, com a mesma exclusão mútua do modo "ao vivo" da aba Canva.
   */
  if (item.type === "site") {
    await $media.close(true);
    await $media.closeProjectionStage();
    await openSiteWindow(item.path, "canva");
    return;
  }

  const url = isHeic(item.name) ? await resolveRenderableUrl(item) : resolvePath(item.path);
  if (generation !== playIndexGeneration) return;
  const isVideo = item.type === "video";

  const payload: Record<string, unknown> = { url, type: item.type, title: item.name };
  payload.backward = backward;
  if (item.type === "pdf") {
    payload.page = 1;
    payload.playback_id = currentPdfPlaybackId;
    palco.value = { url, title: item.name, fileId: item.id };
    painelOculto.value = false;
  } else {
    palco.value = null;
  }
  // A blob URL only exists in the renderer that owns the library. The return
  // projection runs in another window, so give it the IndexedDB reference to
  // recreate the bytes before autoplaying the video there.
  if (item.path.startsWith("blob:")) {
    payload.libRef = { table: DB_TABLE.MEDIA_LIBRARY, id: item.id };
  }

  if (
    isVideo &&
    Boolean($userdata.get(KEYS.OPTIONS.USE_SYSTEM_MEDIA_PLAYER, false)) &&
    Platform.isDesktop &&
    !item.path.startsWith("blob:") &&
    Platform.api?.shell?.openPath
  ) {
    const external = await Platform.api.shell.openPath(item.path);
    if (generation !== playIndexGeneration) return;
    if (external?.ok) {
      Telemetry.track("media_library_external_opened", {
        kind: "video",
        path: external.path || "",
      });
      $media.close(true);
      isPlaying.value = false;
      /* Saiu do ar: as setas voltam a ser do PDF e do deck de música. */
      $media.unregisterNavigationDelegate();
      return;
    }
    Telemetry.track("media_library_external_open_failed", {
      kind: "video",
      reason: external?.error || "unknown",
    });
  }

  const projected = await $media.projectFile(
    payload as Parameters<typeof $media.projectFile>[0],
    isVideo ? url : undefined,
    { stopExistingAudio: true }
  );
  projetandoDaBiblioteca.value = projected === true;
  if (!projected) {
    if (generation === playIndexGeneration) {
      isPlaying.value = false;
      $media.unregisterNavigationDelegate();
    }
  } else if (
    generation === playIndexGeneration &&
    item.type === "pdf" &&
    currentPdfPage.value !== 1
  ) {
    broadcastPdfPage();
  }
}

function broadcastPdfPage(): void {
  if (!currentPdfPlaybackId) return;
  const payload = {
    playback_id: currentPdfPlaybackId,
    page: currentPdfPage.value,
    source: "operator",
  };
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    if (stored) {
      const projection = JSON.parse(stored) as Record<string, unknown>;
      if (projection.playback_id === currentPdfPlaybackId && projection.type === "pdf") {
        localStorage.setItem(
          KEYS.PROJECTION.LJ_FILE_PROJECTION,
          JSON.stringify({ ...projection, page: currentPdfPage.value })
        );
      }
    }
  } catch {
    /* reopen cache is optional */
  }
  $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, payload);
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
  // Modo nativo: seta, controle remoto e faixa de menus vão para o PowerPoint.
  if (nativoAtivo.value) return nativoNav("next");
  if (pdfNoPalco.value) {
    const total = currentPdfTotalPages.value;
    if (total > 0 && currentPdfPage.value >= total) {
      /*
       * O PDF da lista passa para a próxima mídia; o de fora não tem
       * "próxima" — e cair em stop() fecharia a projeção na frente da
       * congregação só porque o operador chegou à última página.
       */
      if (pdfExterno.value) return;
      if (currentIndex.value < playlist.value.length - 1) {
        await playIndex(currentIndex.value + 1);
      } else {
        await stop();
      }
      return;
    }
    currentPdfPage.value++;
    broadcastPdfPage();
    return;
  }
  if (currentIndex.value < playlist.value.length - 1) {
    await playIndex(currentIndex.value + 1);
  } else {
    await stop();
  }
}

async function prev(): Promise<void> {
  if (nativoAtivo.value) return nativoNav("prev");
  if (pdfNoPalco.value) {
    if (currentPdfPage.value <= 1) {
      if (pdfExterno.value) return;
      if (currentIndex.value > 0) {
        await playIndex(currentIndex.value - 1);
      }
      return;
    }
    currentPdfPage.value--;
    broadcastPdfPage();
    return;
  }
  if (currentIndex.value > 0) {
    await playIndex(currentIndex.value - 1);
  }
}

function stop(): void {
  const eraPdfDeFora = !!pdfExterno.value;
  const eraProjecao = projetandoDaBiblioteca.value;
  ++playIndexGeneration;
  /* Áudio toca no player de mídia, não numa janela desta Biblioteca: parar
   * aqui precisa calá-lo explicitamente. */
  $media.stopAudioFile();
  currentPdfPlaybackId = undefined;
  pdfExterno.value = null;
  palco.value = null;
  avisoContagemDado = false;
  isPlaying.value = false;
  currentIndex.value = -1;
  projetandoDaBiblioteca.value = false;
  $media.unregisterNavigationDelegate();
  /*
   * Nada DESTA Biblioteca no telão (o caso de um áudio avulso tocando): parar
   * não pode apagar a projeção que outra coisa deixou lá — um PDF da aba Canva,
   * por exemplo. Antes, o "Parar" da barra do áudio fechava o telão inteiro.
   */
  if (!eraProjecao && !eraPdfDeFora) return;
  localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
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
    case "playlist-changed":
      // O controle remoto mexeu na playlist (add/remove/clear): a lista da
      // tela é estado em memória — recarrega do userData para espelhar.
      loadPlaylist();
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

/*
 * O palco mudou de conteúdo.
 *
 * `projectFile` publica o payload de ARQUIVO para todo mundo, e é aqui que a
 * aba Canva é adotada: o `playback_id` que está no telão vira o
 * `currentPdfPlaybackId` de sempre, e a barra do player, o Próximo/Anterior e
 * a contagem passam a valer para ele sem nenhuma regra paralela.
 *
 * `action: "clear"` vem do `useProjectionShutdown` (janela de projeção fechou)
 * e `MEDIA_CLOSE` do fechamento explícito — são os dois sinais de que o PDF
 * saiu de cena e a barra tem que apagar.
 */
useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION, (payload) => {
  const decisao = adotarProjecaoExterna(payload, currentPdfPlaybackId);

  if (decisao.acao === "limpar") {
    pdfExterno.value = null;
    if (!nativoAtivo.value && !nativoAbrindo.value) palco.value = null;
    avisoContagemDado = false;
    if (decisao.encerrada) currentPdfPlaybackId = undefined;
    return;
  }
  if (decisao.acao === "ignorar") return;

  currentPdfPlaybackId = decisao.playback_id;
  currentPdfPage.value = decisao.page;
  currentPdfTotalPages.value = 0;
  pdfExterno.value = {
    playback_id: decisao.playback_id,
    title: decisao.title,
    declaredPageCount: decisao.declaredPageCount,
  };
  const url = (payload as { url?: unknown } | null)?.url;
  palco.value = typeof url === "string" && url ? { url, title: decisao.title } : null;
  avisoContagemDado = false;
});

useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, () => {
  pdfExterno.value = null;
  if (!nativoAtivo.value && !nativoAbrindo.value) palco.value = null;
  avisoContagemDado = false;
  currentPdfPlaybackId = undefined;
});

/**
 * O dono do arquivo disse quantas páginas tem; o pdf.js disse as que abriu.
 *
 * Divergir significa export incompleto — e é muito melhor descobrir aqui, com
 * o arquivo na tela, do que na hora de virar a página no culto. Aviso único
 * por PDF: a correção é reexportar, não apertar o botão de novo.
 */
function conferirContagem(total: number): void {
  const declarado = pdfExterno.value?.declaredPageCount;
  if (avisoContagemDado || !declarado || declarado === total) return;
  avisoContagemDado = true;
  $snackbar.warning(tm("canva.page_mismatch", { declared: declarado, total }), {
    key: "canva-page-mismatch",
    timeout: 9000,
  });
}

// Recebe page/totalPages da janela de projeção
useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_PAGE, (payload) => {
  const data = fileProjectionPageFor(payload, currentPdfPlaybackId);
  if (!data || data.source !== "projection" || data.totalPages === undefined) return;
  currentPdfTotalPages.value = data.totalPages;
  conferirContagem(data.totalPages);
  if (currentPdfPage.value > data.totalPages) {
    currentPdfPage.value = data.totalPages;
    broadcastPdfPage();
  }
});

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onMounted(async () => {
  const pptxApi = (Platform.api as LouvorjaApi | null)?.pptx;
  if (pptxApi?.onNativeState) {
    pararEscutaNativo = pptxApi.onNativeState(aoEstadoNativo);
    void pptxApi.nativeState().then((st) => {
      if (st?.active) aoEstadoNativo(st);
    });
    void conferirProgramaNativo();
  }
  files.value = await loadLibrary();
  await loadCategories();
  selectAllCategoriesAndUncategorized();
  for (const f of files.value) {
    if (f.path.startsWith("blob:")) {
      if (f.data && f.mime) {
        const url = createObjectUrl(f.id, f.data, f.mime);
        f.path = url;
        if (f.type === "image") f.thumb = url;
      }
      continue;
    }
    /*
     * Só imagem. Para vídeo, "miniatura" era o próprio arquivo: um MP4 no `src`
     * de um `<img>` dá ícone quebrado — e, como o campo ficava preenchido, o
     * vídeo nunca entrava na fila que gera a miniatura de verdade (o importo já
     * gerava e guardava uma de verdade; ao reabrir, ela era sobrescrita aqui).
     *
     * Para imagem a troca de um data URL antigo pelo caminho `louvorja://`
     * continua: é o que impede de embutir a imagem inteira no banco.
     */
    if (Platform.isDesktop && f.type === "image" && f.path.startsWith("/")) {
      if (!f.thumb || !f.thumb.startsWith("louvorja://")) {
        f.thumb = buildThumbPath(f.path);
      }
    }
    if (f.type === "video" && !f.thumb) {
      _filaMiniaturas.push(f);
    }
  }
  void _enfileirarMiniaturas([]);
  loadPlaylist();
});

onBeforeUnmount(() => {
  pararEscutaNativo?.();
  _cancelarFilaMiniaturas();
  for (const url of createdObjectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  createdObjectUrls.clear();
  stop();
});
</script>

<style scoped>
.media-mobile-nav {
  display: flex;
  flex-shrink: 0;
  gap: var(--lj-space-2);
  padding: 0 var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-border);
}

.media-mobile-nav__button {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--lj-space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--lj-text-muted);
  font: inherit;
  font-weight: var(--lj-weight-medium);
}

.media-mobile-nav__button.is-active {
  border-bottom-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
}

.media-mobile-nav__button:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

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

/* Flex porque a grade e o vazio precisam ocupar o restante da altura e rolar;
   como bloco, a grade crescia com o conteúdo e era cortada pelo overflow. */
.media-library {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--lj-space-4);
  gap: var(--lj-space-2);
  min-width: 0;
}

.media-search {
  flex-shrink: 0;
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
  /* Linhas no tamanho do conteúdo: sem isso as linhas são espremidas para
     caber na altura e os cards somem atrás do overflow. */
  grid-auto-rows: max-content;
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
  flex-shrink: 0;
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
  border-radius: var(--lj-radius-pill);
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
  border-radius: var(--lj-radius-pill);
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

@media (max-width: 1000px) {
  .media-root--mobile .media-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: var(--lj-space-2);
    padding: var(--lj-space-2) var(--lj-space-4);
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs) {
    min-width: 0;
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs__list) {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs__trigger) {
    min-height: 40px;
    flex-shrink: 0;
  }

  .media-root--mobile .media-add-button {
    width: 100%;
    min-height: 44px;
  }

  .media-root--mobile .media-library {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  .media-root--mobile .media-chips {
    flex-shrink: 0;
    max-height: 104px;
    overflow-y: auto;
  }

  .media-root--mobile .media-grid {
    min-height: 0;
  }

  .media-root--mobile .media-grid-item {
    padding-inline: var(--lj-space-1);
  }

  .media-root--mobile .media-grid-item-actions {
    position: static;
    justify-content: center;
    gap: var(--lj-space-1);
    width: 100%;
    margin-top: auto;
    background: transparent;
    opacity: 1;
  }

  .media-root--mobile .media-playlist-item-actions {
    opacity: 1;
  }

  .media-root--mobile .media-grid-item-actions :deep(.lj-btn),
  .media-root--mobile .media-playlist-item-actions :deep(.lj-btn) {
    min-width: 44px;
    min-height: 44px;
  }

  .media-root--mobile .media-playlist {
    width: 100%;
    min-width: 0;
    flex: 1 1 auto;
  }

  .media-root--mobile .media-playlist-item {
    min-height: 56px;
  }
}

@media (max-width: 600px) {
  .media-root--mobile .media-search :deep(.lj-input) {
    min-height: 44px;
    font-size: 16px;
  }
}

@media (max-width: 500px) {
  .media-root--mobile .media-toolbar :deep(.lj-tabs__list) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs__trigger) {
    justify-content: center;
    padding-inline: var(--lj-space-2);
    border-bottom: 2px solid transparent;
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs__trigger[data-state="active"]) {
    border-bottom-color: var(--lj-ui-accent);
  }

  .media-root--mobile .media-toolbar :deep(.lj-tabs__indicator) {
    display: none;
  }
}
</style>
