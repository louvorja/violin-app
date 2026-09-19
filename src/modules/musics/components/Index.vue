<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    compact
    :index="data.count"
    @close="close()"
    @scroll="onScroll"
    @has-scroll="hasScroll"
  >
    <template v-if="!compact" #left>
      <PlaylistPanel />
    </template>

    <template v-if="userdata" #header>
      <div class="musics-searchbar">
        <LjInput
          v-if="!disabled"
          v-model="search"
          :placeholder="tm('inputs.search')"
          :aria-label="tm('inputs.search')"
          :icon="ICONS.ACTIONS.SEARCH"
          :invalid="data.filter_count <= 0"
          :disabled="disabled"
          clearable
        />

        <p v-if="disabled" class="musics-searchbar__warning">
          <LjIcon :icon="ICONS.UI.ALERT" :size="14" />
          {{ tm("inputs.search_disabled") }}
        </p>

        <div class="musics-searchbar__scope" role="group" :aria-labelledby="scopeLabelId">
          <span :id="scopeLabelId" class="musics-searchbar__label">
            {{ tm("inputs.search_in") }}
          </span>
          <LjCheckbox v-model="userdata.search.name" :label="tm('inputs.filter_name')" />
          <LjCheckbox v-model="userdata.search.lyric" :label="tm('inputs.filter_lyric')" />
          <LjCheckbox v-model="userdata.search.album" :label="tm('inputs.filter_album')" />
          <LjCheckbox v-model="userdata.search.track" :label="tm('inputs.filter_track')" />
        </div>

        <LjSwitch
          v-model="userdata.filter.instrumental_music"
          :label="tm('inputs.filter_instrumental')"
        />
      </div>
    </template>

    <template v-if="selectedPlaylist" #right>
      <PlaylistSongs :playlist="selectedPlaylist" />
    </template>

    <LjAlert
      v-if="data.is_fuzzy"
      variant="info"
      :text="tm('data.approximate')"
      class="musics-alert"
    />

    <Table
      v-model="data"
      :search="search"
      :letter="letter"
      :search_min_length="3"
      :searchable_fields="{
        name: search_name,
        lyric: search_lyric,
        albums_names: search_album,
        track: search_track,
      }"
      :filter="{ has_instrumental_music: filter_instrumental_music }"
      :disabled_albums="disabledAlbums"
      :scroll="scroll"
      :has_scroll="has_scroll"
      sort_by="name"
      :file="`${$i18n.locale}_musics`"
    >
      <thead>
        <tr>
          <th class="lj-u-text-start">{{ tm("table.music_name") }}</th>
          <th v-if="!compact" class="lj-u-text-start">
            {{ tm("table.album_name") }}
          </th>
          <th class="lj-u-text-end">{{ tm("table.duration") }}</th>
          <th v-if="selectedPlaylist" />
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in data.data"
          :key="item.id_music"
          :data-testid="`music-row-${item.id_music}`"
        >
          <td>
            {{ item.name }}
            <div v-if="compact" class="musics-albums">
              <LjChip
                v-for="album in item.albums"
                :key="album.id_album"
                :variant="chipVariant"
                size="sm"
                class="musics-album-chip"
                @click="openAlbum(album.id_album)"
              >
                {{ album.name }}
              </LjChip>
            </div>
          </td>
          <td v-if="!compact">
            <LjChip
              v-for="album in item.albums"
              :key="album.id_album"
              :variant="chipVariant"
              class="musics-album-chip"
              @click="openAlbum(album.id_album)"
            >
              {{ album.name }}
            </LjChip>
          </td>
          <td class="lj-u-text-end">{{ shortTime(item.duration) }}</td>
          <td v-if="selectedPlaylist" class="lj-u-text-center">
            <LjButton
              v-if="!isSongInPlaylist(selectedPlaylist.id, item.id_music)"
              variant="ghost"
              size="sm"
              :icon="ICONS.MEDIA.ADD"
              :title="tm('playlists.add_to_playlist')"
              icon-only
              @click="addSongToPlaylist(item)"
            />
            <LjButton
              v-else
              variant="primary"
              size="sm"
              :icon="ICONS.UI.CHECK"
              :title="tm('playlists.remove_song')"
              icon-only
              @click="removeSongFromPlaylist(item.id_music)"
            />
          </td>
          <td>
            <div class="lj-u-flex lj-u-justify-end">
              <MusicMenuTable
                :id_music="item.id_music"
                :name="item.name"
                :has_instrumental_music="item.has_instrumental_music"
                :show-playlist-menu="true"
                defer-quick-actions
              />
            </div>
          </td>
        </tr>
      </tbody>
    </Table>

    <LjAlert
      v-if="search && data.filter_count <= 0"
      variant="danger"
      :text="tm('data.not_found')"
      class="musics-alert"
    />

    <template #footer>
      <div class="w-100">
        <LetterPaginate v-model="letter" />
        <div class="lj-u-text-end">
          <small>
            {{ tm("data.records") }}:
            {{ data.filter_count }}
          </small>
        </div>
      </div>
    </template>
  </ModuleContainer>
</template>

<script setup>
import { LjAlert, LjButton, LjCheckbox, LjChip, LjIcon, LjInput, LjSwitch } from "@/components/ui";
/* ########################################################### */
/* ####### INSTALAÇÃO DO MODULO ############################## */
/* ########################################################### */
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import { useViewport } from "@/composables/useViewport";
import Media from "@/composables/useMedia";
import AppData from "@/helpers/AppData";
import DateTime from "@/helpers/DateTime";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { module as manifest } from "../manifest";
import { usePlaylists } from "../composables/usePlaylists";
import ModuleContainer from "@/components/ModuleContainer.vue";
import Table from "@/components/DataTable.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import LetterPaginate from "@/components/LetterPagination.vue";
import PlaylistPanel from "./PlaylistPanel.vue";
import PlaylistSongs from "./PlaylistSongs.vue";
import { ICONS } from "@/config/Icons";
import Telemetry from "@/helpers/Telemetry";

