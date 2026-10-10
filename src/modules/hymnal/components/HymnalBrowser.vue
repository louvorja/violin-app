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
            v-model="search"
            :placeholder="tm('inputs.search')"
            :icon="ICONS.ACTIONS.SEARCH"
            :invalid="data.filter_count <= 0"
            clearable
          />
        </div>
      </div>
    </template>

    <l-table
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
          v-for="item in data.data"
          :key="item.id_music"
          :class="{ 'hymnal-row--selected': selectedId === item.id_music }"
          @click="selectedId = item.id_music"
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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getModules } from "@/config/modules";
import ModuleContainer from "@/components/ModuleContainer.vue";
import LTable from "@/components/DataTable.vue";
import LMusicMenuTable from "@/components/MusicMenuTable.vue";
import DateTime from "@/helpers/DateTime";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Media from "@/composables/useMedia";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { HYMNAL_ALBUM_IDS } from "@root/config/musicCatalog.mjs";

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
const sequenceQueue = ref([]);
const _sequenceTimer = ref(null);

const tm = (text) => i18nT(`modules.${props.moduleId}.${text}`);

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

function _clearSequenceTimer() {
  if (_sequenceTimer.value) {
    clearInterval(_sequenceTimer.value);
    _sequenceTimer.value = null;
  }
}

let _lastSeqProgress = 0;

function _pollSequence() {
  const show = $appdata.get(KEYS.MODULES.MEDIA.SHOW, false);
  const progress = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, 0);
  const idMusic = $appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC, null);

  if (show && progress > 0) {
    _lastSeqProgress = progress;
  } else if (!show && sequenceQueue.value.length) {
    if (_lastSeqProgress >= 0.95) {
      _clearSequenceTimer();
      const nextId = sequenceQueue.value.shift();
      Media.open({ id_music: nextId, mode: "audio" });
      _lastSeqProgress = 0;
    } else if (_lastSeqProgress > 0 && _lastSeqProgress < 0.95) {
      _clearSequenceTimer();
      sequenceQueue.value = [];
      _lastSeqProgress = 0;
    }
  }
}

function playAll() {
  const allItems = data.value?.data || [];
  const validItems = allItems.filter((item) => item.id_music != null);
  if (!validItems.length) return;

  const startIndex = Math.floor(Math.random() * validItems.length);
  const ordered = [...validItems.slice(startIndex), ...validItems.slice(0, startIndex)];

  sequenceQueue.value = ordered.slice(1).map((item) => item.id_music);
  _lastSeqProgress = 0;
  _clearSequenceTimer();
  _sequenceTimer.value = setInterval(_pollSequence, 300);
  Media.open({ id_music: ordered[0].id_music, mode: "audio" });
}

function clearQueue() {
  sequenceQueue.value = [];
}

const HYMN_ACTIONS = {
  lyric: () => {
    clearQueue();
    Media.openLyric(selectedId.value);
  },
  sing: () => {
    clearQueue();
    Media.open({ id_music: selectedId.value, mode: "audio" });
  },
  playback: () => {
    clearQueue();
    Media.open({ id_music: selectedId.value, mode: "instrumental" });
  },
  no_audio: () => {
    clearQueue();
    Media.open(selectedId.value);
  },
  audio_sing: () => {
    clearQueue();
    Media.openAudio(selectedId.value);
  },
  audio_playback: () => {
    clearQueue();
    Media.openAudio({ id_music: selectedId.value, mode: "instrumental" });
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
  background: rgba(27, 79, 138, 0.12);
  outline: 2px solid rgba(27, 79, 138, 0.3);
  outline-offset: -2px;
}
</style>
