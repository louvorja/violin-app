<template>
  <div class="rm-root">
    <LjInput
      v-model="musicSearch"
      size="touch"
      clearable
      :placeholder="t('components.inputs.search')"
      :aria-label="t('components.inputs.search')"
      :icon="ICONS.ACTIONS.SEARCH"
      @update:model-value="onMusicSearch"
    />

    <!-- Busca: resultados nos dois acervos (oficial + coletâneas). -->
    <template v-if="searching">
      <ul v-if="musicResults.length > 0" class="rm-list">
        <li
          v-for="m in musicResults"
          :key="m.custom_song_id || m.id_music"
          class="rm-item"
          @click="openVersionPicker(m)"
        >
          <div class="rm-item__text">
            <span class="rm-item__title lj-u-truncate">{{ m.name }}</span>
            <span v-if="musicAlbumLabel(m)" class="rm-item__subtitle lj-u-truncate">
              {{ musicAlbumLabel(m) }}
            </span>
          </div>
          <div class="rm-item__actions">
            <LjButton
              variant="ghost"
              size="lg"
              :icon="ICONS.PLAYER.PLAY_OUTLINE"
              icon-only
              :title="t('components.music_menu.execute')"
              @click.stop="openVersionPicker(m)"
            />
          </div>
        </li>
      </ul>
      <div
        v-if="musicResults.length === 0 && !loadingMusics"
        class="rm-state lj-u-text-center lj-u-muted"
      >
        {{ t("components.music_search.empty_search") }}
      </div>
      <div v-else-if="loadingMusics" class="rm-state rm-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>

    <!-- Sem busca: álbuns do catálogo + coletâneas (ou o álbum aberto). -->
    <template v-else>
      <div v-if="selectedAlbum" class="rm-head">
        <button type="button" class="rm-back" @click="closeAlbum">
          ← {{ t("remote_control.videos.back") }}
        </button>
        <span class="rm-head__title">{{ selectedAlbum.title || "" }}</span>
      </div>

      <ul v-if="rows.length > 0" class="rm-list">
        <template v-for="row in rows" :key="row.key">
          <li v-if="row.kind === 'group'" class="rm-group">{{ row.label }}</li>
          <li v-else class="rm-item" @click="row.action()">
            <img v-if="row.thumb" class="rm-item__thumb" :src="row.thumb" loading="lazy" alt="" />
            <LjIcon
              v-else-if="row.icon"
              :icon="row.icon"
              :size="32"
              :color="row.iconColor || 'primary'"
              class="rm-item__icon"
            />
            <div class="rm-item__text">
              <span class="rm-item__title lj-u-truncate">{{ row.title }}</span>
              <span v-if="row.subtitle" class="rm-item__subtitle lj-u-truncate">
                {{ row.subtitle }}
              </span>
            </div>
            <span v-if="row.badge" class="rm-item__badge">{{ row.badge }}</span>
            <LjButton
              v-if="row.playable"
              variant="ghost"
              size="lg"
              :icon="ICONS.PLAYER.PLAY_OUTLINE"
              icon-only
              @click.stop="row.action()"
            />
          </li>
        </template>
      </ul>
      <div v-if="rows.length === 0 && !loadingAlbums" class="rm-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.music.albums_empty") }}
      </div>
      <div v-else-if="loadingAlbums" class="rm-state rm-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>

    <LjDialog
      v-model="versionPickerOpen"
      size="sm"
      :icon="ICONS.MUSIC.SING"
      :title="selectedMusic?.name || ''"
    >
      <div class="rm-versions">
        <p class="rm-versions__hint">{{ t("remote_control.music.mode_title") }}</p>
        <button
          v-for="opt in MUSIC_VERSIONS"
          :key="opt.mode"
          type="button"
          class="rm-version"
          :disabled="opt.needsPlayback && !selectedHasInstrumental"
          @click="playVersion(opt.mode)"
        >
          <LjIcon :icon="opt.icon" :size="22" />
          <span class="rm-version__label">{{ t(opt.labelKey) }}</span>
        </button>
      </div>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjDialog, LjIcon, LjInput, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { MusicLibraryAlbum, MusicItem, SearchMusicItem } from "@/types/Music";
