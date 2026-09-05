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
      <li v-for="m in musicResults" :key="m.id_music" class="rm-item">
        <div class="rm-item__text">
          <span class="rm-item__title lj-u-truncate">{{ m.name }}</span>
          <span v-if="m.albums_names" class="rm-item__subtitle lj-u-truncate">
            {{ m.albums_names }}
          </span>
        </div>
        <div class="rm-item__actions">
          <!-- Cantada (tag=1) -->
          <LjButton
            variant="ghost"
            size="lg"
            :icon="ICONS.MUSIC.SLIDES_AUDIO"
            icon-only
            :title="t('ribbon.btn.sing')"
            @click.stop="openMusic(m, 1)"
          />
          <!-- Instrumental (tag=2) -->
          <LjButton
            variant="ghost"
            size="lg"
            :icon="ICONS.MUSIC.SLIDES_PLAYBACK"
            icon-only
            :disabled="!m.has_instrumental_music"
            :title="t('ribbon.btn.playback')"
            @click.stop="openMusic(m, 2)"
          />
          <!-- Sem Áudio (tag=3) -->
          <LjButton
            variant="ghost"
            size="lg"
            :icon="ICONS.MUSIC.SLIDES_ONLY"
            icon-only
            :title="t('ribbon.btn.no_audio')"
            @click.stop="openMusic(m, 3)"
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
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjInput, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { MusicAlbum, MusicItem } from "@/types/Music";
import type { ChooseLaterItem } from "@/types/Liturgy";
import { apiFetch } from "@/helpers/ApiClient";

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

async function openMusic(music: MusicAlbum, tag: number = 3): Promise<void> {
  try {
    const idLiturgy = props.chooseLaterItem?.id || "";

    if (props.chooseLaterMode) {
      emit("update:choose-later-mode", false);
      emit("update:choose-later-item", null);
    }

    const res = await apiFetch(
      `/api/open-song?id=${music.id_music}&tag=${tag}&token=${props.token}&id_liturgy=${idLiturgy}`
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
</style>
