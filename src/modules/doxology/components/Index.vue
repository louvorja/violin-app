<template>
  <ModuleContainer :manifest="manifest">
    <template #header>
      <div class="dx-toolbar">
        <LjInput
          ref="searchInput"
          v-model="search"
          clearable
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="selectedAlbum ? tm('search_musics') : tm('search_albums')"
          :aria-label="selectedAlbum ? tm('search_musics') : tm('search_albums')"
          autocomplete="off"
        />
      </div>
    </template>

    <div ref="pageEl" class="dx-page" :class="{ 'dx-page--narrow': narrowPanel }">
      <h2 v-if="selectedAlbum" class="dx-heading dx-album-heading">
        <LjButton
          class="dx-album-back"
          :icon="ICONS.UI.ARROW_LEFT"
          :title="tm('back_to_albums')"
          :aria-label="`${tm('back_to_albums')}: ${selectedAlbum.name}`"
          @click="goBack"
        >
          {{ selectedAlbum.name }}
        </LjButton>
      </h2>
      <h2 v-else class="dx-heading">{{ tm("albums") }}</h2>

      <LjAlert
        v-if="offlineLibrary.active.value"
        variant="info"
        :text="i18nT('shell.offline_albums_only')"
      />
      <LjProgress
        v-if="loading"
        indeterminate
        :height="4"
        :label="selectedAlbum ? tm('loading_musics') : tm('loading_albums')"
      />
      <div v-else-if="error" class="dx-state">
        <LjAlert variant="danger" :text="error" />
        <LjButton :icon="ICONS.ACTIONS.REFRESH" @click="retry">{{ tm("retry") }}</LjButton>
      </div>

      <template v-else-if="selectedAlbum">
        <LjEmpty
          v-if="!filteredMusics.length"
          :icon="query ? ICONS.ACTIONS.SEARCH : ICONS.MUSIC.NOTE"
          :title="query ? tm('no_music_matches') : tm('empty_musics')"
        />
        <LjTable v-else hover class="dx-tracks" :class="{ 'dx-tracks--compact': compactActions }">
          <colgroup>
            <col class="dx-col-track" />
            <col />
            <col class="dx-col-duration" />
            <col class="dx-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="dx-track-number">{{ tm("track") }}</th>
              <th scope="col">{{ tm("music_name") }}</th>
              <th scope="col" class="dx-duration">{{ tm("duration") }}</th>
              <th scope="col">
                <span class="dx-visually-hidden">{{ tm("actions") }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="music in filteredMusics" :key="music.id_music">
              <td class="dx-track-number">{{ music.track }}</td>
              <td>
                <span class="dx-music-name">{{ music.name }}</span>
              </td>
              <td class="dx-duration">{{ formatDuration(music.duration) }}</td>
              <td>
                <div class="dx-actions">
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

      <template v-else>
        <LjEmpty
          v-if="!filteredAlbums.length"
          :icon="query ? ICONS.ACTIONS.SEARCH : ICONS.MUSIC.ALBUM"
          :title="query ? tm('no_album_matches') : tm('empty_albums')"
        />
        <div v-else class="dx-albums">
          <button
            v-for="album in filteredAlbums"
            :key="album.id_album"
            type="button"
            class="dx-album"
            :data-album-id="album.id_album"
            @click="openAlbum(album)"
          >
            <span class="dx-cover" aria-hidden="true">
              <img
                v-if="album.coverUrl && !coverFailed.has(album.id_album)"
                :src="album.coverUrl"
                alt=""
                loading="lazy"
                @error="coverFailed.add(album.id_album)"
              />
              <LjIcon v-else :icon="ICONS.MUSIC.ALBUM" :size="28" />
            </span>
            <span class="dx-album__name">{{ album.name }}</span>
            <LjIcon
              :icon="ICONS.ACTIONS.NEXT"
              :size="16"
              class="dx-album__arrow"
              aria-hidden="true"
            />
          </button>
        </div>
      </template>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useOfflineLibrary } from "@/composables/useOfflineLibrary";
import { LjAlert, LjButton, LjEmpty, LjIcon, LjInput, LjProgress, LjTable } from "@/components/ui";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import { useDisabledAlbums } from "@/composables/useMusicCatalog";
import { ICONS } from "@/config/Icons";
import DateTime from "@/helpers/DateTime";
import $database from "@/helpers/Database";
import Path from "@/helpers/Path";
import { isAlbumEnabled } from "@root/config/musicCatalog.mjs";
import { module as manifest } from "../manifest";