import type { ChooseLaterItem } from "@/types/Liturgy";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { musicAlbumLabel } from "@root/config/musicCatalog.mjs";
import { serverImageUrl } from "@/helpers/serverImageUrl";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";

const props = defineProps<{
  token?: string;
  chooseLaterMode?: boolean;
  chooseLaterItem?: ChooseLaterItem | null;
}>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
  (e: "update:tab", tab: string): void;
  (e: "update:choose-later-mode", value: boolean): void;
  (e: "update:choose-later-item", value: ChooseLaterItem | null): void;
}>();

const { t, locale } = useI18n();
const musicSearch = ref<string>("");
const musicResults = ref<SearchMusicItem[]>([]);
const loadingMusics = ref<boolean>(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

/** Música selecionada para escolha do modo de execução. */
const selectedMusic = ref<SearchMusicItem | null>(null);
const versionPickerOpen = ref<boolean>(false);

/** Álbuns do catálogo + coletâneas (navegação quando não há busca). */
const albums = ref<MusicLibraryAlbum[]>([]);
const selectedAlbum = ref<MusicLibraryAlbum | null>(null);
const albumSongs = ref<SearchMusicItem[]>([]);
const loadingAlbums = ref<boolean>(false);

// ≥2 chars = busca (mesma régua do servidor); abaixo disso, navegação.
const searching = computed(() => musicSearch.value.trim().length >= 2);

/** Linha da lista: cabeçalho de grupo ou um card (álbum/faixa). */
type Row =
  | { kind: "group"; key: string; label: string }
  | {
      kind: "item";
      key: string;
      title: string;
      subtitle: string;
      badge: string | null;
      thumb: string;
      /** Ícone quando não há capa (pins do hinário usam a marca do módulo). */
      icon?: string;
      /** Cor do glifo (manifest color do módulo, ex.: #7d3c98). */
      iconColor?: string;
      playable: boolean;
      action: () => void;
    };

/** Álbuns agrupados por origem — ou as faixas do álbum aberto. */
const rows = computed<Row[]>(() => {
  if (selectedAlbum.value) {
    return albumSongs.value.map((song) => ({
      kind: "item" as const,
      key: String(song.custom_song_id || song.id_music),
      title: song.name,
      subtitle: song.duration || "",
      badge: null,
      thumb: "",
      playable: true,
      action: () => openVersionPicker(song),
    }));
  }

  /** Ícone do módulo dono do álbum (pin do hinário) — mesma marca do desktop. */
  const albumModuleIcon = (moduleId?: string | null): string => {
    if (moduleId === "hymnal") return ICONS.MODULES.HYMNAL;
    if (moduleId === "hymnal_1996") return ICONS.MODULES.HYMNAL_1996;
    return "";
  };

  const albumRow = (album: MusicLibraryAlbum): Row => ({
    kind: "item" as const,
    key: album.id,
    title: album.title || "",
    subtitle: album.subtitle || "",
    badge: album.count > 0 ? String(album.count) : null,
    thumb: serverImageUrl(album.image, props.token),
    icon: albumModuleIcon(album.module_id),
    iconColor: album.module_id ? album.color || undefined : undefined,
    playable: false,
    action: () => openAlbum(album),
  });

  const oficiais = albums.value.filter((album) => album.source === "official");
  const colecoes = albums.value.filter((album) => album.source === "custom");
  const linhas: Row[] = [];
  if (oficiais.length > 0) {
    linhas.push({ kind: "group", key: "g-oficial", label: t("remote_control.music.albums") });
    linhas.push(...oficiais.map(albumRow));
  }
  if (colecoes.length > 0) {
    linhas.push({ kind: "group", key: "g-colecoes", label: t("remote_control.music.collections") });
    linhas.push(...colecoes.map(albumRow));
  }
  return linhas;
});

/** Playback/Somente playback só valem quando a música tem faixa instrumental. */
const selectedHasInstrumental = computed<boolean>(
  () => !!selectedMusic.value?.has_instrumental_music
);

/**
 * Modos de execução oferecidos. Os `mode` batem com o `/api/open-song`:
 *  - audio          → slides + faixa cantada
 *  - instrumental   → slides + playback
 *  - no_audio       → somente slides (Letra)
 *  - audio-only     → somente o áudio, sem slides
 *  - playback-only  → somente o playback, sem slides
 */
const MUSIC_VERSIONS: {
  mode: MusicActionEnum;
  labelKey: string;
  icon: string;
  needsPlayback: boolean;
}[] = [
  {
    mode: MusicActionEnum.AUDIO,
    labelKey: "remote_control.music.mode_sung",
    icon: ICONS.MUSIC.SING,
    needsPlayback: false,
  },
  {
    mode: MusicActionEnum.INSTRUMENTAL,
    labelKey: "remote_control.music.mode_playback",
    icon: ICONS.MUSIC.PLAYBACK,
    needsPlayback: true,
  },
  {
    mode: MusicActionEnum.NO_AUDIO,
    labelKey: "remote_control.music.mode_lyric",
    icon: ICONS.MUSIC.LYRIC,
    needsPlayback: false,
  },
  {
    mode: MusicActionEnum.AUDIO_ONLY,
    labelKey: "remote_control.music.mode_audio_only",
    icon: ICONS.MUSIC.AUDIO,
    needsPlayback: false,
  },
  {
    mode: MusicActionEnum.PLAYBACK_ONLY,
    labelKey: "remote_control.music.mode_playback_only",
    icon: ICONS.MUSIC.AUDIO_PLAYBACK,
    needsPlayback: true,
  },
];

/** Texto do erro de uma resposta HTTP (o desktop manda `error` pronto). */
async function mensagemDeErro(res: Response): Promise<string> {
  return httpErrorMessage(res, t("remote_control.errors.generic"));
}

/** Álbuns do catálogo + coletâneas — é o `refresh()` da aba (Atualizar). */
async function fetchAlbums(): Promise<void> {
  loadingAlbums.value = true;
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(
      `/api/music-library?action=albums&lang=${lang}&token=${props.token}`
    );
    if (res.ok) {
      const data = (await res.json()) as { albums?: MusicLibraryAlbum[] };
      albums.value = data.albums || [];
    } else {
      albums.value = [];
      emit("show-snackbar", await mensagemDeErro(res), "error");
    }
  } catch (e) {
    console.error("[RemoteMusic] albums error:", e);
    albums.value = [];
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    loadingAlbums.value = false;
  }
}

