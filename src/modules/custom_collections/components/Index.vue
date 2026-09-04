<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @show="onShow" @close="onClose">
    <template #header>
      <div class="cc-toolbar">
        <LjTabs v-model="activeTab" :tabs="tabItems" :aria-label="t('title')" />
        <span class="lj-u-spacer" />
        <template v-if="activeTab === 'songs'">
          <LjButton size="sm" :icon="ICONS.ACTIONS.ADD" @click="actNewSong">
            {{ t("actions.new_song") }}
          </LjButton>
          <LjButton size="sm" variant="subtle" :icon="ICONS.ACTIONS.IMPORT" @click="actImport">
            {{ t("actions.import") }}
          </LjButton>
        </template>
        <LjButton v-else size="sm" :icon="ICONS.ACTIONS.ADD" @click="actNewCollection">
          {{ t("actions.new_collection") }}
        </LjButton>
      </div>
    </template>

    <!-- Aba: Músicas -->
    <div v-if="activeTab === 'songs'" class="cc-pane">
      <LjEmpty v-if="songs.length === 0" :title="t('data.empty_songs')" />
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
                :title="t('actions.edit')"
                :aria-label="t('actions.edit')"
                @click.stop="openInEditor(s)"
              />
              <LjButton
                size="sm"
                variant="ghost"
                icon-only
                class="cc-song__danger"
                :icon="ICONS.ACTIONS.DELETE"
                :title="t('actions.delete')"
                :aria-label="t('actions.delete')"
                @click.stop="confirmDeleteSong(s)"
              />
              <LjMenu :items="songMenuItems(s)" side="bottom" align="end">
                <template #trigger>
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.UI.DOTS_VERTICAL"
                    :title="t('actions.more')"
                    :aria-label="t('actions.more')"
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
              {{ s.slides.length }} {{ t("labels.slides") }}
              <template v-if="s.audio_token">· {{ t("labels.audio") }}</template>
            </span>
          </div>
        </LjCard>
      </div>
    </div>

    <!-- Aba: Coletâneas -->
    <div v-else class="cc-collections">
      <div class="cc-col-list">
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
              @click="selectedCollectionId = c.id"
            >
              <span class="cc-col-dot" :style="{ background: c.cor }" />
              <span class="cc-col-item__text">
                <span class="cc-col-item__name">{{ c.nome }}</span>
                <span class="cc-col-item__sub">
                  {{ c.song_ids.length }} {{ t("labels.songs_count") }}
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
                  :title="t('actions.more')"
                  :aria-label="t('actions.more')"
                  @click.stop
                />
              </template>
            </LjMenu>
          </li>
        </ul>
        <p v-else class="cc-col-empty">{{ t("data.empty_collections") }}</p>
      </div>

      <div class="cc-col-detail">
        <p v-if="!selectedCollection" class="cc-col-hint">←</p>
        <template v-else>
          <div class="cc-col-header">
            <h3 class="cc-col-title">{{ selectedCollection.nome }}</h3>
            <span class="lj-u-spacer" />
            <LjMenu :items="addSongMenuItems" side="bottom" align="end">
              <template #trigger>
                <LjButton size="sm" variant="subtle" :icon="ICONS.ACTIONS.ADD">
                  {{ t("actions.add_to_collection") }}
                </LjButton>
              </template>
            </LjMenu>
          </div>

          <LjEmpty
            v-if="selectedCollectionSongs.length === 0"
            :title="t('data.empty_collection_songs')"
          />
          <draggable
            v-else
            v-model="selectedCollectionSongs"
            item-key="id"
            handle=".cc-drag"
            @end="persistCollectionOrder"
          >
            <template #item="{ element }">
              <div class="cc-song-row">
                <span class="cc-drag">
                  <Icon :icon="ICONS.ACTIONS.DRAG" :size="16" />
                </span>
                <span class="cc-song-row__text">
                  <span class="cc-song-row__name">{{ element.nome }}</span>
                  <span class="cc-song-row__sub">
                    {{ element.slides.length }} {{ t("labels.slides") }}
                  </span>
                </span>
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.EDIT"
                  :title="t('actions.edit')"
                  :aria-label="t('actions.edit')"
                  @click="openInEditor(element)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.CLOSE"
                  :title="t('actions.remove_from_collection')"
                  :aria-label="t('actions.remove_from_collection')"
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
import draggable from "vuedraggable";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import Icon from "@/components/Icon.vue";
import { LjButton, LjCard, LjEmpty, LjMenu, LjTabs, LjToast } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Modules from "@/helpers/Modules";
import CustomSongs from "@/helpers/CustomSongs";
import SljaConverter from "@/helpers/SljaConverter";
import AudioLibrary from "@/helpers/AudioLibrary";
import $alert from "@/helpers/Alert";
import Media from "@/composables/useMedia";

