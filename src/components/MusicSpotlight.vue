<template>
  <LjDialog
    v-model="open"
    size="lg"
    :title="t('title')"
    :icon="ICONS.MODULES.MUSIC_SEARCH"
    @open-auto-focus="focusSearch"
  >
    <div ref="searchBar" class="music-search__bar">
      <LjInput
        v-model="search"
        size="lg"
        clearable
        :icon="ICONS.ACTIONS.SEARCH"
        :placeholder="t('placeholder')"
        :aria-label="t('placeholder')"
        autocomplete="off"
        spellcheck="false"
        @keydown.escape.prevent.stop="open = false"
        @keydown.enter.prevent.stop="pickFirst"
      />
    </div>

    <div class="music-search__results">
      <div v-if="loading && !filteredMusics.length" class="music-search__state">
        <LjSpinner :size="24" />
      </div>

      <LjEmpty
        v-else-if="!filteredMusics.length"
        :icon="ICONS.MUSIC.NOTE_OUTLINE"
        :title="search ? t('empty_search') : t('empty')"
      />

      <div v-else class="music-search__scroll">
        <table class="music-search__table">
          <thead>
            <tr>
              <th>{{ t("music") }}</th>
              <th>{{ t("album") }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredMusics"
              :key="item.custom_song_id || item.id_music"
              class="lj-music-row"
              :class="{ 'music-search__row--pick': mode === 'pick' }"
              @click="mode === 'pick' && pickMusic(item)"
              @dblclick="pickMusic(item)"
            >
              <td class="music-search__name">{{ item.name }}</td>
              <td class="music-search__album">{{ albumLabel(item) }}</td>
              <td>
                <div class="music-search__actions">
                  <LjButton
                    v-if="mode === 'pick' && !onMusicAction"
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.MUSIC.SLIDES_AUDIO"
                    :title="t('select')"
                    :aria-label="t('select')"
                    @click.stop="pickMusic(item)"
                  />
                  <template v-if="onMusicAction">
                    <LjButton
                      size="sm"
                      variant="ghost"
                      icon-only
                      :icon="ICONS.MUSIC.SLIDES_AUDIO"
                      :title="t('audio')"
                      :aria-label="t('audio')"
                      @click.stop="handleMusicAction(item, MusicActionEnum.AUDIO)"
                    />
                    <LjButton
                      size="sm"
                      variant="ghost"
                      icon-only
                      :icon="ICONS.MUSIC.SLIDES_PLAYBACK"
                      :title="t('playback')"
                      :aria-label="t('playback')"
                      :disabled="!item.has_instrumental_music"
                      @click.stop="handleMusicAction(item, MusicActionEnum.INSTRUMENTAL)"
                    />
                    <LjButton
                      size="sm"
                      variant="ghost"
                      icon-only
                      :icon="ICONS.MUSIC.AUDIO"
                      :title="t('audio_only')"
                      :aria-label="t('audio_only')"
                      @click.stop="handleMusicAction(item, MusicActionEnum.AUDIO_ONLY)"
                    />
                    <LjButton
                      size="sm"
                      variant="ghost"
                      icon-only
                      :icon="ICONS.MUSIC.AUDIO_PLAYBACK"
                      :title="t('playback_only')"
                      :aria-label="t('playback_only')"
                      :disabled="!item.has_instrumental_music"
                      @click.stop="handleMusicAction(item, MusicActionEnum.PLAYBACK_ONLY)"
                    />
                  </template>
                  <l-music-menu-table
                    v-else-if="!Platform.isRemote"
                    :id_music="Number(item.id_music)"
                    :music-subtitle="musicTitle(item, 'Música')"
                    :name="item.name"
                    :has_instrumental_music="item.has_instrumental_music ?? false"
                    :custom-song-id="item.custom_song_id"
                    :has-audio="item.has_audio !== false"
                  />
                  <LjButton
                    v-else-if="Platform.isRemote"
                    size="sm"
                    variant="ghost"
                    icon-only
                    class="music-search__accent"
                    :icon="ICONS.PLAYER.PLAY_OUTLINE"
                    :title="t('select')"
                    :aria-label="t('select')"
                    @click.stop="pickMusic(item)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <span class="music-search__footer">{{ filteredMusics.length }} {{ t("results") }}</span>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, provide, ref, watch } from "vue";
import { useSobreposicaoGlobal } from "@/composables/useSobreposicaoGlobal";
import { useI18n } from "vue-i18n";
import LMusicMenuTable from "@/components/MusicMenuTable.vue";
import { LjButton, LjDialog, LjEmpty, LjInput, LjSpinner } from "@/components/ui";
import Database from "@/helpers/Database";
import { loadCustomMusicCatalog } from "@/helpers/CustomMusicCatalog";
import Strings from "@/helpers/Strings";
import { isHymnalTrack } from "@/helpers/Hymnal";
import { useMusicCatalog } from "@/composables/useMusicCatalog";
import { musicAlbumLabel, musicTitle, compareMusics } from "@root/config/musicCatalog.mjs";
import Fuse from "fuse.js";
import Platform from "@/helpers/Platform";
import { ICONS } from "@/config/Icons";
import type { SearchMusicItem } from "@/types/Music";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

const props = defineProps<{
  modelValue: boolean;
  mode?: "execute" | "pick";
  musicsList?: SearchMusicItem[] | null;
  onMusicAction?: (music: SearchMusicItem, action: MusicActionEnum) => void;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "pick", music: SearchMusicItem): void;
}>();

const { t: i18nT, locale } = useI18n();

const RESULT_LIMIT = 80;
const FUZZY_MIN_LENGTH = 3;

