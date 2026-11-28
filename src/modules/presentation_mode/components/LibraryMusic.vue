<template>
  <div class="pm-music" data-testid="pm-library-music">
    <header class="pm-music__head">
      <div class="pm-music__search">
        <LjInput
          v-model="search"
          size="sm"
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="tm('music.search')"
          :invalid="!!search && data.filter_count <= 0"
          :disabled="scopeEmpty"
          clearable
          data-testid="pm-music-search"
        />
      </div>
      <div class="pm-music__scope" role="group" :aria-labelledby="scopeLabelId">
        <span :id="scopeLabelId" class="pm-music__scope-label">{{ tm("music.search_in") }}</span>
        <LjCheckbox v-model="scope.name" :label="tm('music.scope_name')" />
        <LjCheckbox v-model="scope.lyric" :label="tm('music.scope_lyric')" />
        <LjCheckbox v-model="scope.album" :label="tm('music.scope_album')" />
        <LjCheckbox v-model="scope.track" :label="tm('music.scope_track')" />
      </div>
      <LjSwitch
        v-model="instrumental"
        :label="tm('music.with_playback')"
        data-testid="pm-music-instrumental"
      />
    </header>

    <div v-if="album || scopeEmpty || data.is_fuzzy" class="pm-music__notes">
      <LjChip
        v-if="album"
        size="sm"
        variant="primary"
        :icon="ICONS.MODULES.ALBUM"
        removable
        data-testid="pm-music-album-filter"
        @remove="album = null"
      >
        {{ album.name }}
      </LjChip>
      <span v-if="scopeEmpty" class="pm-music__warn">
        <LjIcon :icon="ICONS.UI.ALERT" :size="13" />
        {{ tm("music.scope_empty") }}
      </span>
      <span v-else-if="data.is_fuzzy" class="pm-music__hint">{{ tm("music.approximate") }}</span>
    </div>

    <div ref="scroller" class="pm-music__table" @scroll.passive="onScroll">
      <Table
        v-model="data"
        :search="search"
        :letter="letter"
        :search_min_length="3"
        :searchable_fields="{
          name: scope.name,
          custom_collections: scope.name,
          lyric: scope.lyric,
          albums_names: scope.album,
          track: scope.track,
        }"
        :filter="{ has_instrumental_music: instrumental }"
        :disabled_albums="disabledAlbums"
        :only_album="album?.id_album"
        :scroll="scroll"
        :has_scroll="hasScroll"
        sort_by="name"
        :file="`${locale}_musics`"
        :extra_rows="customMusics"
      >
        <thead>
          <tr>
            <th class="lj-u-text-start">{{ tm("music.col_name") }}</th>
            <th class="lj-u-text-start">{{ tm("music.col_album") }}</th>
            <th class="lj-u-text-end">{{ tm("music.col_duration") }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in data.data"
            :key="item.id_music"
            class="pm-music__row"
            :class="{
              'pm-music__row--selected': item.id_music === selectedId,
              'pm-music__row--live': item.id_music === liveSongId,
            }"
            tabindex="0"
            :data-testid="`pm-song-${item.id_music}`"
            @click="select(item)"
            @dblclick="play(item, 'sung')"
            @keydown.enter.self="play(item, 'sung')"
          >
            <td class="pm-music__name">{{ item.name }}</td>
            <td class="pm-music__albums">
              <LjChip
                v-for="name in item.custom_collection_names || []"
                :key="name"
                size="sm"
                :variant="chipVariant"
                class="pm-music__chip pm-music__chip--static"
              >
                {{ name }}
              </LjChip>
              <LjChip
                v-for="a in item.albums"
                :key="a.id_album"
                size="sm"
                :variant="chipVariant"
                class="pm-music__chip"
                :title="tm('music.filter_album')"
                @click.stop="album = { id_album: a.id_album, name: a.name }"
                @dblclick.stop
              >
                {{ albumLabel(a) }}
              </LjChip>
            </td>
            <td class="lj-u-text-end pm-music__duration">
              {{ item.custom_song_id ? "" : DateTime.shortTime(item.duration ?? 0) }}
            </td>
            <td @click.stop @dblclick.stop>
              <div class="lj-u-flex lj-u-justify-end">
                <MusicMenuTable
                  :id_music="item.id_music"
                  :name="item.name"
                  :music-subtitle="musicTitle(item, 'Música')"
                  :has_instrumental_music="!!item.has_instrumental_music"
                  :custom-song-id="item.custom_song_id"
                  :has-audio="item.has_audio !== false"
                  :run-action="(action: MusicActionEnum) => onAction(item, action)"
                  :extra-menu="programMenu(item)"
                  defer-quick-actions
                />
              </div>
            </td>
          </tr>
        </tbody>
      </Table>
      <p v-if="search && data.filter_count <= 0" class="pm-music__empty">
        {{ tm("music.no_results") }}
      </p>
    </div>

    <footer class="pm-music__foot">
      <LetterPaginate v-model="letter" />
      <span class="pm-music__count">{{ tm("music.records") }}: {{ data.filter_count }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import { LjCheckbox, LjChip, LjIcon, LjInput, LjSwitch } from "@/components/ui";
import Table from "@/components/DataTable.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import LetterPaginate from "@/components/LetterPagination.vue";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import DateTime from "@/helpers/DateTime";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { loadCustomMusicCatalog } from "@/helpers/CustomMusicCatalog";
import type { SearchMusicItem } from "@/types/Music";
import { albumLabel, musicTitle } from "@root/config/musicCatalog.mjs";
import { modeOfAction, modesFor, type MusicMode } from "../program/musicModes";
import { songPlayable, type LibrarySong } from "../program/song";
import { songItem } from "../program/items";
import type { Playable } from "../program/playable";
import type { ProgramItem } from "@/types/Presentation";

/**
 * Aba Músicas da biblioteca: a mesma tabela do módulo Músicas — busca com
 * "Buscar em", filtro de playback, letras e os botões de formato no hover —,
 * mas tocando pelo palco do módulo. Um clique leva a música para a prévia;
 * duplo clique ou Enter toca cantada; o chip da coletânea filtra a tabela.
 */

interface CatalogAlbum {
  id_album: number;
  name: string;
  type?: string;
  pivot?: { track?: number };
}

interface CatalogRow {
  id_music: number;
  name: string;
  duration?: string;
  has_instrumental_music?: number | boolean;
  albums?: CatalogAlbum[];
  /** Música personalizada: o UUID que a executa, e as coletâneas pessoais dela. */
  custom_song_id?: string;
  custom_collection_names?: string[];
  has_audio?: boolean;
}

defineProps<{ liveSongId: number | null }>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options: { mode: MusicMode }];
  add: [item: ProgramItem];
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const scopeLabelId = useId();

