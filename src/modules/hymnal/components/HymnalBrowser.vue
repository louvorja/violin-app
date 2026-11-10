<template>
  <ModuleContainer
    :manifest="manifest"
    compact
    :index="data.count"
    @close="close()"
    @scroll="onScroll"
    @has-scroll="hasScroll"
  >
    <template #header>
      <div class="hymnal-form-group">
        <div class="hymnal-form-item search-box">
          <LjInput
            ref="searchInput"
            v-model="search"
            :placeholder="tm('inputs.search')"
            :title="i18nT('components.quick_play.hint')"
            :icon="ICONS.ACTIONS.SEARCH"
            :invalid="data.filter_count <= 0"
            autocomplete="off"
            clearable
            @keydown="onSearchKey"
          />
        </div>
      </div>
    </template>

    <l-table
      ref="table"
      v-model="data"
      :search="search"
      letter=""
      :search_min_length="3"
      :searchable_fields="{
        track: true,
        name: true,
      }"
      :disabled_albums="disabledAlbums"
      :album-id="dataFile === 'hymnal_1996' ? HYMNAL_ALBUM_IDS.legacy : HYMNAL_ALBUM_IDS.current"
      :scroll="scroll"
      :has_scroll="has_scroll"
      sort_by="track"
      :file="`${locale}_${dataFile}`"
      offline_filter
    >
      <thead>
        <tr>
          <th class="lj-u-text-end">{{ tm("table.track") }}</th>
          <th class="lj-u-text-start">{{ tm("table.music_name") }}</th>
          <th class="lj-u-text-end">{{ tm("table.duration") }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(item, index) in data.data"
          :key="item.id_music"
          class="lj-music-row"
          :class="{
            'hymnal-row--selected': selectedId === item.id_music,
            'lj-music-row--active': index === nav.index.value,
          }"
          @click="selectedId = item.id_music"
          @mousemove="nav.setActive(index)"
        >
          <td class="lj-u-text-end">
            {{ item.track }}
          </td>
          <td>
            {{ item.name }}
          </td>
          <td class="lj-u-text-end">{{ shortTime(item.duration) }}</td>
          <td>
            <div class="lj-u-flex lj-u-justify-end">
              <l-music-menu-table
                :id_music="item.id_music"
                :name="item.name"
                :music-subtitle="`Hino nº ${item.track} - ${item.name}`"
                :has_instrumental_music="item.has_instrumental_music"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </l-table>

    <LjAlert
      v-if="search && data.filter_count <= 0"
      variant="danger"
      :text="tm('data.not_found')"
      class="hymnal-alert"
    />

    <template #footer>
      <div class="w-100">
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
import { ICONS } from "@/config/Icons";
import { LjAlert, LjInput } from "@/components/ui";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getModules } from "@/config/modules";
import ModuleContainer from "@/components/ModuleContainer.vue";
import LTable from "@/components/DataTable.vue";
import LMusicMenuTable from "@/components/MusicMenuTable.vue";
import DateTime from "@/helpers/DateTime";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Media from "@/composables/useMedia";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { HYMNAL_ALBUM_IDS } from "@root/config/musicCatalog.mjs";
import { useQuickSearch } from "@/composables/useQuickSearch";
import { useListNavigation } from "@/composables/useListNavigation";
import { isQuickPlayEnter, quickPlay } from "@/helpers/QuickPlay";
import { executeMusic } from "@/helpers/MusicExecution";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { usePlaylistPlayback } from "@/modules/musics/composables/usePlaylistPlayback";

const props = defineProps({
  moduleId: { type: String, required: true },
  dataFile: { type: String, required: true },
});

const modules = getModules;
const manifest = computed(() => modules[props.moduleId] || {});
const { t: i18nT, locale } = useI18n();

const search = ref("");
const data = ref([]);
const scroll = ref({});
const has_scroll = ref(false);
const selectedId = ref(null);

const tm = (text) => i18nT(`modules.${props.moduleId}.${text}`);
const playlistPlayback = usePlaylistPlayback();

