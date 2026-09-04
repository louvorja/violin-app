<template>
  <LjDialog
    :model-value="model"
    :title="$t('startup_check.title')"
    :icon="ICONS.UI.SYNC"
    size="md"
    @update:model-value="onDialogModel"
  >
    <!-- Verificando -->
    <div v-if="view === 'scanning'" class="sc-scanning">
      <LjSpinner :size="48" class="sc-scanning__spinner" />
      <span class="sc-scanning__label">{{ $t("startup_check.scanning") }}</span>
      <span v-if="sync.scanProgress.value.total > 0" class="sc-scanning__count">
        {{ sync.scanProgress.value.done }} / {{ sync.scanProgress.value.total }}
      </span>
    </div>

    <!-- Resumo -->
    <div v-else-if="view === 'summary'" class="sc-summary">
      <!-- Conexão -->
      <div class="sc-conn">
        <LjSpinner v-if="sync.ftpChecking.value" :size="20" class="sc-conn__spinner" />
        <Icon
          v-else
          :icon="sync.ftpOk.value ? ICONS.UI.WIFI : ICONS.UI.WIFI_OFF"
          :size="20"
          :class="sync.ftpOk.value ? 'sc-conn__icon--ok' : 'sc-conn__icon--off'"
        />
        <div class="sc-conn__body">
          <div class="sc-conn__title">{{ $t("startup_check.connection_status") }}</div>
          <div class="sc-conn__detail">{{ ftpLabel }}</div>
        </div>
        <LjChip size="sm" :variant="ftpChipVariant">{{ ftpLabel }}</LjChip>
      </div>

      <!-- Aviso de servidor indisponível -->
      <LjAlert
        v-if="!sync.ftpChecking.value && !sync.ftpOk.value"
        variant="warning"
        :icon="ICONS.UI.INFORMATION_OUTLINE"
        :text="$t('startup_check.offline_hint')"
      />

      <!-- Coletâneas: categorias com álbuns -->
      <LjCard
        soft
        :icon="ICONS.MEDIA.AUDIO"
        :title="$t('startup_check.collections_status')"
        class="sc-panel"
      >
        <template #actions>
          <LjChip size="sm" variant="primary">
            {{ scanData.cachedAlbums.size }}/{{ scanData.albumsTotal }}
          </LjChip>
        </template>

        <div class="sc-list">
          <div v-for="cat in scanData.categories" :key="cat.id_category">
            <button
              type="button"
              class="sc-cat"
              :class="{ 'sc-cat--open': expandedCategory === cat.id_category }"
              :aria-expanded="expandedCategory === cat.id_category"
              @click="toggleExpandedCategory(cat.id_category)"
            >
              <Icon
                :icon="
                  expandedCategory === cat.id_category
                    ? ICONS.UI.CHEVRON_DOWN
                    : ICONS.UI.CHEVRON_RIGHT
                "
                :size="16"
                class="sc-cat__chevron"
              />
              <span class="sc-cat__name">{{ cat.name }}</span>
              <LjChip size="sm" class="sc-item__chip">{{ categoryCount(cat) }}</LjChip>
            </button>

            <div v-if="expandedCategory === cat.id_category" class="sc-sublist">
              <div v-for="album in cat.albums || []" :key="album.id_album" class="sc-item">
                <Icon
                  :icon="
                    scanData.cachedAlbums.has(album.id_album)
                      ? ICONS.UI.CHECK_CIRCLE
                      : ICONS.UI.CIRCLE_OUTLINE
                  "
                  :size="16"
                  class="sc-item__mark"
                  :class="{ 'sc-item__mark--ok': scanData.cachedAlbums.has(album.id_album) }"
                />
                <span class="sc-item__name">{{ albumLabel(album) }}</span>
              </div>
            </div>
          </div>

          <!-- Hinário -->
          <div class="sc-item">
            <Icon
              :icon="scanData.hymnalCached ? ICONS.UI.CHECK_CIRCLE : ICONS.UI.CIRCLE_OUTLINE"
              :size="16"
              class="sc-item__mark"
              :class="{ 'sc-item__mark--ok': scanData.hymnalCached }"
            />
            <span class="sc-item__name">{{ hymnalLabel }}</span>
            <LjChip
              size="sm"
              :variant="scanData.hymnalCached ? 'success' : 'neutral'"
              class="sc-item__chip"
            >
              {{
                scanData.hymnalCached
                  ? $t("startup_check.hymnal_downloaded")
                  : $t("startup_check.hymnal_missing")
              }}
            </LjChip>
          </div>
        </div>
      </LjCard>

      <LjDivider class="sc-rule" />

      <!-- Versões da Bíblia -->
      <LjCard
        soft
        :icon="ICONS.BIBLE.BIBLE"
        :title="$t('startup_check.bible_status')"
        class="sc-panel"
      >
        <template #actions>
          <LjChip size="sm" variant="primary">
            {{ scanData.downloadedBibles.length }}/{{ scanData.bibleVersions.length }}
          </LjChip>
        </template>

        <div class="sc-list">
          <div v-for="ver in scanData.bibleVersions" :key="ver.id_bible_version" class="sc-item">
            <Icon
              :icon="
                scanData.downloadedBibles.includes(ver.id_bible_version)
                  ? ICONS.UI.CHECK_CIRCLE
                  : ICONS.UI.CIRCLE_OUTLINE
              "
              :size="16"
              class="sc-item__mark"
              :class="{
                'sc-item__mark--ok': scanData.downloadedBibles.includes(ver.id_bible_version),
              }"
            />
            <span class="sc-item__name">{{ bibleLabel(ver) }}</span>
            <LjChip
              v-if="scanData.downloadedBibles.includes(ver.id_bible_version)"
              size="sm"
              variant="success"
              class="sc-item__chip"
            >
              {{ $t("startup_check.hymnal_downloaded") }}
            </LjChip>
          </div>
        </div>
      </LjCard>

      <LjAlert :text="$t('startup_check.sync_hint')" />
    </div>

    <!-- Seleção de arquivos -->
    <div v-else-if="view === 'details'" class="sc-details">
      <header class="sc-section-head">
        <Icon :icon="ICONS.MEDIA.DISC" :size="18" class="sc-section-head__icon" />
        <span class="sc-section-head__title">
          {{ $t("options.collections_download.title") }}
        </span>
      </header>

      <div v-for="cat in scanData.categories" :key="cat.id_category" class="sc-group">
        <LjCheckbox
          :model-value="isCategoryFullySelected(cat)"
          :indeterminate="isCategoryPartiallySelected(cat)"
          :label="cat.name"
          @update:model-value="toggleCategory(cat, $event)"
        />
        <div class="sc-group__items">
          <LjCheckbox
            v-for="album in cat.albums || []"
            :key="album.id_album"
            :model-value="selectedAlbums.includes(album.id_album)"
            :label="albumLabel(album)"
            @update:model-value="toggleAlbum(album.id_album, $event)"
          />
        </div>
      </div>

      <div v-if="scanData.hymnalIds.length" class="sc-group">
        <LjCheckbox v-model="selectedHymnal" :label="hymnalLabel" />
      </div>

      <LjDivider class="sc-details__rule" />

      <header class="sc-section-head">
        <Icon :icon="ICONS.BIBLE.BOOK_BIBLE" :size="18" class="sc-section-head__icon" />
        <span class="sc-section-head__title">{{ $t("options.bible_download.title") }}</span>
      </header>

      <div class="sc-group">
        <LjCheckbox
          v-for="ver in scanData.bibleVersions"
          :key="ver.id_bible_version"
          :model-value="selectedBibles.includes(ver.id_bible_version)"
          :label="bibleLabel(ver)"
          @update:model-value="toggleBible(ver.id_bible_version, $event)"
        />
      </div>
    </div>

    <!-- Baixando -->
    <div v-else class="sc-download">
      <section v-if="sync.downloading.value" class="sc-progress">
        <header class="sc-section-head">
          <Icon :icon="ICONS.MEDIA.DISC" :size="18" class="sc-section-head__icon" />
          <span class="sc-section-head__title">
            {{ $t("options.collections_download.title") }}
          </span>
        </header>
        <LjProgress :value="downloadPercent" :height="8" />
        <div class="sc-progress__row">
          <span>
            {{
              $t("options.collections_download.progress", {
                done: sync.downloadProgress.value.done,
                total: sync.downloadProgress.value.total,
                percent: downloadPercent,
              })
            }}
          </span>
          <span class="sc-progress__file lj-u-truncate">
            {{ sync.downloadProgress.value.currentFile }}
          </span>
        </div>
      </section>

      <section v-if="sync.bibleDownloading.value" class="sc-progress">
        <header class="sc-section-head">
          <Icon :icon="ICONS.BIBLE.BOOK_BIBLE" :size="18" class="sc-section-head__icon" />
          <span class="sc-section-head__title">{{ $t("options.bible_download.title") }}</span>
        </header>
        <LjProgress :value="biblePercent" :height="8" />
        <div class="sc-progress__row">
          <span>
            {{
              $t("options.bible_download.downloading", {
                done: sync.bibleProgress.value.done,
                total: sync.bibleProgress.value.total,
              })
            }}
          </span>
          <span class="sc-progress__file lj-u-truncate">
            {{
              formatBibleDownloadDetail(
                sync.bibleProgress.value.currentFile,
                undefined,
                scanData.bibleVersions
              )
            }}
          </span>
        </div>
      </section>

      <div v-if="!isBusy" class="sc-done">
        <Icon :icon="ICONS.UI.CHECK_CIRCLE" :size="48" class="sc-done__icon" />
        <div class="sc-done__title">{{ $t("options.collections_download.completed") }}</div>
        <div v-if="sync.downloadCompletedMsg.value" class="sc-done__detail">
          {{ sync.downloadCompletedMsg.value }}
        </div>
        <div v-if="sync.bibleCompletedMsg.value" class="sc-done__detail">
          {{ sync.bibleCompletedMsg.value }}
        </div>
      </div>
    </div>

    <!-- Ações — a etapa de verificação não tem rodapé -->
    <template v-if="view !== 'scanning'" #footer>
      <template v-if="view === 'summary'">
        <div class="sc-footer__left">
          <DontShowAgainCheckbox
            :storage-key="KEYS.OPTIONS.SKIP_STARTUP_CHECK"
            :label="$t('startup_check.hide_on_login')"
          />
        </div>
        <LjButton size="sm" variant="ghost" @click="onClose">
          {{ $t("actions.close") }}
        </LjButton>
        <LjButton
          size="sm"
          :icon="ICONS.ACTIONS.SELECT_MULTIPLE"
          :disabled="!canDownload"
          @click="view = 'details'"
        >
          {{ $t("startup_check.select_files") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="primary"
          :icon="ICONS.ACTIONS.DOWNLOAD"
          :disabled="!canDownload"
          @click="downloadAll"
        >
          {{ $t("startup_check.download_all") }}
        </LjButton>
      </template>

      <template v-else-if="view === 'details'">
        <LjButton
          size="sm"
          class="sc-footer__left"
          :icon="ICONS.UI.ARROW_LEFT"
          @click="view = 'summary'"
        >
          {{ $t("actions.back") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="primary"
          :icon="ICONS.ACTIONS.DOWNLOAD"
          :disabled="!canDownload"
          @click="downloadSelected"
        >
          {{ $t("options.collections_download.start") }}
        </LjButton>
      </template>

      <template v-else>
        <LjButton
          v-if="isBusy"
          size="sm"
          variant="ghost"
          class="sc-footer__left"
          :icon="ICONS.UI.WINDOW_MINIMIZE"
          @click="minimizeToBackground"
        >
          {{ $t("startup_check.minimize") }}
        </LjButton>
        <LjButton v-if="!isBusy" size="sm" :icon="ICONS.UI.CHECK" @click="onClose">
          {{ $t("actions.close") }}
        </LjButton>
        <LjButton
          v-else
          size="sm"
          variant="danger"
          :icon="ICONS.PLAYER.STOP"
          @click="sync.cancelDownloads()"
        >
          {{ $t("options.collections_download.cancel") }}
        </LjButton>
      </template>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useSyncManager } from "@/composables/useSyncManager";
import type { BibleVersion } from "@/types/Bible";
import { ICONS } from "@/config/Icons";
import Icon from "@/components/Icon.vue";
import DontShowAgainCheckbox from "@/components/inputs/DontShowAgainCheckbox.vue";
import {
  LjAlert,
  LjButton,
  LjCard,
  LjCheckbox,
  LjChip,
  LjDialog,
  LjDivider,
  LjProgress,
  LjSpinner,
} from "@/components/ui";
import { formatBibleDownloadDetail } from "@/helpers/BackgroundTaskDetail";

interface Album {
  id_album: number;
  name: string;
  subtitle?: string;
}

interface Category {
  id_category: number;
  name: string;
  albums?: Album[];
}

interface ScanData {
  categories: Category[];
  hymnalIds: number[];
  cachedAlbums: Set<number>;
  hymnalCached: boolean;
  bibleVersions: BibleVersion[];
  downloadedBibles: number[];
  albumsTotal: number;
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();

const { t } = useI18n();

const model = ref(props.modelValue);
const view = ref<"scanning" | "summary" | "details" | "downloading">("scanning");
const selectedAlbums = ref<number[]>([]);
const selectedHymnal = ref(false);
const selectedBibles = ref<number[]>([]);
const expandedCategory = ref<number | null>(null);
const scanData = ref<ScanData>({
  categories: [],
  hymnalIds: [],
  cachedAlbums: new Set(),
  hymnalCached: false,
  bibleVersions: [],
  downloadedBibles: [],
  albumsTotal: 0,
});

const sync = useSyncManager();

const canDownload = computed(() => sync.ftpOk.value && !sync.ftpChecking.value);

/** Há transferência em andamento (coletâneas ou bíblia). */
const isBusy = computed(() => sync.downloading.value || sync.bibleDownloading.value);

const ftpLabel = computed(() =>
  sync.ftpChecking.value
    ? t("options.collections_download.checking")
    : sync.ftpOk.value
      ? t("options.collections_download.connected")
      : t("options.collections_download.disconnected")
);

const ftpChipVariant = computed<"neutral" | "success" | "danger">(() =>
  sync.ftpChecking.value ? "neutral" : sync.ftpOk.value ? "success" : "danger"
);

const hymnalLabel = computed(
  () =>
    `${t("options.collections_download.hymnal")} (${scanData.value.hymnalIds.length} ` +
    `${t("options.collections_download.songs")})`
);

const downloadPercent = computed(() => {
  const total = sync.downloadProgress.value.total;
  if (total <= 0) return 0;
  const processed = sync.downloadProgress.value.done + sync.downloadProgress.value.failed;
  return Math.round((processed / total) * 100);
});

const biblePercent = computed(() => {
  const total = sync.bibleProgress.value.total;
  if (total <= 0) return 0;
  return Math.round((sync.bibleProgress.value.done / total) * 100);
});

watch(
  () => props.modelValue,
  (v) => {
    model.value = v;
    if (v) {
      view.value = "scanning";
      startScan();
    }
  }
);

function albumLabel(album: Album): string {
  return album.name + (album.subtitle ? " · " + album.subtitle : "");
}

function bibleLabel(ver: BibleVersion): string {
  return ver.name + (ver.abbreviation ? " (" + ver.abbreviation + ")" : "");
}

/** "baixados/total" de uma categoria, como mostrado no resumo. */
function categoryCount(cat: Category): string {
  const cached = cat.albums?.filter((a) => scanData.value.cachedAlbums.has(a.id_album)).length || 0;
  return `${cached}/${cat.albums?.length || 0}`;
}

function toggleExpandedCategory(id: number): void {
  expandedCategory.value = expandedCategory.value === id ? null : id;
}

function onClose(): void {
  emit("update:modelValue", false);
}

/** Fechamento vindo do próprio diálogo (clique fora / ESC). */
function onDialogModel(v: boolean): void {
  model.value = v;
  if (!v) onClose();
}

function minimizeToBackground(): void {
  emit("update:modelValue", false);
}

async function startScan(): Promise<void> {
  const lang = $userdata.get(KEYS.OPTIONS.LANGUAGE, "pt") || "pt";

  view.value = "scanning";
  const result = await sync.runScan(lang);

  const total = result.categories.reduce(
    (sum: number, cat: any) => sum + (cat.albums?.length || 0),
    0
  );

  scanData.value = {
    categories: result.categories,
    hymnalIds: result.hymnalIds,
    cachedAlbums: result.cachedAlbums,
    hymnalCached: result.hymnalCached,
    bibleVersions: result.bibleVersions,
    downloadedBibles: result.downloadedBibles,
    albumsTotal: total,
  };

  selectedAlbums.value = [...result.cachedAlbums];
  selectedHymnal.value = result.hymnalCached;
  selectedBibles.value = result.downloadedBibles;

  view.value = "summary";

  sync.checkFtp();
}

function isCategoryFullySelected(cat: Category): boolean {
  if (!cat.albums?.length) return false;
  return cat.albums.every((a) => selectedAlbums.value.includes(a.id_album));
}

function isCategoryPartiallySelected(cat: Category): boolean {
  if (!cat.albums?.length) return false;
  const sel = cat.albums.filter((a) => selectedAlbums.value.includes(a.id_album)).length;
  return sel > 0 && sel < cat.albums.length;
}

function toggleCategory(cat: Category, checked: boolean): void {
  if (!cat.albums) return;
  if (checked) {
    const set = new Set(selectedAlbums.value);
    cat.albums.forEach((a) => set.add(a.id_album));
    selectedAlbums.value = [...set];
  } else {
    const set = new Set(selectedAlbums.value);
    cat.albums.forEach((a) => set.delete(a.id_album));
    selectedAlbums.value = [...set];
  }
}

// O catálogo de primitivos não tem checkbox de valor múltiplo (o `v-model` em
// array do Vuetify): a lista continua sendo a fonte da verdade e cada caixa
// entra/sai dela por id.
function toggleAlbum(id: number, checked: boolean): void {
  const set = new Set(selectedAlbums.value);
  if (checked) set.add(id);
  else set.delete(id);
  selectedAlbums.value = [...set];
}

function toggleBible(id: number, checked: boolean): void {
  const set = new Set(selectedBibles.value);
  if (checked) set.add(id);
  else set.delete(id);
  selectedBibles.value = [...set];
}

/** Filtra álbuns desativados pelo usuário (não devem ser baixados). */
function activeAlbumIds(ids: number[]): number[] {
  const disabled = $userdata.get<number[]>(KEYS.OPTIONS.DISABLED_ALBUMS, []) || [];
  if (!disabled.length) return ids;
  return ids.filter((id) => !disabled.includes(Number(id)));
}

async function downloadAll(): Promise<void> {
  view.value = "downloading";

  const allAlbums = new Set<number>();
  scanData.value.categories.forEach((cat) => cat.albums?.forEach((a) => allAlbums.add(a.id_album)));
  const allHymnal = scanData.value.hymnalIds.length > 0;
  const allBibles = scanData.value.bibleVersions.map((v) => v.id_bible_version);

  await performDownload(new Set(activeAlbumIds([...allAlbums])), allHymnal, allBibles);
}

async function downloadSelected(): Promise<void> {
  view.value = "downloading";
  await performDownload(new Set(activeAlbumIds(selectedAlbums.value)), selectedHymnal.value, [
    ...selectedBibles.value,
  ]);
}

async function performDownload(
  albums: Set<number>,
  hymnal: boolean,
  bibles: number[]
): Promise<void> {
  selectedAlbums.value = [...albums];
  selectedHymnal.value = hymnal;
  selectedBibles.value = bibles;

  try {
    const files = await sync.collectFiles(albums, hymnal, scanData.value.hymnalIds, false, []);

    if (files.length > 0) {
      await sync.startDownloads(files);
      await sync.waitForDownloadQueue();
    }

    if (bibles.length > 0) {
      const lang = $userdata.get(KEYS.OPTIONS.LANGUAGE, "pt") || "pt";
      await sync.downloadBibleVersions(bibles, scanData.value.bibleVersions, lang);
    }

    if (files.length === 0 && bibles.length === 0) {
      sync.downloadCompletedMsg.value = t("options.collections_download.no_files");
    }
  } catch (e) {
    console.error("[StartupCheck] download:", e);
    sync.downloadCompletedMsg.value =
      (e as Error).message || t("options.collections_download.collect_failed");
  }

  view.value = "summary";
}

onMounted(() => {
  if (model.value) {
    view.value = "scanning";
    startScan();
  }
});
</script>

<style scoped>
/* ── Verificando ─────────────────────────────────────────── */
.sc-scanning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-6);
  padding: var(--lj-space-7) 0;
}

.sc-scanning__spinner {
  color: var(--lj-ui-accent-text);
}

.sc-scanning__label {
  font-size: var(--lj-text-lg);
}

.sc-scanning__count {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Resumo ──────────────────────────────────────────────── */
.sc-summary {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.sc-conn {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-5);
  background: var(--lj-ui-accent-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.sc-conn__spinner {
  color: var(--lj-ui-accent-text);
}

.sc-conn__icon--ok {
  color: var(--lj-success);
}

.sc-conn__icon--off {
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.sc-conn__body {
  flex: 1;
  min-width: 0;
}

.sc-conn__title {
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.sc-conn__detail {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

/* O ícone do LjCard nasce esmaecido; aqui ele identifica a seção (coletâneas
   ou bíblia), então recebe o acento. O corpo do cartão vive dentro do próprio
   primitivo — daí o :deep(), que o `scoped` do consumidor não alcança. */
.sc-panel :deep(.lj-card__icon) {
  color: var(--lj-ui-accent-text);
}

.sc-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
}

/* Cabeçalho de categoria: era uma <div> com @click, virou botão — o teclado
   passa a abrir e fechar a lista de álbuns como o mouse já fazia. */
.sc-cat {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-3);
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sc-cat:hover {
  background: var(--lj-surface-bg-hover);
}

.sc-cat--open {
  background: var(--lj-surface-bg);
}

.sc-cat:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.sc-cat__chevron {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.sc-cat__name {
  flex: 1;
  min-width: 0;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-sublist {
  display: flex;
  flex-direction: column;
  padding-left: var(--lj-space-8);
}

.sc-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-3);
}

.sc-item__mark {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.sc-item__mark--ok {
  color: var(--lj-success);
}

.sc-item__name {
  flex: 1;
  min-width: 0;
  font-size: var(--lj-text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-item__chip {
  flex-shrink: 0;
}

/* Régua de acento entre coletâneas e bíblia. A classe vem repetida no seletor
   para vencer o `.lj-divider` do próprio primitivo sem depender da ordem em
   que as folhas de estilo são injetadas. */
.sc-rule.sc-rule {
  height: 3px;
  background: var(--lj-ui-accent);
  opacity: 0.75;
}

/* ── Seleção de arquivos ─────────────────────────────────── */
.sc-details {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.sc-section-head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.sc-section-head__icon {
  color: var(--lj-ui-accent-text);
}

.sc-section-head__title {
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

/* LjCheckbox é inline-flex: sem uma coluna explícita as caixas se enfileiram. */
.sc-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-2);
}

.sc-group__items {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-2);
  padding-left: var(--lj-space-8);
}

/* Classe repetida pelo mesmo motivo de `.sc-rule`: o primitivo zera a margem
   com um seletor de mesma especificidade. */
.sc-details__rule.sc-details__rule {
  margin-block: var(--lj-space-3);
}

/* ── Baixando ────────────────────────────────────────────── */
.sc-download {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-7);
}

.sc-progress {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.sc-progress__row {
  display: flex;
  justify-content: space-between;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.sc-progress__file {
  max-width: 200px;
}

.sc-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-6) 0;
  text-align: center;
}

.sc-done__icon {
  color: var(--lj-success);
}

.sc-done__title {
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
}

.sc-done__detail {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

/* Mantém a caixa "não exibir" (e o Voltar/Minimizar) à esquerda do rodapé. */
.sc-footer__left {
  margin-right: auto;
  min-width: 0;
}
</style>