/* ─── Busca e filtros (preferências próprias do modo apresentação) ─── */

const DEFAULT_SCOPE = { name: true, lyric: false, album: false, track: true };
type Scope = typeof DEFAULT_SCOPE;

const scope = ref<Scope>({
  ...DEFAULT_SCOPE,
  ...($userdata.get<Partial<Scope>>(KEYS.MODULES.PRESENTATION_MODE.MUSIC_SEARCH, {}) ?? {}),
});
watch(scope, (value) => $userdata.set(KEYS.MODULES.PRESENTATION_MODE.MUSIC_SEARCH, { ...value }), {
  deep: true,
});
const scopeEmpty = computed(() => !Object.values(scope.value).some(Boolean));

const instrumental = computed<boolean>({
  get: () =>
    $userdata.get<boolean>(KEYS.MODULES.PRESENTATION_MODE.MUSIC_INSTRUMENTAL, false) === true,
  set: (value) => $userdata.set(KEYS.MODULES.PRESENTATION_MODE.MUSIC_INSTRUMENTAL, value),
});

const disabledAlbums = computed(
  () => $userdata.get<number[]>(KEYS.OPTIONS.DISABLED_ALBUMS, []) ?? []
);
const chipVariant = computed(() => ($appdata.get(KEYS.SHELL.IS_DARK) ? "neutral" : "primary"));

const search = ref("");
const letter = ref("");
const album = ref<{ id_album: number; name: string } | null>(null);
/** Estado que a tabela devolve pelo v-model: a página visível e quantas casaram. */
const data = ref<{ data: CatalogRow[]; filter_count: number; is_fuzzy: boolean }>({
  data: [],
  filter_count: 0,
  is_fuzzy: false,
});

/* ─── Rolagem: a tabela cresce em lotes quando chega perto do fim ─── */

const scroller = ref<HTMLElement | null>(null);
const scroll = ref<{ scroll_bottom?: number }>({});
const hasScroll = ref(false);

function measure(): void {
  const el = scroller.value;
  if (!el) return;
  hasScroll.value = el.scrollHeight > el.clientHeight;
  scroll.value = { scroll_bottom: Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight) };
}

function onScroll(): void {
  measure();
}

