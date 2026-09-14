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

    <ul v-if="musicResults.length > 0" class="rm-list">
      <li v-for="m in musicResults" :key="m.id_music" class="rm-item" @click="openVersionPicker(m)">
        <div class="rm-item__text">
          <span class="rm-item__title lj-u-truncate">{{ m.name }}</span>
          <span v-if="m.albums_names" class="rm-item__subtitle lj-u-truncate">
            {{ m.albums_names }}
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
    <div v-else-if="musicSearch && !loadingMusics" class="rm-state lj-u-text-center lj-u-muted">
      {{ t("components.music_search.empty_search") }}
    </div>
    <div v-else-if="loadingMusics" class="rm-state rm-state--loading lj-u-text-center">
      <LjSpinner :size="24" />
    </div>

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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { MusicAlbum, MusicItem } from "@/types/Music";
import type { ChooseLaterItem } from "@/types/Liturgy";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

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
const musicResults = ref<MusicItem[]>([]);
const loadingMusics = ref<boolean>(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

/** Música selecionada para escolha do modo de execução. */
const selectedMusic = ref<MusicItem | null>(null);
const versionPickerOpen = ref<boolean>(false);

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

async function onMusicSearch(): Promise<void> {
  if (!musicSearch.value || musicSearch.value.length < 2) {
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
        const data = (await res.json()) as { results?: MusicItem[] };
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

async function openMusic(music: MusicAlbum, mode: MusicActionEnum): Promise<void> {
  try {
    const idLiturgy = props.chooseLaterItem?.id || "";

    if (props.chooseLaterMode) {
      emit("update:choose-later-mode", false);
      emit("update:choose-later-item", null);
    }

    const res = await postApi(
      "/api/open-song",
      { id: music.id_music, mode, id_liturgy: idLiturgy },
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
</style>
