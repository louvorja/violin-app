<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @show="onShow" @close="onClose">
    <template #header>
      <div class="cc-toolbar" :class="{ 'cc-toolbar--mobile': mobileLayout }">
        <LjTabs v-model="activeTab" :tabs="tabItems" :aria-label="tm('title')" />
        <span class="lj-u-spacer" />
        <template v-if="activeTab === 'songs'">
          <LjButton size="sm" :icon="ICONS.ACTIONS.ADD" @click="actNewSong">
            {{ tm("actions.new_song") }}
          </LjButton>
          <LjButton size="sm" variant="subtle" :icon="ICONS.ACTIONS.IMPORT" @click="actImport">
            {{ tm("actions.import") }}
          </LjButton>
        </template>
        <LjButton v-else size="sm" :icon="ICONS.ACTIONS.ADD" @click="actNewCollection">
          {{ tm("actions.new_collection") }}
        </LjButton>
      </div>
    </template>

    <!-- Aba: Músicas -->
    <div v-if="activeTab === 'songs'" class="cc-pane" :class="{ 'cc-pane--mobile': mobileLayout }">
      <LjEmpty v-if="songs.length === 0" :title="tm('data.empty_songs')" />
      <div v-else class="cc-song-grid">
        <LjCard
          v-for="s in songs"
          :key="s.id"
          flush
          class="cc-song"
          tabindex="0"
          @click="executeSong(s)"
          @keydown.enter="executeSong(s)"
        >
          <div class="cc-song__preview" :style="songPreviewStyle(s)">
            <div class="cc-song__actions">
              <LjButton
                size="sm"
                variant="ghost"
                icon-only
                :icon="ICONS.ACTIONS.EDIT"
                :title="tm('actions.edit')"
                :aria-label="tm('actions.edit')"
                @click.stop="openInEditor(s)"
              />
              <LjButton
                size="sm"
                variant="ghost"
                icon-only
                class="cc-song__danger"
                :icon="ICONS.ACTIONS.DELETE"
                :title="tm('actions.delete')"
                :aria-label="tm('actions.delete')"
                @click.stop="confirmDeleteSong(s)"
              />
              <LjMenu :items="songMenuItems(s)" side="bottom" align="end">
                <template #trigger>
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.UI.DOTS_VERTICAL"
                    :title="tm('actions.more')"
                    :aria-label="tm('actions.more')"
                    @click.stop
                  />
                </template>
              </LjMenu>
            </div>
            <div class="cc-song__text" :style="songTextStyle(s)">
              {{ truncate(s.slides[0]?.letra || s.nome, 40) }}
            </div>
          </div>
          <div class="cc-song__info">
            <span class="cc-song__name">{{ s.nome }}</span>
            <span class="cc-song__meta">
              {{ s.slides.length }} {{ tm("labels.slides") }}
              <template v-if="tracksLabel(s)">· {{ tracksLabel(s) }}</template>
            </span>
          </div>
        </LjCard>
      </div>
    </div>

    <!-- Aba: Coletâneas -->
    <div v-else class="cc-collections" :class="{ 'cc-collections--mobile': mobileLayout }">
      <div v-show="!mobileLayout || collectionView === 'list'" class="cc-col-list">
        <ul v-if="collections.length > 0" class="cc-col-items">
          <li
            v-for="c in collections"
            :key="c.id"
            class="cc-col-item"
            :class="{ 'is-active': selectedCollectionId === c.id }"
          >
            <button
              type="button"
              class="cc-col-item__main"
              :aria-current="selectedCollectionId === c.id ? 'true' : undefined"
              @click="openCollection(c.id)"
            >
              <span class="cc-col-dot" :style="{ background: c.cor }" />
              <span class="cc-col-item__text">
                <span class="cc-col-item__name">{{ c.nome }}</span>
                <span class="cc-col-item__sub">
                  {{ c.song_ids.length }} {{ tm("labels.songs_count") }}
                </span>
              </span>
            </button>
            <LjMenu :items="collectionMenuItems(c)" side="bottom" align="end">
              <template #trigger>
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.UI.DOTS_VERTICAL"
                  :title="tm('actions.more')"
                  :aria-label="tm('actions.more')"
                  @click.stop
                />
              </template>
            </LjMenu>
          </li>
        </ul>
        <p v-else class="cc-col-empty">{{ tm("data.empty_collections") }}</p>
      </div>

      <div v-show="!mobileLayout || collectionView === 'detail'" class="cc-col-detail">
        <button
          v-if="mobileLayout"
          type="button"
          class="cc-col-back"
          @click="collectionView = 'list'"
        >
          <LjIcon :icon="ICONS.ACTIONS.PREVIOUS" :size="18" />
          {{ tm("tabs.collections") }}
        </button>
        <p v-if="!selectedCollection" class="cc-col-hint">←</p>
        <template v-else>
          <div class="cc-col-header">
            <h3 class="cc-col-title">{{ selectedCollection.nome }}</h3>
            <span class="lj-u-spacer" />
            <LjMenu :items="addSongMenuItems" side="bottom" align="end">
              <template #trigger>
                <LjButton size="sm" variant="subtle" :icon="ICONS.ACTIONS.ADD">
                  {{ tm("actions.add_to_collection") }}
                </LjButton>
              </template>
            </LjMenu>
          </div>

          <LjEmpty
            v-if="selectedCollectionSongs.length === 0"
            :title="tm('data.empty_collection_songs')"
          />
          <draggable
            v-else
            v-model="selectedCollectionSongs"
            item-key="id"
            handle=".cc-drag"
            @end="persistCollectionOrder"
          >
            <template #item="{ element }">
              <div class="cc-song-row lj-music-row">
                <span class="cc-drag">
                  <LjIcon :icon="ICONS.ACTIONS.DRAG" :size="16" />
                </span>
                <span class="cc-song-row__text">
                  <span class="cc-song-row__name">{{ element.nome }}</span>
                  <span class="cc-song-row__sub">
                    {{ element.slides.length }} {{ tm("labels.slides") }}
                  </span>
                </span>
                <MusicMenuTable
                  :id_music="0"
                  :name="element.nome"
                  :custom-song-id="element.id"
                  :has-audio="hasSung(element)"
                  :has_instrumental_music="hasPlayback(element)"
                  :align-with-catalog="false"
                  :defer-quick-actions="false"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.EDIT"
                  :title="tm('actions.edit')"
                  :aria-label="tm('actions.edit')"
                  @click="openInEditor(element)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.CLOSE"
                  :title="tm('actions.remove_from_collection')"
                  :aria-label="tm('actions.remove_from_collection')"
                  @click="removeSongFromCollection(element.id)"
                />
              </div>
            </template>
          </draggable>
        </template>
      </div>
    </div>

    <input ref="fileSlja" type="file" accept=".slja,.lja" multiple hidden @change="onImportSlja" />
    <LjToast
      v-model="importStatus.show"
      :text="importStatus.text"
      :variant="importStatus.variant"
      :timeout="3000"
    />
  </ModuleContainer>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import draggable from "vuedraggable";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import { LjButton, LjCard, LjEmpty, LjIcon, LjMenu, LjTabs, LjToast } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { MUSIC_EXECUTIONS, canExecute } from "@/config/MusicAction";