/*
 * Busca pelo teclado, como no LouvorJA clássico: abriu o Hinário, o cursor já
 * está aqui; digitou o número e deu Enter, o hino vai para a tela (Shift+Enter,
 * o playback). ↑/↓ escolhem outro hino da lista, e o escolhido fica selecionado
 * para os botões da faixa de opções. Voltando para cá, o número anterior fica
 * selecionado.
 */
const searchInput = ref(null);
const table = ref(null);
const quickSearch = useQuickSearch({ moduleId: () => props.moduleId, input: searchInput });

const tableEl = computed(() => table.value?.$el ?? null);
const nav = useListNavigation({
  items: () => data.value?.data ?? [],
  container: tableEl,
  activeSelector: ".lj-music-row--active",
  // Sem busca aplicada a lista é o hinário inteiro: nada destacado até a primeira seta.
  start: () => (table.value?.searching() ? 0 : -1),
});
watch(
  () => data.value?.revision,
  () => nav.reset()
);

async function onSearchKey(event) {
  if (event.key === "Escape" && search.value) {
    event.preventDefault();
    search.value = "";
    return;
  }
  const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (!arrow && !isQuickPlayEnter(event)) return;
  event.preventDefault();
  // O número recém-digitado vale já: a lista é refeita antes de andar ou tocar.
  table.value?.flush();
  await nextTick();
  if (arrow) nav.handleArrow(event);
  const hymn = nav.active.value;
  if (!hymn) return;
  selectedId.value = hymn.id_music;
  if (arrow) return;
  if (quickPlay(hymn, event.shiftKey)) quickSearch.afterPlay();
}

const disabledAlbums = computed(() => {
  return $userdata.get(KEYS.OPTIONS.DISABLED_ALBUMS, []) || [];
});

function shortTime(d) {
  return DateTime.shortTime(d);
}

function onScroll(val) {
  scroll.value = val;
}

function hasScroll(val) {
  has_scroll.value = val;
}

function playAll() {
  const songs = (data.value?.data || [])
    .filter((item) => item.id_music != null)
    .map((item) => ({
      id_music: item.id_music,
      name: item.name,
      duration: item.duration,
      has_instrumental_music: !!item.has_instrumental_music,
    }));
  if (songs.length) playlistPlayback.playSequence(tm("title"), songs);
}

const HYMN_ACTIONS = {
  lyric: () => {
    Media.openLyric(selectedId.value);
  },
  sing: () => {
    void executeMusic({ id_music: selectedId.value }, MusicActionEnum.AUDIO);
  },
  playback: () => {
    void executeMusic({ id_music: selectedId.value }, MusicActionEnum.INSTRUMENTAL);
  },
  no_audio: () => {
    void executeMusic({ id_music: selectedId.value }, MusicActionEnum.NO_AUDIO);
  },
  audio_sing: () => {
    void executeMusic({ id_music: selectedId.value }, MusicActionEnum.AUDIO_ONLY);
  },
  audio_playback: () => {
    void executeMusic({ id_music: selectedId.value }, MusicActionEnum.PLAYBACK_ONLY);
  },
  sequence: () => playAll(),
  report_error: () =>
    window.open("https://louvorja.com.br/telegram", "_blank", "noopener,noreferrer"),
  settings: () =>
    window.dispatchEvent(new CustomEvent("louvorja:open-options", { detail: { tab: "slides" } })),
};

useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload) => {
  if (payload?.module !== props.moduleId) return;
  const exempt = ["export", "sequence", "report_error", "settings"];
  if (selectedId.value == null && !exempt.includes(payload.action)) return;
  const fn = HYMN_ACTIONS[payload.action];
  if (fn) fn();
});

function close() {
  search.value = "";
}
</script>

<style scoped>
.hymnal-form-group {
  display: flex;
  flex-wrap: wrap;
}

.hymnal-form-item {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  justify-content: space-around;
}

.hymnal-alert {
  margin: var(--lj-space-4);
  max-height: 70px;
}

.search-box {
  flex-basis: 600px;
  width: 350px;
  margin-top: 10px;
}

.hymnal-row--selected {
  --lj-music-row-bg: color-mix(in srgb, var(--lj-ui-accent) 10%, var(--lj-surface-bg));

  outline: 2px solid color-mix(in srgb, var(--lj-ui-accent) 30%, transparent);
  outline-offset: -2px;
}
</style>