interface DoxAlbum {
  id_album: number;
  name: string;
  coverUrl: string;
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
const tm = (key: string): string => i18nT(`modules.doxology.${key}`);

const pageEl = ref<HTMLElement | null>(null);
const searchInput = ref<{ focus: () => void } | null>(null);
const panelWidth = ref(0);
const compactActions = computed(() => panelWidth.value <= 760);
const narrowPanel = computed(() => panelWidth.value <= 580);
const menuBreakpoint = computed(() => (compactActions.value ? Number.MAX_SAFE_INTEGER : 550));
let pageResizeObserver: ResizeObserver | null = null;
let requestRevision = 0;

const loading = ref(false);
const error = ref<string | null>(null);
const search = ref("");
const albums = ref<DoxAlbum[]>([]);
const selectedAlbum = ref<DoxAlbum | null>(null);
const musics = ref<AlbumMusic[]>([]);
const coverFailed = ref(new Set<number>());
const disabledAlbums = useDisabledAlbums();

const query = computed(() => search.value.trim().toLocaleLowerCase(locale.value));
const filteredAlbums = computed(() =>
  albums.value.filter(
    (album) =>
      isAlbumEnabled(album.id_album, disabledAlbums.value) &&
      offlineLibrary.hasAlbum(album.id_album) &&
      (!query.value || album.name.toLocaleLowerCase(locale.value).includes(query.value))
  )
);
const filteredMusics = computed(() =>
  musics.value.filter(
    (music) =>
      offlineLibrary.hasMusic(music.id_music) &&
      (!query.value || music.name.toLocaleLowerCase(locale.value).includes(query.value))
  )
);

function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
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

function coverUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return Path.file(value);
  } catch {
    return "";
  }
}

function parseAlbums(value: unknown): DoxAlbum[] | null {
  if (!Array.isArray(value)) return null;
  const unique = new Map<number, DoxAlbum>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const album = item as Record<string, unknown>;
    const id = positiveId(album.id_album);
    const name = typeof album.name === "string" ? album.name.trim() : "";
    if (!id || !name || unique.has(id)) continue;
    unique.set(id, { id_album: id, name, coverUrl: coverUrl(album.url_image) });
  }
  return value.length > 0 && unique.size === 0 ? null : [...unique.values()];
}