import Modules from "@/helpers/Modules";
import CustomSongs, { hasPlayback, hasSung } from "@/helpers/CustomSongs";
import { playCustomSong } from "@/helpers/CustomMusicCatalog";
import { downloadSongPackages, importSongFiles } from "@/helpers/CustomSongPackage";
import AudioLibrary from "@/helpers/AudioLibrary";
import $alert from "@/helpers/Alert";
import { useViewport } from "@/composables/useViewport";
import Platform from "@/helpers/Platform";

const SHARE_KEY = "slide_editor_song_v2";

const moduleContainer = ref(null);
const fileSlja = ref(null);

const activeTab = ref("songs");
const songs = ref([]);
const collections = ref([]);
const selectedCollectionId = ref(null);
const { width: viewportWidth } = useViewport();
const mobileLayout = computed(() => !Platform.isDesktop && viewportWidth.value <= 1000);
const collectionView = ref("list");

function openCollection(id) {
  selectedCollectionId.value = id;
  if (mobileLayout.value) collectionView.value = "detail";
}

// Cache de URLs de imagem do primeiro slide de cada música (preview do card).
const songPreviewImages = ref(new Map());

function songPreviewStyle(s) {
  const slide = s.slides?.[0] || {};
  const img = songPreviewImages.value.get(s.id);
  return {
    background: slide.cor_fundo || "var(--lj-color-projection-bg)",
    ...(img ? { backgroundImage: `url(${img})` } : {}),
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function songTextStyle(s) {
  return { color: s.slides?.[0]?.cor_letra || "var(--lj-white)" };
}

async function resolvePreviewImages(list) {
  const map = new Map();
  for (const s of list) {
    const tok = s.slides?.[0]?.imagem;
    if (!tok) continue;
    if (/^(https?|data|blob|file):/.test(tok)) {
      map.set(s.id, tok);
      continue;
    }
    const url = await AudioLibrary.resolveImage(tok);
    if (url) map.set(s.id, url);
  }
  songPreviewImages.value = map;
}

const tm = (key, named) => moduleContainer.value?.tm(key, named) || key;
const { t } = useI18n();

/** O que a música tem para tocar, para o cartão dizer antes de alguém abrir o menu. */
function tracksLabel(s) {
  if (hasSung(s) && hasPlayback(s)) return tm("labels.audio_playback");
  if (hasPlayback(s)) return tm("labels.playback_only");
  return hasSung(s) ? tm("labels.audio") : "";
}

const tabItems = computed(() => [
  { value: "songs", label: tm("tabs.songs") },
  { value: "collections", label: tm("tabs.collections") },
]);

const selectedCollection = computed(
  () => collections.value.find((c) => c.id === selectedCollectionId.value) || null
);

const selectedCollectionSongs = computed({
  get: () => {
    if (!selectedCollection.value) return [];
    return selectedCollection.value.song_ids
      .map((id) => songs.value.find((s) => s.id === id))
      .filter(Boolean);
  },
  set: async (val) => {
    if (!selectedCollection.value) return;
    selectedCollection.value.song_ids = val.map((s) => s.id);
    await CustomSongs.saveCollection(selectedCollection.value);
  },
});

const songsNotInSelected = computed(() => {
  if (!selectedCollection.value) return songs.value;
  const has = new Set(selectedCollection.value.song_ids);
  return songs.value.filter((s) => !has.has(s.id));
});

// ===== Menus =====

function songMenuItems(s) {
  const tracks = { sung: hasSung(s), playback: hasPlayback(s) };
  const execution = (item) => ({
    label: t(item.menuLabel || item.label),
    icon: item.icon,
    disabled: !canExecute(item, tracks),
    action: () => executeSong(s, item.action),
  });
  return [
    ...MUSIC_EXECUTIONS.filter((item) => !item.audioOnly).map(execution),
    { separator: true },
    ...MUSIC_EXECUTIONS.filter((item) => item.audioOnly).map(execution),
    { separator: true },
    { label: tm("actions.export"), icon: ICONS.ACTIONS.DOWNLOAD, action: () => exportSong(s) },
    { label: tm("actions.rename"), icon: ICONS.ACTIONS.RENAME, action: () => renameSong(s) },
  ];
}

function collectionMenuItems(c) {
  return [
    { label: tm("actions.rename"), icon: ICONS.ACTIONS.RENAME, action: () => renameCollection(c) },
    {
      label: tm("actions.delete"),
      icon: ICONS.ACTIONS.DELETE,
      action: () => confirmDeleteCollection(c),
    },
  ];
}

// Item desabilitado (e não rótulo) quando não há o que adicionar: o rótulo do
// LjMenu sai em caixa alta, e aqui o texto é uma frase inteira.
const addSongMenuItems = computed(() => {
  if (songsNotInSelected.value.length === 0) {
    return [{ label: tm("data.empty_songs"), disabled: true, action: () => undefined }];
  }
  return songsNotInSelected.value.map((s) => ({
    label: s.nome,
    action: () => addSongToCollection(s.id),
  }));
});

function truncate(text, max = 60) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 3) + "…" : text;
}