async function openAlbum(entry: MusicLibraryAlbum): Promise<void> {
  selectedAlbum.value = entry;
  albumSongs.value = [];
  loadingAlbums.value = true;
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(
      `/api/music-library?action=songs&album=${encodeURIComponent(entry.id)}&lang=${lang}&token=${props.token}`
    );
    if (res.ok) {
      const data = (await res.json()) as { songs?: SearchMusicItem[] };
      albumSongs.value = data.songs || [];
    } else {
      emit("show-snackbar", await mensagemDeErro(res), "error");
    }
  } catch (e) {
    console.error("[RemoteMusic] album error:", e);
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    loadingAlbums.value = false;
  }
}

function closeAlbum(): void {
  selectedAlbum.value = null;
  albumSongs.value = [];
}

async function onMusicSearch(): Promise<void> {
  if (
    !musicSearch.value.trim() ||
    (musicSearch.value.trim().length < 2 && !/^\d+$/.test(musicSearch.value.trim()))
  ) {
    musicResults.value = [];
    return;
  }
  loadingMusics.value = true;

  // Debounce: aguarda 300ms da última digitação
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const lang = locale.value || "pt";
      const q = encodeURIComponent(musicSearch.value.trim());
      const res = await apiFetch(`/api/music-search?q=${q}&lang=${lang}&token=${props.token}`);
      if (res.ok) {
        const data = (await res.json()) as { results?: SearchMusicItem[] };
        musicResults.value = data.results || [];
      } else {
        musicResults.value = [];
      }
    } catch (e) {
      console.error("[RemoteMusic] search error:", e);
      musicResults.value = [];
    } finally {
      loadingMusics.value = false;
    }
  }, 300);
}

function openVersionPicker(music: MusicItem): void {
  selectedMusic.value = music;
  versionPickerOpen.value = true;
}

