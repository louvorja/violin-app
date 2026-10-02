<template>
  <ModuleContainer :manifest="manifest">
    <template #header>
      <div class="ch-search">
        <LjInput
          ref="searchInput"
          v-model="search"
          clearable
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="searchLabel"
          :aria-label="searchLabel"
          autocomplete="off"
        />
      </div>
    </template>

    <div
      ref="root"
      class="ch-root"
      :class="{ 'ch-root--compact': compactPanel, 'ch-root--narrow': narrowPanel }"
    >
      <h2 v-if="selectedAlbum" class="ch-heading ch-album-heading">
        <LjButton
          v-if="enabledAlbums.length > 1"
          class="ch-album-back"
          :icon="ICONS.UI.ARROW_LEFT"
          :title="tm('back_to_albums')"
          :aria-label="`${tm('back_to_albums')}: ${selectedAlbum.name}`"
          @click="goBack"
        >
          {{ selectedAlbum.name }}
        </LjButton>
        <template v-else>{{ selectedAlbum.name }}</template>
      </h2>
      <h2 v-else class="ch-heading">{{ tm("albums") }}</h2>

      <LjAlert
        v-if="offlineLibrary.active.value"
        variant="info"
        :text="i18nT('shell.offline_albums_only')"
      />
      <LjProgress
        v-if="albumsLoading || musicsLoading"
        indeterminate
        :height="4"
        :label="selectedAlbum ? tm('loading_musics') : tm('loading_albums')"
      />
      <div v-else-if="selectedAlbum ? musicsError : albumsError" class="ch-state">
        <LjAlert variant="danger" :text="selectedAlbum ? tm('detail_error') : tm('load_error')" />
        <LjButton :icon="ICONS.ACTIONS.REFRESH" :aria-label="tm('retry')" @click="retry">
          {{ tm("retry") }}
        </LjButton>
      </div>

      <template v-else-if="selectedAlbum">
        <LjEmpty
          v-if="!filteredMusics.length"
          :icon="q ? ICONS.ACTIONS.SEARCH : ICONS.MUSIC.NOTE"
          :title="tm(q ? 'no_music_results' : 'empty_musics')"
        />
        <LjTable v-else hover class="ch-table">
          <colgroup>
            <col class="ch-col-track" />
            <col />
            <col class="ch-col-duration" />
            <col class="ch-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="ch-track">{{ tm("track") }}</th>
              <th scope="col">{{ tm("music_name") }}</th>
              <th scope="col" class="ch-duration">{{ tm("duration") }}</th>
              <th scope="col" class="ch-action-heading">
                <span class="ch-visually-hidden">{{ tm("actions") }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="music in filteredMusics" :key="music.id_music">
              <td class="ch-track">{{ music.track }}</td>
              <td>
                <span class="ch-music-name">{{ music.name }}</span>
              </td>
              <td class="ch-duration">{{ formatDuration(music.duration) }}</td>
              <td>
                <div class="ch-actions">
                  <MusicMenuTable
                    :id_music="music.id_music"
                    :name="music.name"
                    :album-id="selectedAlbum.id_album"
                    :has_instrumental_music="music.has_instrumental_music"
                    :compact-breakpoint="menuBreakpoint"
                    defer-quick-actions
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </LjTable>
      </template>

      <LjEmpty
        v-else-if="!filteredAlbums.length"
        :icon="q ? ICONS.ACTIONS.SEARCH : ICONS.MUSIC.ALBUM"
        :title="tm(q ? 'no_album_results' : 'empty_albums')"
      />
      <div v-else class="ch-albums">
        <button
          v-for="album in filteredAlbums"
          :key="album.id_album"
          type="button"
          class="ch-album"
          :data-album-id="album.id_album"
          @click="openAlbum(album)"
        >
          <span class="ch-album-cover" aria-hidden="true">
            <img
              v-if="album.coverUrl && !coverFailed.has(album.id_album)"
              :src="album.coverUrl"
              alt=""
              loading="lazy"
              @error="markCoverFailed(album.id_album)"
            />
            <LjIcon v-else :icon="ICONS.MUSIC.ALBUM" :size="28" />
          </span>
          <span class="ch-album-name">{{ album.name }}</span>
          <LjIcon :icon="ICONS.ACTIONS.NEXT" :size="16" class="ch-album-arrow" aria-hidden="true" />
        </button>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useOfflineLibrary } from "@/composables/useOfflineLibrary";
import { LjAlert, LjButton, LjEmpty, LjIcon, LjInput, LjProgress, LjTable } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import { useDisabledAlbums } from "@/composables/useMusicCatalog";
import $database from "@/helpers/Database";
import DateTime from "@/helpers/DateTime";
import Path from "@/helpers/Path";
import { isAlbumEnabled } from "@root/config/musicCatalog.mjs";