function askName(title, defaultValue) {
  return new Promise((resolve) => {
    $alert.prompt({ title, input_default: defaultValue }, (val) => resolve(val));
  });
}

async function loadAll() {
  songs.value = await CustomSongs.listSongs();
  collections.value = await CustomSongs.listCollections();
  resolvePreviewImages(songs.value);
  if (!selectedCollectionId.value && collections.value.length > 0) {
    selectedCollectionId.value = collections.value[0].id;
  }
}

function onShow(visible) {
  if (visible) loadAll();
}
function onClose() {}

onMounted(loadAll);

// ===== Songs =====

function openInEditor(s) {
  try {
    sessionStorage.setItem(SHARE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent("lj:open-song", { detail: s }));
  Modules.open("slide_editor");
}

// Executa a música no modo pedido; sem modo, o cantado (ou o playback, se só ele existe).
async function executeSong(s, action) {
  try {
    await playCustomSong(s, action);
  } catch (err) {
    console.warn("[custom_collections] executeSong falhou:", err);
  }
}

async function actNewSong() {
  const nome = await askName(tm("actions.new_song"), tm("actions.new_song"));
  if (!nome) return;
  const s = CustomSongs.newSong(nome);
  await CustomSongs.saveSong(s);
  openInEditor(s);
  await loadAll();
}

async function renameSong(s) {
  const nome = await askName(tm("actions.rename"), s.nome);
  if (!nome) return;
  s.nome = nome;
  await CustomSongs.saveSong(s);
  await loadAll();
}

async function confirmDeleteSong(s) {
  if (!(await $alert.confirm(tm("data.confirm_delete_song")))) return;
  await CustomSongs.deleteSong(s.id);
  await loadAll();
}

// Com cantado e playback saem dois arquivos, `Música.slja` e `Música -PB.slja`.
async function exportSong(s) {
  await downloadSongPackages(s);
}

function actImport() {
  fileSlja.value.click();
}

const importStatus = ref({ show: false, text: "", variant: "info" });

function showStatus(text, variant = "info") {
  importStatus.value = { show: true, text, variant };
}

async function onImportSlja(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;

  const result = await importSongFiles(files);
  let ok = 0;
  let paired = 0;
  let fail = result.failed;
  for (const song of result.songs) {
    try {
      await CustomSongs.saveSong(song);
      ok++;
      if (hasSung(song) && hasPlayback(song)) paired++;
    } catch {
      fail++;
    }
  }
  await loadAll();
  const { loose, unmatched } = result;
  const text =
    tm("data.import_result", { ok }) +
    (paired ? tm("data.import_paired", { paired }) : "") +
    (fail ? tm("data.import_failed", { fail }) : "") +
    (loose ? tm("data.import_without_media", { loose }) : "") +
    (unmatched ? tm("data.import_unmatched_playback", { unmatched }) : "");
  showStatus(text, fail || loose || unmatched ? "warning" : "success");
}

// ===== Collections =====

async function actNewCollection() {
  const nome = await askName(tm("actions.new_collection"), tm("actions.new_collection"));
  if (!nome) return;
  const c = CustomSongs.newCollection(nome);
  await CustomSongs.saveCollection(c);
  await loadAll();
  selectedCollectionId.value = c.id;
  if (mobileLayout.value) collectionView.value = "detail";
}

async function renameCollection(c) {
  const nome = await askName(tm("actions.rename"), c.nome);
  if (!nome) return;
  c.nome = nome;
  await CustomSongs.saveCollection(c);
  await loadAll();
}

async function confirmDeleteCollection(c) {
  if (!(await $alert.confirm(tm("data.confirm_delete_collection")))) return;
  await CustomSongs.deleteCollection(c.id);
  if (selectedCollectionId.value === c.id) selectedCollectionId.value = null;
  await loadAll();
}

async function addSongToCollection(songId) {
  const c = selectedCollection.value;
  if (!c) return;
  if (!c.song_ids.includes(songId)) c.song_ids.push(songId);
  await CustomSongs.saveCollection(c);
  await loadAll();
}

async function removeSongFromCollection(songId) {
  const c = selectedCollection.value;
  if (!c) return;
  c.song_ids = c.song_ids.filter((id) => id !== songId);
  await CustomSongs.saveCollection(c);
  await loadAll();
}

async function persistCollectionOrder() {
  if (!selectedCollection.value) return;
  await CustomSongs.saveCollection(selectedCollection.value);
}
</script>

<style scoped>
/* ---- barra de ferramentas do cabeçalho ---- */
.cc-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  width: 100%;
  min-width: 0;
}