function playVersion(mode: MusicActionEnum): void {
  versionPickerOpen.value = false;
  if (selectedMusic.value) void openMusic(selectedMusic.value, mode);
}

async function openMusic(music: SearchMusicItem, mode: MusicActionEnum): Promise<void> {
  try {
    const idLiturgy = props.chooseLaterItem?.id || "";

    if (props.chooseLaterMode) {
      emit("update:choose-later-mode", false);
      emit("update:choose-later-item", null);
    }

    const res = await postApi(
      "/api/open-song",
      {
        id: music.id_music,
        mode,
        id_liturgy: idLiturgy,
        // Personalizada: o id acima é negativo (só para listas); a execução é
        // pelo UUID — o desktop abre com `openCustomMusic`.
        custom_song_id: music.custom_song_id,
      },
      props.token
    );
    if (res.ok) {
      emit("show-snackbar", t("components.music_menu.execute") + ": " + music.name);
      emit("update:tab", "slides");
    } else {
      const err = (await res.json()) as { message?: string; error?: string };
      emit("show-snackbar", "Erro: " + (err.message || err.error || res.statusText), "error");
    }
  } catch (e) {
    emit("show-snackbar", "Erro ao abrir música", "error");
  }
}
onMounted(() => void fetchAlbums());

defineExpose({ refresh: fetchAlbums });
</script>

<style scoped>
.rm-root {
  padding: var(--lj-space-6);
}

/* O LjInput é inline-flex e encolhe para a largura intrínseca do <input>; sem
   isto a busca ocupava pouco mais da metade da tela do celular, com um vazio à
   direita. O campo que saía daqui era 100%. */
.rm-root > :deep(.lj-input) {
  width: 100%;
}

.rm-list {
  margin: var(--lj-space-4) 0 0;
  padding: 0;
  list-style: none;
}

/* Tela de dedo: a linha inteira é alvo, e a altura vem do conteúdo em corpo
   de toque — não da densidade de mouse do resto do app. */
.rm-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  min-height: 56px;
  padding: var(--lj-space-4) var(--lj-space-5);
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
}

.rm-item:hover {
  background: var(--lj-surface-bg-hover);
}

.rm-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.rm-item__title {
  color: var(--lj-text);
  font-size: var(--lj-text-xl);
}

.rm-item__subtitle {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-lg);
}

.rm-item__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
}

.rm-state {
  margin-top: var(--lj-space-8);
  font-size: var(--lj-text-lg);
}

.rm-state--loading {
  color: var(--lj-ui-accent);
}

.rm-versions {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.rm-versions__hint {
  margin: 0 0 var(--lj-space-2);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.rm-version {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  width: 100%;
  padding: var(--lj-space-4) var(--lj-space-5);
  background: transparent;
  border: none;
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
}

.rm-version:hover:not(:disabled) {
  background: var(--lj-surface-bg-hover);
}

.rm-version:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rm-version:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Voltar + nome do álbum navegando, na mesma linha (paridade com RemoteVideos). */
.rm-head {
  display: flex;
  gap: var(--lj-space-4);
  align-items: center;
  min-width: 0;
  margin-top: var(--lj-space-5);
}

.rm-head__title {
  overflow: hidden;
  min-width: 0;
  color: var(--lj-ui-accent);
  font-size: var(--lj-text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-back {
  display: block;
  flex: none;
  padding: var(--lj-space-3) var(--lj-space-4);
  background: transparent;
  border: none;
  border-radius: var(--lj-ui-radius);
  color: var(--lj-ui-accent);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  cursor: pointer;
}

.rm-back:hover {
  background: var(--lj-surface-bg-hover);
}

/* Cabeçalho por origem (Álbuns / Coletâneas). */
.rm-group {
  padding: var(--lj-space-5) var(--lj-space-5) var(--lj-space-2);
  color: var(--lj-ui-accent);
  font-size: var(--lj-text-sm);
  font-weight: 600;
  list-style: none;
}

/* Capa do álbum (quadrada). */
.rm-item__thumb {
  flex: none;
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg-hover);
}

/* Sem capa mas com módulo dono (pins do hinário): a marca do módulo. */
.rm-item__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg-hover);
}
</style>