const SHARE_KEY = "slide_editor_song_v2";

const moduleContainer = ref(null);
const fileSlja = ref(null);

const activeTab = ref("songs");
const songs = ref([]);
const collections = ref([]);
const selectedCollectionId = ref(null);

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

const t = (key, named) => moduleContainer.value?.t(key, named) || key;

const tabItems = computed(() => [
  { value: "songs", label: t("tabs.songs") },
  { value: "collections", label: t("tabs.collections") },
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
  return [
    { label: t("actions.export"), icon: ICONS.ACTIONS.DOWNLOAD, action: () => exportSong(s) },
    { label: t("actions.rename"), icon: ICONS.ACTIONS.RENAME, action: () => renameSong(s) },
  ];
}

function collectionMenuItems(c) {
  return [
    { label: t("actions.rename"), icon: ICONS.ACTIONS.RENAME, action: () => renameCollection(c) },
    {
      label: t("actions.delete"),
      icon: ICONS.ACTIONS.DELETE,
      action: () => confirmDeleteCollection(c),
    },
  ];
}

// Item desabilitado (e não rótulo) quando não há o que adicionar: o rótulo do
// LjMenu sai em caixa alta, e aqui o texto é uma frase inteira.
const addSongMenuItems = computed(() => {
  if (songsNotInSelected.value.length === 0) {
    return [{ label: t("data.empty_songs"), disabled: true, action: () => undefined }];
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

// Executa (projeta) a música personalizada com áudio e sincronia via Media.
async function executeSong(s) {
  try {
    await Media.openCustomSong(s);
  } catch (err) {
    console.warn("[custom_collections] executeSong falhou:", err);
  }
}

async function actNewSong() {
  const nome = await askName(t("actions.new_song"), t("actions.new_song"));
  if (!nome) return;
  const s = CustomSongs.newSong(nome);
  await CustomSongs.saveSong(s);
  openInEditor(s);
  await loadAll();
}

async function renameSong(s) {
  const nome = await askName(t("actions.rename"), s.nome);
  if (!nome) return;
  s.nome = nome;
  await CustomSongs.saveSong(s);
  await loadAll();
}

async function confirmDeleteSong(s) {
  if (!confirm(t("data.confirm_delete_song"))) return;
  await CustomSongs.deleteSong(s.id);
  await loadAll();
}

async function exportSong(s) {
  const slidesForExport = [];
  const imagesMap = new Map();
  for (const slide of s.slides) {
    const exp = { ...slide };
    if (slide.imagem) {
      const blob = await AudioLibrary.getImageBlob(slide.imagem);
      if (blob) {
        const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const baseName = `${slide.id}.${ext}`;
        const path = `imagens/${baseName}`;
        if (!imagesMap.has(path)) imagesMap.set(path, blob);
        exp.imagem = path;
      } else {
        exp.imagem = "";
        console.warn(
          `[custom_collections] export: blob da imagem não encontrado (${slide.imagem}) — slide sairá sem fundo`
        );
      }
    }
    slidesForExport.push(exp);
  }
  let audioBlob = null;
  if (s.audio_token) audioBlob = await AudioLibrary.getAudioBlob(s.audio_token);
  const blob = await SljaConverter.writeSlja({
    slides: slidesForExport,
    audio: audioBlob,
    audioName: s.audio_name || "audio.mp3",
    images: imagesMap,
    nome: s.nome || "",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${s.nome.replace(/[\\/:*?"<>|]/g, "_")}.slja`;
  a.click();
  URL.revokeObjectURL(url);
}

function actImport() {
  fileSlja.value.click();
}

const importStatus = ref({ show: false, text: "", variant: "info" });

function showStatus(text, variant = "info") {
  importStatus.value = { show: true, text, variant };
}

async function importSljaFile(file) {
  const data = await SljaConverter.loadSlja(file);

  // Capa/abertura sem fundo herda a imagem do próximo slide que a tenha.
  SljaConverter.fillMissingImages(data.slides);

  let audioToken = "";
  let audioName = "";
  if (data.audio) {
    audioName = (data.audioName || "audio.mp3").replace(/^audio\//, "");
    audioToken = await AudioLibrary.importAudio(data.audio, audioName);
  }
  const imgTokenByName = new Map();
  for (const [path, blob] of (data.images || new Map()).entries()) {
    const name = path.replace(/^(imagens|images)\//, "");
    const tok = await AudioLibrary.importImage(blob, name);
    imgTokenByName.set(name, tok);
    imgTokenByName.set(path, tok);
  }
  const newSong = {
    id: crypto.randomUUID(),
    // Nome: [Geral].nome → letra do 1º slide (capa) → nome do arquivo.
    nome: SljaConverter.resolveSongName(data, file.name),
    audio_token: audioToken,
    audio_name: audioName,
    slides: data.slides.map((s) => {
      const imgName = s.imagem ? s.imagem.split(/[\\/]/).pop() : "";
      const imgTok = imgName
        ? imgTokenByName.get(s.imagem) || imgTokenByName.get(imgName) || ""
        : "";
      if (s.imagem && !imgTok) {
        console.warn(
          `[custom_collections] import: imagem "${s.imagem}" referenciada mas ausente no pacote .slja`
        );
      }
      return {
        id: crypto.randomUUID(),
        tipo: s.tipo,
        letra: s.letra,
        letra_aux: s.letra_aux,
        tamanho_letra: s.tamanho_letra,
        tamanho_letra_aux: s.tamanho_letra_aux,
        cor_letra: s.cor_letra,
        cor_letra_aux: s.cor_letra_aux,
        cor_fundo: s.cor_fundo,
        imagem: imgTok,
        imagem_posicao: s.imagem_posicao,
        fundo_letra: s.fundo_letra,
        tempo_seconds: s.tempo_seconds,
        text_align: "center",
      };
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!newSong.slides.some((sl) => sl.tempo_seconds > 0)) {
    console.warn(
      "[custom_collections] import: arquivo .slja sem tempos de sincronia (todos tempo_seconds=0)"
    );
  }
  await CustomSongs.saveSong(newSong);
  return newSong;
}

async function onImportSlja(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;

  let ok = 0;
  let fail = 0;
  for (const f of files) {
    try {
      await importSljaFile(f);
      ok++;
    } catch {
      fail++;
    }
  }
  await loadAll();
  const text = t("data.import_result", { ok }) + (fail ? t("data.import_failed", { fail }) : "");
  showStatus(text, fail ? "warning" : "success");
}

// ===== Collections =====

async function actNewCollection() {
  const nome = await askName(t("actions.new_collection"), t("actions.new_collection"));
  if (!nome) return;
  const c = CustomSongs.newCollection(nome);
  await CustomSongs.saveCollection(c);
  await loadAll();
  selectedCollectionId.value = c.id;
}

async function renameCollection(c) {
  const nome = await askName(t("actions.rename"), c.nome);
  if (!nome) return;
  c.nome = nome;
  await CustomSongs.saveCollection(c);
  await loadAll();
}

async function confirmDeleteCollection(c) {
  if (!confirm(t("data.confirm_delete_collection"))) return;
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
</style>