/* ---- aba: músicas ---- */
.cc-pane {
  padding: var(--lj-space-4);
}

.cc-song-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-5);
}

.cc-song {
  width: 240px;
  cursor: pointer;
}

.cc-song:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* O fundo vem do slide (cor ou imagem), então o cartão é sempre escuro aqui —
   os botões flutuam sobre ele com uma cortina preta, como no original. */
.cc-song__preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  padding: var(--lj-space-4);
  overflow: hidden;
}

.cc-song__actions {
  position: absolute;
  top: var(--lj-space-2);
  right: var(--lj-space-2);
  z-index: 1;
  display: flex;
  gap: var(--lj-space-1);
}

.cc-song__actions :deep(.lj-btn) {
  background: var(--lj-black-alpha-40);
  border-color: transparent;
  color: var(--lj-white);
}

.cc-song__actions :deep(.lj-btn:hover) {
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
}

.cc-song__actions :deep(.lj-btn.cc-song__danger) {
  color: var(--lj-danger-light);
}

.cc-song__text {
  width: 100%;
  font-size: var(--lj-text-sm);
  text-align: center;
  white-space: pre-line;
  text-shadow: 0 1px 4px var(--lj-black-alpha-75);
}

.cc-song__info {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
  padding: var(--lj-space-4) var(--lj-space-5);
}