function parseMusics(value: unknown, albumId: number): AlbumMusic[] | null {
  if (!value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  if (!Array.isArray(detail.musics)) return null;
  if (detail.id_album != null && positiveId(detail.id_album) !== albumId) return null;
  const unique = new Map<number, AlbumMusic>();
  const rawMusics = detail.musics as unknown[];
  for (const item of rawMusics) {
    if (!item || typeof item !== "object") continue;
    const music = item as Record<string, unknown>;
    const id = positiveId(music.id_music);
    const name = typeof music.name === "string" ? music.name.trim() : "";
    if (!id || !name || unique.has(id)) continue;
    const duration = durationSeconds(music.duration);
    const track = positiveId(music.track) ?? unique.size + 1;
    unique.set(id, {
      id_music: id,
      name,
      duration,
      track,
      has_instrumental_music:
        music.has_instrumental_music === true ||
        music.has_instrumental_music === 1 ||
        music.has_instrumental_music === "1",
    });
  }
  return rawMusics.length > 0 && unique.size === 0 ? null : [...unique.values()];
}

function formatDuration(duration: number | undefined): string {
  return duration === undefined ? "" : DateTime.shortTime(duration);
}

function openAlbum(album: DoxAlbum): void {
  if (!isAlbumEnabled(album.id_album, disabledAlbums.value)) return;
  selectedAlbum.value = album;
  search.value = "";
  void loadMusics(album);
  void nextTick(() => searchInput.value?.focus());
}

async function loadMusics(album: DoxAlbum, fresh = false): Promise<void> {
  const revision = ++requestRevision;
  loading.value = true;
  error.value = null;
  musics.value = [];
  try {
    const detail = await $database.get<unknown>(`album_${album.id_album}`, {
      silent: true,
      fresh,
    });
    if (revision !== requestRevision) return;
    const parsed = parseMusics(detail, album.id_album);
    if (parsed === null) error.value = tm("load_musics_error");
    else musics.value = parsed;
  } catch {
    if (revision === requestRevision) error.value = tm("load_musics_error");
  } finally {
    if (revision === requestRevision) loading.value = false;
  }
}

function goBack(): void {
  const albumId = selectedAlbum.value?.id_album;
  requestRevision++;
  selectedAlbum.value = null;
  musics.value = [];
  error.value = null;
  loading.value = false;
  search.value = "";
  if (albumId) {
    void nextTick(() =>
      pageEl.value?.querySelector<HTMLButtonElement>(`[data-album-id="${albumId}"]`)?.focus()
    );
  }
}

async function loadData(fresh = false): Promise<void> {
  const revision = ++requestRevision;
  selectedAlbum.value = null;
  musics.value = [];
  albums.value = [];
  coverFailed.value = new Set();
  search.value = "";
  loading.value = true;
  error.value = null;
  try {
    const data = await $database.get<unknown>(`${locale.value}_doxology_albums`, {
      silent: true,
      fresh,
    });
    if (revision !== requestRevision) return;
    const parsed = parseAlbums(data);
    if (parsed === null) error.value = tm("load_error");
    else albums.value = parsed;
  } catch {
    if (revision === requestRevision) error.value = tm("load_error");
  } finally {
    if (revision === requestRevision) loading.value = false;
  }
}

function retry(): void {
  if (selectedAlbum.value) void loadMusics(selectedAlbum.value, true);
  else void loadData(true);
}

watch(disabledAlbums, () => {
  if (selectedAlbum.value && !isAlbumEnabled(selectedAlbum.value.id_album, disabledAlbums.value)) {
    goBack();
  }
});
watch(locale, () => void loadData());

watch(
  pageEl,
  (element) => {
    pageResizeObserver?.disconnect();
    if (!element || typeof ResizeObserver === "undefined") return;
    panelWidth.value = element.getBoundingClientRect().width;
    pageResizeObserver = new ResizeObserver(([entry]) => {
      panelWidth.value = entry.target.getBoundingClientRect().width;
    });
    pageResizeObserver.observe(element);
  },
  { flush: "post" }
);
onMounted(() => void loadData());
onBeforeUnmount(() => {
  requestRevision++;
  pageResizeObserver?.disconnect();
});
</script>

<style scoped>
.dx-toolbar {
  width: 100%;
  min-width: 0;
}

.dx-toolbar :deep(.lj-input) {
  width: min(100%, 360px);
}

.dx-page {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
  width: 100%;
  min-width: 0;
  padding: var(--lj-space-6);
}

.dx-heading {
  margin: 0;
  min-width: 0;
  color: var(--lj-text);
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-semibold);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.dx-album-heading {
  max-width: 100%;
}

.dx-album-back {
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

.dx-album-back :deep(.lj-btn__label) {
  min-width: 0;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}

.dx-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-4);
}

.dx-albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
  gap: var(--lj-space-4);
}

.dx-album {
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

.dx-album:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-ui-accent);
}

.dx-album:focus-visible {
  outline: none;
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.dx-cover {
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

.dx-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.dx-album__name {
  flex: 1;
  min-width: 0;
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.dx-album__arrow {
  flex-shrink: 0;
  color: var(--lj-text-subtle);
}

.dx-tracks {
  --dx-actions-width: 260px;
}

.dx-tracks--compact {
  --dx-actions-width: 44px;
}

.dx-tracks :deep(.lj-table__table) {
  table-layout: fixed;
}

.dx-col-track {
  width: 52px;
}

.dx-col-duration {
  width: 82px;
}

.dx-col-actions {
  width: var(--dx-actions-width);
}

.dx-track-number,
.dx-duration {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.dx-duration {
  white-space: nowrap;
  color: var(--lj-text-muted);
}

.dx-music-name {
  color: var(--lj-text);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.dx-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.dx-visually-hidden {
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

.dx-page--narrow .dx-col-track,
.dx-page--narrow .dx-track-number,
.dx-page--narrow .dx-col-duration,
.dx-page--narrow .dx-duration {
  display: none;
}

.dx-page--narrow {
  padding: var(--lj-space-5);
}
</style>