const search = ref<string>("");
// O primitivo não expõe o <input> interno: o invólucro é o caminho até ele
// para devolver o foco ao campo assim que o diálogo abre.
const searchBar = ref<HTMLElement | null>(null);
const loading = ref<boolean>(false);
const loadedLocale = ref<string | null>(null);
const musics = ref<SearchMusicItem[]>([]);
const customMusics = ref<SearchMusicItem[]>([]);
let loadRevision = 0;
onScopeDispose(() => loadRevision++);

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

useSobreposicaoGlobal(open);

provide("close-spotlight", () => {
  open.value = false;
});

const { musics: sourceMusics } = useMusicCatalog(() =>
  Array.isArray(props.musicsList) ? props.musicsList : [...musics.value, ...customMusics.value]
);

const filteredMusics = computed<SearchMusicItem[]>(() => {
  const query = Strings.clean(search.value);
  if (!query) return [];

  const exact = sourceMusics.value
    .filter((music: SearchMusicItem) => {
      if (/^\d+$/.test(query)) return isHymnalTrack(music, query);
      return (
        Strings.clean(music.name).includes(query) ||
        Strings.clean(albumLabel(music)).includes(query) ||
        isHymnalTrack(music, query)
      );
    })
    .slice(0, RESULT_LIMIT);

  if (exact.length) return exact;
  return approximateMusics();
});

/**
 * Rede de segurança para quem errou a digitação — mesma regra do módulo
 * Músicas: só roda quando a busca por trecho não achou nada.
 */
function approximateMusics(): SearchMusicItem[] {
  const query = Strings.fold(search.value);
  if (query.length < FUZZY_MIN_LENGTH || /^\d+$/.test(query)) return [];

  const entries = sourceMusics.value.map((music) => ({
    music,
    name: Strings.fold(music.name),
    album: Strings.fold(albumLabel(music)),
  }));

  const fuse = new Fuse(entries, {
    keys: ["name", "album"],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: FUZZY_MIN_LENGTH,
  });

  return fuse
    .search(query)
    .map((hit) => hit.item.music)
    .sort(compareMusics)
    .slice(0, RESULT_LIMIT);
}

function t(key: string): string {
  return i18nT(`components.music_search.${key}`);
}

function albumLabel(music: SearchMusicItem): string {
  return musicAlbumLabel(music, t("custom_album"));
}

function focusSearch(event: Event): void {
  event.preventDefault();
  searchBar.value?.querySelector("input")?.focus();
}

async function loadMusics(): Promise<void> {
  if (Array.isArray(props.musicsList)) return;
  const revision = ++loadRevision;
  const language = locale.value;
  loading.value = true;
  try {
    await Promise.all([
      (async () => {
        if (loadedLocale.value === language) return;
        const data = await Database.get<SearchMusicItem[]>(`${language}_musics`).catch(() => null);
        if (revision !== loadRevision) return;
        musics.value = Array.isArray(data) ? data : [];
        if (Array.isArray(data)) loadedLocale.value = language;
      })(),
      (async () => {
        // Os seletores de timer e do painel de liturgia ainda recebem IDs do catálogo.
        const data =
          !Platform.isRemote && props.mode !== "pick" && !props.onMusicAction
            ? await loadCustomMusicCatalog()
            : [];
        if (revision === loadRevision) customMusics.value = data;
      })(),
    ]);
  } finally {
    if (revision === loadRevision) loading.value = false;
  }
}

function pickFirst(): void {
  const music = filteredMusics.value[0];
  if (music) pickMusic(music);
}

function pickMusic(music: SearchMusicItem): void {
  if (props.mode !== "pick") return;
  emit("pick", music);
  open.value = false;
}

function handleMusicAction(music: SearchMusicItem, action: MusicActionEnum): void {
  props.onMusicAction?.(music, action);
  open.value = false;
}

watch(
  open,
  (value: boolean) => {
    if (!value) return;
    search.value = "";
    void loadMusics();
  },
  { immediate: true }
);

watch(
  () => locale.value,
  () => {
    if (!Array.isArray(props.musicsList)) {
      musics.value = [];
      loadedLocale.value = null;
      if (open.value) void loadMusics();
    }
  }
);
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele — inclusive na
     raiz dos primitivos filhos — e `scoped` funciona normalmente. -->
<style scoped>
.music-search__bar {
  margin-bottom: var(--lj-space-5);
}

/* O LjInput é inline-flex e encolhe para o conteúdo: aqui ele ocupa a linha. */
.music-search__bar :deep(.lj-input) {
  width: 100%;
}

.music-search__results {
  min-height: 180px;
}

.music-search__state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  color: var(--lj-ui-accent-text);
}

/* Sem primitivo de tabela no catálogo: moldura única com cabeçalho fixo, como
   a que já existia aqui. A rolagem mora neste invólucro para o `sticky` do
   cabeçalho ter um contêiner de rolagem próprio. */
.music-search__scroll {
  max-height: 46vh;
  overflow: auto;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.music-search__table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: var(--lj-text-base);
  text-align: left;
}

.music-search__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
  border-bottom: 1px solid var(--lj-surface-border-strong);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
}

.music-search__table td {
  padding: var(--lj-space-2) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-divider);
  vertical-align: middle;
}

.music-search__table tbody tr:last-child td {
  border-bottom: none;
}

.music-search__row--pick {
  cursor: pointer;
}

.music-search__name {
  font-weight: var(--lj-weight-semibold);
}

.music-search__album {
  color: var(--lj-text-muted);
}

.music-search__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lj-space-2);
}

/* Três classes para vencer o `.lj-btn--ghost` do primitivo sem `!important`:
   o botão de tocar do modo remoto era tingido com a cor de destaque. */
.music-search__actions :deep(.lj-btn.music-search__accent) {
  color: var(--lj-ui-accent-text);
}

.music-search__footer {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}
</style>