.cc-song__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.cc-song__meta {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}

/* ---- aba: coletâneas ---- */
.cc-collections {
  display: flex;
  height: 100%;
  min-height: 0;
}

.cc-col-list {
  flex-shrink: 0;
  width: 240px;
  overflow-y: auto;
  border-right: 1px solid var(--lj-surface-border);
}

.cc-col-items {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  margin: 0;
  padding: var(--lj-space-2);
  list-style: none;
}

.cc-col-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding-right: var(--lj-space-2);
  border-radius: var(--lj-radius-sm);
}

.cc-col-item:hover {
  background: var(--lj-surface-bg-hover);
}

.cc-col-item.is-active {
  background: var(--lj-ui-accent-soft);
}

.cc-col-item.is-active .cc-col-item__name {
  color: var(--lj-ui-accent-text);
  font-weight: var(--lj-weight-medium);
}

.cc-col-item__main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--lj-space-4);
  min-width: 0;
  padding: var(--lj-space-3) var(--lj-space-4);
  border: none;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
}

.cc-col-item__main:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.cc-col-item__text {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.cc-col-item__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cc-col-item__sub {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}

/* A cor vem do registro da coletânea (c.cor); o traço só separa o disco de
   fundos claros. */
.cc-col-dot {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 1px solid var(--lj-black-alpha-18);
  border-radius: var(--lj-radius-md);
}

.cc-col-empty {
  margin: 0;
  padding: var(--lj-space-6);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
  text-align: center;
}

.cc-col-detail {
  flex: 1;
  min-width: 0;
  padding: var(--lj-space-4);
  overflow-y: auto;
}

.cc-col-hint {
  margin: 0;
  padding: var(--lj-space-8);
  color: var(--lj-text-subtle);
  text-align: center;
}

.cc-col-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-4);
}