interface ChildAlbum {
  id_album: number;
  name: string;
  coverUrl?: string;
}

interface AlbumMusic {
  id_music: number;
  name: string;
  duration?: number;
  track: number;
  has_instrumental_music: boolean;
}

const { t: i18nT, locale } = useI18n();
const offlineLibrary = useOfflineLibrary(() => locale.value);
const tm = (key: string): string => i18nT(`modules.children.${key}`);

const albumsLoading = ref(false);
const musicsLoading = ref(false);
const albumsError = ref(false);
const musicsError = ref(false);
const search = ref("");
const albums = ref<ChildAlbum[]>([]);
const selectedAlbum = ref<ChildAlbum | null>(null);
const musics = ref<AlbumMusic[]>([]);
const coverFailed = ref(new Set<number>());
const root = ref<HTMLElement | null>(null);
const searchInput = ref<{ focus: () => void } | null>(null);
const panelWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;
let albumsRequest = 0;
let musicsRequest = 0;

const disabledAlbums = useDisabledAlbums();
const q = computed(() => search.value.trim().toLocaleLowerCase(locale.value));
const searchLabel = computed(() => tm(selectedAlbum.value ? "search_musics" : "search_albums"));
const enabledAlbums = computed(() =>
  albums.value.filter(
    (album) =>
      isAlbumEnabled(album.id_album, disabledAlbums.value) &&
      offlineLibrary.hasAlbum(album.id_album)
  )
);
const filteredAlbums = computed(() =>
  enabledAlbums.value.filter(
    (album) => !q.value || album.name.toLocaleLowerCase(locale.value).includes(q.value)
  )
);
const filteredMusics = computed(() =>
  musics.value.filter(
    (music) =>
      offlineLibrary.hasMusic(music.id_music) &&
      (!q.value || music.name.toLocaleLowerCase(locale.value).includes(q.value))
  )
);
// MusicMenuTable mede a viewport, mas esta tabela pode ocupar só um painel estreito.
const compactPanel = computed(() => panelWidth.value <= 760);
const narrowPanel = computed(() => panelWidth.value <= 580);
const menuBreakpoint = computed(() => (compactPanel.value ? Number.MAX_SAFE_INTEGER : 550));

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function coverUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return Path.file(value);
  } catch {
    return undefined;
  }
}

function normalizeAlbums(value: unknown): ChildAlbum[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const result: ChildAlbum[] = [];
  for (const item of value) {
    const data = asRecord(item);
    const id = positiveId(data?.id_album);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    result.push({ id_album: id, name, coverUrl: coverUrl(data?.url_image) });
  }
  return value.length && !result.length ? null : result;
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const duration = value.trim();
  if (/^\d+$/.test(duration)) {
    const seconds = Number(duration);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(duration)) return undefined;
  const parts = duration.split(":").map(Number);
  if (parts.length === 2 && parts[1] < 60) {
    const seconds = parts[0] * 60 + parts[1];
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  return undefined;
}

function normalizeMusics(value: unknown, albumId: number): AlbumMusic[] | null {
  const detail = asRecord(value);
  if (!detail || !Array.isArray(detail.musics)) return null;
  if (detail.id_album != null && positiveId(detail.id_album) !== albumId) return null;
  const seen = new Set<number>();
  const result: AlbumMusic[] = [];
  for (const item of detail.musics) {
    const data = asRecord(item);
    const id = positiveId(data?.id_music);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id_music: id,
      name,
      duration: durationSeconds(data?.duration),
      track: positiveId(data?.track) ?? result.length + 1,
      has_instrumental_music:
        data?.has_instrumental_music === true ||
        data?.has_instrumental_music === 1 ||
        data?.has_instrumental_music === "1",
    });
  }
  return detail.musics.length && !result.length ? null : result;
}

function formatDuration(duration: number | undefined): string {
  return duration === undefined ? "" : DateTime.shortTime(duration);
}

function markCoverFailed(id: number): void {
  coverFailed.value.add(id);
}

function openAlbum(album: ChildAlbum, focusSearch = true): void {
  if (!isAlbumEnabled(album.id_album, disabledAlbums.value)) return;
  search.value = "";
  selectedAlbum.value = album;
  void loadMusics(album);
  if (focusSearch) void nextTick(() => searchInput.value?.focus());
}

async function loadMusics(album: ChildAlbum, fresh = false): Promise<void> {
  const request = ++musicsRequest;
  musicsLoading.value = true;
  musicsError.value = false;
  musics.value = [];
  try {
    const value = await $database.get<unknown>(`album_${album.id_album}`, {
      silent: true,
      fresh,
    });
    if (request !== musicsRequest || selectedAlbum.value?.id_album !== album.id_album) return;
    const normalized = normalizeMusics(value, album.id_album);
    if (normalized) musics.value = normalized;
    else musicsError.value = true;
  } catch {
    if (request === musicsRequest) musicsError.value = true;
  } finally {
    if (request === musicsRequest) musicsLoading.value = false;
  }
}