const moduleContainer = ref(null);
const tm = (key) => {
  return moduleContainer.value?.tm(key) || key;
};
const userdata = computed(() => {
  return moduleContainer.value?.userdata;
});

const { selectedPlaylist, hydrate, addSong, removeSong, isSongInPlaylist } = usePlaylists();
const data = ref([]);

const musicPageStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let musicFirstPaintReported = false;
let musicDataVisibleReported = false;

onMounted(async () => {
  Telemetry.track("music_module_opened", { compact: compact.value });
  const playlistStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  await hydrate();
  const playlistDurationMs = Math.max(
    0,
    Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - playlistStartedAt
    )
  );
  Telemetry.track("music_page_stage", {
    stage: "playlists_ready",
    duration_ms: playlistDurationMs,
  });
  Telemetry.histogram("louvorja.music.page.stage.duration", playlistDurationMs, {
    stage: "playlists_ready",
  });

  requestAnimationFrame(() =>
    requestAnimationFrame(async () => {
      await nextTick();
      if (musicFirstPaintReported) return;
      musicFirstPaintReported = true;
      const durationMs = Math.max(
        0,
        Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - musicPageStartedAt
        )
      );
      Telemetry.track("music_page_stage", {
        stage: "first_paint",
        duration_ms: durationMs,
        rendered_rows: data.value?.count || 0,
      });
      Telemetry.histogram("louvorja.music.page.stage.duration", durationMs, {
        stage: "first_paint",
      });
    })
  );
});

watch(
  () => data.value?.count,
  (count) => {
    if (musicDataVisibleReported || typeof count !== "number") return;
    musicDataVisibleReported = true;
    const durationMs = Math.max(
      0,
      Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - musicPageStartedAt
      )
    );
    Telemetry.track("music_page_stage", {
      stage: "data_visible",
      duration_ms: durationMs,
      rendered_rows: count,
      total_rows: data.value?.total_count || 0,
    });
    Telemetry.histogram("louvorja.music.page.stage.duration", durationMs, {
      stage: "data_visible",
    });
  },
  { flush: "post" }
);

function addSongToPlaylist(item) {
  if (!selectedPlaylist.value) return;
  addSong(selectedPlaylist.value.id, {
    id_music: item.id_music,
    name: item.name,
    duration: DateTime.toNumber(item.duration),
    has_instrumental_music: !!item.has_instrumental_music,
  });
}

function removeSongFromPlaylist(id_music) {
  if (!selectedPlaylist.value) return;
  const idx = selectedPlaylist.value.songs.findIndex((s) => s.id_music === id_music);
  if (idx >= 0) removeSong(selectedPlaylist.value.id, idx);
}
/* ########################################################### */
/* ########################################################### */
/* ########################################################### */

/* -------------------------------------------------- */
/* STATE                                              */
/* -------------------------------------------------- */
const { width: displayWidth } = useViewport();

const scopeLabelId = useId();
const search = ref("");
const scroll = ref({});
const has_scroll = ref(false);
const letter = ref("");

let searchTimer;
watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (value.trim()) Telemetry.track("music_search", { query: value, length: value.length });
  }, 700);
});

/* -------------------------------------------------- */
/* COMPUTEDS                                          */
/* -------------------------------------------------- */
const search_name = computed(() => {
  return userdata.value?.search?.name ?? "";
});

const search_lyric = computed(() => {
  return userdata.value?.search?.lyric ?? "";
});

const search_album = computed(() => {
  return userdata.value?.search?.album ?? "";
});

const search_track = computed(() => {
  return userdata.value?.search?.track ?? "";
});

const filter_instrumental_music = computed(() => {
  return userdata.value?.filter?.instrumental_music ?? false;
});

const disabled = computed(() => {
  return !search_name.value && !search_lyric.value && !search_album.value && !search_track.value;
});

const compact = computed(() => displayWidth.value <= 800);
const chipVariant = computed(() => (AppData.get(KEYS.SHELL.IS_DARK) ? "neutral" : "primary"));
const shortTime = (t) => DateTime.shortTime(t);

const disabledAlbums = computed(() => {
  return $userdata.get(KEYS.OPTIONS.DISABLED_ALBUMS, []) || [];
});

/* -------------------------------------------------- */
/* METHODS                                            */
/* -------------------------------------------------- */
function onScroll(value) {
  scroll.value = value;
}

function hasScroll(value) {
  has_scroll.value = value;
}

function openAlbum(id_album) {
  Telemetry.track("music_album_opened", { id_album });
  Media.openAlbum(id_album);
}

function close() {
  Telemetry.track("music_module_closed");
  search.value = "";
}
</script>

<style scoped>
.musics-searchbar {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-4) var(--lj-space-8);
  min-width: 0;
}

/* O LjInput não herda class no wrapper (inheritAttrs: false manda os attrs
   para o <input>), então a medida do campo vem daqui. */
.musics-searchbar :deep(.lj-input) {
  flex: 0 1 320px;
  min-width: 160px;
}

.musics-searchbar__scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-3) var(--lj-space-5);
}

.musics-searchbar__label {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.musics-searchbar__warning {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  margin: 0;
  font-size: var(--lj-text-sm);
  color: var(--lj-warning);
}

.musics-albums {
  padding-bottom: var(--lj-space-2);
}

.musics-album-chip {
  cursor: pointer;
}

.musics-alert {
  margin: var(--lj-space-4);
  max-height: 70px;
}
</style>