.cc-col-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-semibold);
}

.cc-song-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-3) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.cc-song-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.cc-song-row__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-base);
}

.cc-song-row__sub {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}

.cc-drag {
  display: inline-flex;
  color: var(--lj-text-subtle);
  cursor: grab;
}

@media (max-width: 1000px) {
  .cc-toolbar--mobile {
    flex-wrap: wrap;
    gap: var(--lj-space-2);
  }

  .cc-toolbar--mobile :deep(.lj-tabs) {
    width: 100%;
  }

  .cc-toolbar--mobile :deep(.lj-tabs__list) {
    width: 100%;
  }

  .cc-toolbar--mobile :deep(.lj-tabs__trigger) {
    flex: 1;
    justify-content: center;
    min-width: 0;
    min-height: 44px;
    padding-inline: var(--lj-space-2);
  }

  .cc-toolbar--mobile .lj-u-spacer {
    display: none;
  }

  .cc-toolbar--mobile :deep(.lj-btn) {
    flex: 1;
    min-height: 44px;
  }

  .cc-pane--mobile {
    min-width: 0;
    padding: var(--lj-space-3);
  }

  .cc-pane--mobile .cc-song-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: var(--lj-space-3);
  }

  .cc-pane--mobile .cc-song {
    width: 100%;
  }

  .cc-pane--mobile .cc-song__actions :deep(.lj-btn) {
    min-width: 40px;
    min-height: 40px;
  }

  .cc-collections--mobile {
    flex: 1;
    min-width: 0;
  }

  .cc-collections--mobile .cc-col-list,
  .cc-collections--mobile .cc-col-detail {
    width: 100%;
    min-width: 0;
    border-right: 0;
  }

  .cc-collections--mobile .cc-col-item__main {
    min-height: 56px;
  }

  .cc-collections--mobile .cc-col-item :deep(.lj-btn),
  .cc-collections--mobile .cc-song-row :deep(.lj-btn) {
    min-width: 40px;
    min-height: 40px;
  }

  .cc-collections--mobile .cc-col-detail {
    padding: var(--lj-space-3);
  }

  .cc-collections--mobile .cc-col-back {
    display: inline-flex;
    align-items: center;
    gap: var(--lj-space-2);
    min-height: 44px;
    margin-bottom: var(--lj-space-2);
    padding: 0 var(--lj-space-3);
    border: 0;
    border-radius: var(--lj-radius-sm);
    background: var(--lj-surface-bg-soft);
    color: var(--lj-text);
    font: inherit;
    cursor: pointer;
  }

  .cc-collections--mobile .cc-col-header {
    flex-wrap: wrap;
    gap: var(--lj-space-2);
  }

  .cc-collections--mobile .cc-col-header .lj-u-spacer {
    display: none;
  }

  .cc-collections--mobile .cc-col-title {
    width: 100%;
  }

  .cc-collections--mobile .cc-col-header :deep(.lj-btn) {
    min-height: 44px;
  }

  .cc-collections--mobile .cc-song-row {
    gap: var(--lj-space-2);
    min-height: 56px;
    padding-inline: var(--lj-space-2);
  }
}
</style>