function retryMusics(): void {
  if (selectedAlbum.value) void loadMusics(selectedAlbum.value, true);
}

function retry(): void {
  if (selectedAlbum.value) retryMusics();
  else void loadData(true);
}

function goBack(): void {
  const albumId = selectedAlbum.value?.id_album;
  ++musicsRequest;
  search.value = "";
  selectedAlbum.value = null;
  musics.value = [];
  musicsError.value = false;
  musicsLoading.value = false;
  if (albumId) {
    void nextTick(() =>
      root.value?.querySelector<HTMLButtonElement>(`[data-album-id="${albumId}"]`)?.focus()
    );
  }
}

watch(disabledAlbums, () => {
  if (selectedAlbum.value && !isAlbumEnabled(selectedAlbum.value.id_album, disabledAlbums.value)) {
    if (enabledAlbums.value.length === 1) openAlbum(enabledAlbums.value[0], false);
    else goBack();
  } else if (!selectedAlbum.value && enabledAlbums.value.length === 1) {
    openAlbum(enabledAlbums.value[0], false);
  }
});

async function loadData(fresh = false): Promise<void> {
  const request = ++albumsRequest;
  albumsLoading.value = true;
  albumsError.value = false;
  albums.value = [];
  coverFailed.value = new Set();
  try {
    const value = await $database.get<unknown>(`${locale.value}_children_albums`, {
      silent: true,
      fresh,
    });
    if (request !== albumsRequest) return;
    const normalized = normalizeAlbums(value);
    if (normalized) {
      albums.value = normalized;
      if (enabledAlbums.value.length === 1) openAlbum(enabledAlbums.value[0], false);
    } else {
      albumsError.value = true;
    }
  } catch {
    if (request === albumsRequest) albumsError.value = true;
  } finally {
    if (request === albumsRequest) albumsLoading.value = false;
  }
}

watch(
  root,
  (element) => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    panelWidth.value = element.getBoundingClientRect().width;
    resizeObserver = new ResizeObserver(([entry]) => {
      // A largura externa é estável mesmo quando o padding muda no modo estreito.
      panelWidth.value = entry.target.getBoundingClientRect().width;
    });
    resizeObserver.observe(element);
  },
  { flush: "post" }
);

onMounted(() => {
  void loadData();
});

watch(locale, () => {
  goBack();
  void loadData();
});

onBeforeUnmount(() => {
  ++albumsRequest;
  ++musicsRequest;
  resizeObserver?.disconnect();
});
</script>

<style scoped>
.ch-search {
  width: 100%;
  min-width: 0;
}

.ch-search :deep(.lj-input) {
  width: min(100%, 360px);
}

.ch-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
  width: 100%;
  min-width: 0;
  padding: var(--lj-space-6);
}

.ch-heading {
  margin: 0;
  min-width: 0;
  color: var(--lj-text);
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-semibold);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.ch-album-heading {
  max-width: 100%;
}

.ch-album-back {
  max-width: 100%;
  height: auto;
  min-height: var(--lj-ui-h-md);
  padding-block: var(--lj-space-2);
  justify-content: flex-start;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: left;
  white-space: normal;
}

.ch-album-back :deep(.lj-btn__label) {
  min-width: 0;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}

.ch-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-4);
}

.ch-albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
  gap: var(--lj-space-4);
}

.ch-album {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  min-width: 0;
  min-height: 88px;
  padding: var(--lj-space-4);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-family: inherit;
  text-align: left;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.ch-album:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-ui-accent);
}

.ch-album:focus-visible {
  outline: none;
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.ch-album-cover {
  display: grid;
  flex: 0 0 70px;
  width: 70px;
  height: 70px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
}

.ch-album-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ch-album-name {
  flex: 1;
  min-width: 0;
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.ch-album-arrow {
  flex-shrink: 0;
  color: var(--lj-text-subtle);
}

.ch-table :deep(.lj-table__table) {
  table-layout: fixed;
}

.ch-col-track {
  width: 52px;
}

.ch-col-duration {
  width: 82px;
}

.ch-col-actions {
  width: 260px;
}

.ch-root--compact .ch-col-actions {
  width: 44px;
}

.ch-track,
.ch-duration {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ch-duration {
  color: var(--lj-text-muted);
}

.ch-music-name {
  color: var(--lj-text);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.ch-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.ch-action-heading {
  text-align: right;
}

.ch-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ch-root--narrow {
  padding: var(--lj-space-5);
}

.ch-root--narrow .ch-col-track,
.ch-root--narrow .ch-track,
.ch-root--narrow .ch-col-duration,
.ch-root--narrow .ch-duration {
  display: none;
}
</style>