watch(
  () => data.value.data.length,
  () => void nextTick(measure)
);

// Outro recorte da lista volta ao topo.
watch([search, letter, album, instrumental], () => {
  if (scroller.value) scroller.value.scrollTop = 0;
});

/* ─── Linhas ─── */

/**
 * O acervo pessoal entra na mesma tabela, como no módulo Músicas: a coletânea
 * pessoal é procurada junto com o nome e pelo filtro de álbum.
 */
const customMusics = ref<
  (SearchMusicItem & { albums_names: string; custom_collections: string })[]
>([]);
async function loadCustomMusics(): Promise<void> {
  const items = await loadCustomMusicCatalog().catch(() => []);
  customMusics.value = items.map((item) => ({
    ...item,
    albums_names: (item.custom_collection_names ?? []).join(", "),
    custom_collections: (item.custom_collection_names ?? []).join(", "),
  }));
}
onMounted(() => void loadCustomMusics());

const selectedId = ref<number | null>(null);

function toSong(item: CatalogRow): LibrarySong {
  const first = album.value
    ? item.albums?.find((a) => a.id_album === album.value?.id_album)
    : item.albums?.[0];
  if (item.custom_song_id) {
    return {
      id_music: item.id_music,
      name: item.name,
      album: (item.custom_collection_names ?? []).join(", "),
      has_instrumental_music: !!item.has_instrumental_music,
      customId: item.custom_song_id,
    };
  }
  return {
    id_music: item.id_music,
    name: item.name,
    duration: item.duration,
    album: first ? albumLabel(first) : "",
    track: first?.pivot?.track,
    has_instrumental_music: !!item.has_instrumental_music,
  };
}

function select(item: CatalogRow): void {
  selectedId.value = item.id_music;
  emit("preview", songPlayable(toSong(item)));
}

function play(item: CatalogRow, mode: MusicMode): void {
  selectedId.value = item.id_music;
  emit("play", songPlayable(toSong(item)), { mode });
}

/** Os botões de formato da linha tocam pelo palco; a letra avulsa segue o caminho de sempre. */
function onAction(item: CatalogRow, action: MusicActionEnum): void {
  const mode = modeOfAction(action);
  if (mode) play(item, mode);
}

function programMenu(item: CatalogRow) {
  return [
    {
      title: tm("library.add_to_program"),
      icon: ICONS.ACTIONS.ADD,
      menu: [
        // Versão em aberto: o duplo clique no programa pede a escolha antes de abrir.
        {
          title: tm("music_modes.ask"),
          icon: ICONS.UI.HELP,
          click: () => emit("add", songItem(toSong(item), null, "")),
        },
        ...modesFor(!!item.has_instrumental_music).map((m) => ({
          title: tm(m.label),
          icon: m.icon,
          // O formato aparece no subtítulo quando não é o de sempre ("Cantado").
          click: () =>
            emit("add", songItem(toSong(item), m.value, m.value === "sung" ? "" : tm(m.label))),
        })),
      ],
    },
  ];
}
</script>

<style scoped>
.pm-music {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-music__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  padding: 6px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-music__search {
  width: 260px;
  max-width: 100%;
}

.pm-music__scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: 12px;
}

.pm-music__scope-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-subtle);
}

.pm-music__notes {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
  font-size: 11px;
}

.pm-music__warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--lj-warning);
}

.pm-music__hint {
  color: var(--lj-text-subtle);
}

.pm-music__table {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.pm-music__row {
  cursor: pointer;
}

.pm-music__row:focus-visible {
  outline: none;
  box-shadow: inset var(--lj-ui-focus);
}

.pm-music__row--selected > td {
  background: var(--lj-live-active-bg);
}

.pm-music__row--live > td:first-child {
  box-shadow: inset 3px 0 0 var(--lj-orange);
}

.pm-music__row--live .pm-music__name {
  font-weight: var(--lj-weight-semibold);
}

.pm-music__albums {
  max-width: 0;
  width: 40%;
}

.pm-music__chip--static {
  cursor: default;
}

.pm-music__chip {
  max-width: 100%;
  margin: 1px 4px 1px 0;
  cursor: pointer;
}

.pm-music__duration {
  font-family: var(--lj-font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.pm-music__empty {
  margin: 0;
  padding: var(--lj-space-4);
  text-align: center;
  color: var(--lj-text-subtle);
}

.pm-music__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  flex-shrink: 0;
  border-top: 1px solid var(--lj-surface-border);
  overflow-x: auto;
}

.pm-music__count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--lj-text-subtle);
}
</style>
