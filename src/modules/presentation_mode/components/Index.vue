<template>
  <ModuleContainer :manifest="manifest">
    <div
      ref="area"
      class="pm-area"
      :class="{ 'pm-area--library-wide': libraryLayout.fullWidth.value }"
      :style="{
        '--pm-library-h': `${libraryLayout.height.value}px`,
        '--pm-program-w': `${columns.program.value}px`,
        '--pm-outputs-w': `${columns.outputs.value}px`,
      }"
    >
      <ColumnResizeHandle
        v-for="col in ['program', 'outputs'] as const"
        :key="col"
        :column="col"
        :layout="columns"
      />
      <ProgramPanel
        :live-child-id="liveOrigin?.type === 'child' ? liveOrigin.childId : null"
        @activate="activate"
        @child-preview="
          (itemId: string, childId: string) => stage.show({ type: 'child', itemId, childId })
        "
        @child-play="
          (itemId: string, childId: string) => dispatch({ type: 'child', itemId, childId })
        "
        @preview="(id: string) => stage.show({ type: 'program', itemId: id })"
        @edit-item="openEditItem"
        @edit-session="openEditSession"
        @new-item="openNewItem"
        @new-session="openNewSession"
        @duplicate-item="duplicateItem"
        @remove-item="(id: string) => confirmRemoveItem(id)"
        @import="importFromLiturgy"
        @save="saveAsLiturgy"
        @settings="settingsDialogOpen = true"
      />

      <section class="pm-stage" data-testid="pm-stage">
        <header class="pm-bar">
          <span v-if="stagePreview" class="pm-preview-badge" data-testid="pm-stage-badge">
            {{ tm("stage.preview") }}
          </span>
          <span v-else-if="onAir" class="pm-on-air" data-testid="pm-stage-badge">
            <span class="pm-on-air__dot" />
            {{ tm("stage.on_air") }}
          </span>
          <LjIcon v-if="stageIcon" :icon="stageIcon" :size="14" />
          <span class="pm-bar__title" data-testid="pm-stage-title">{{ stageTitle }}</span>
          <span v-if="stageMeta" class="pm-bar__meta">{{ stageMeta }}</span>
          <div class="pm-bar__tools">
            <LjButton
              v-if="stagePreview && onAir"
              size="sm"
              :icon="ICONS.PROJECTION.START"
              data-testid="pm-stage-show-live"
              @click="focusLive"
            >
              {{ tm("stage.show_live") }}
            </LjButton>
            <ReturnControl :live-kind="liveKind" />
            <LjButton
              v-if="!stagePreview && liveKind"
              class="pm-bar__take-off"
              size="sm"
              :icon="ICONS.PLAYER.STOP_CIRCLE"
              :title="tm('outputs.take_off_title')"
              data-testid="pm-stage-take-off"
              @click="takeOff"
            >
              {{ tm("outputs.take_off") }}
            </LjButton>
            <LjButton
              size="sm"
              icon-only
              :icon="expanded ? ICONS.PLAYER.FULLSCREEN_EXIT : ICONS.PLAYER.FULLSCREEN"
              :title="expanded ? tm('actions.collapse') : tm('actions.expand')"
              data-testid="pm-toggle-expand"
              @click="toggleExpand"
            />
          </div>
        </header>
        <!-- Momento em prévia: os arquivos dele em grade; clicar manda ao ar. -->
        <MomentStage
          v-if="momentPreview"
          :item="momentPreview"
          :live-child-id="null"
          :locked="outputLocked"
          @pick="
            (childId: string) => dispatch({ type: 'child', itemId: momentPreview!.id, childId })
          "
        />
        <!-- Pasta do programa: em prévia, ou no ar com foto/PDF (vídeo vai ao player). -->
        <FolderStage
          v-else-if="folderOnStage"
          :item="folderOnStage"
          :live-path="liveOrigin?.type === 'folderFile' ? liveOrigin.entry.path : null"
          :return-path="returnOverride?.path ?? null"
          @play="
            (entry: LibraryEntry) =>
              dispatch({ type: 'folderFile', itemId: folderOnStage!.id, entry })
          "
          @stop="takeOff"
          @add="(added: ProgramItem) => addItem(added, ensureSession())"
          @show-on-return="
            (e: LibraryEntry | null) =>
              onShowOnReturn(e && { type: 'folderFile', itemId: folderOnStage!.id, entry: e })
          "
          @open-library="openFolderInLibrary(folderOnStage!)"
        />
        <StagePreview
          v-else-if="stagePreview && previewView"
          :view="previewView"
          @play="playPreview"
          @play-return="playPreviewOnReturn"
        />
        <!-- Arquivo de um momento no ar: vídeo com controles e a faixa dos outros; foto, a grade. -->
        <template v-else-if="liveMoment">
          <StageVideo v-if="showVideoStage" :locked="outputLocked" />
          <PdfStage v-else-if="pdfDeck.active.value" :locked="outputLocked" />
          <MomentStage
            :item="liveMoment"
            :live-child-id="liveOrigin?.type === 'child' ? liveOrigin.childId : null"
            :locked="outputLocked"
            :strip="showVideoStage || pdfDeck.active.value"
            @pick="
              (childId: string) => dispatch({ type: 'child', itemId: liveMoment!.id, childId })
            "
          />
        </template>
        <StageSlides
          v-else-if="showSlideGrid"
          :subtitle="liveProgramItem?.kind === 'music' ? liveProgramItem.subtitle : undefined"
          :locked="outputLocked"
        />
        <StageVideo v-else-if="showVideoStage" :locked="outputLocked" />
        <PdfStage v-else-if="pdfDeck.active.value" :locked="outputLocked" />
        <StageVideo v-else-if="audioLive" :locked="outputLocked" :audio-title="audioTitle" />
        <!-- Imagem, versículo, anúncio: o palco mostra o que está na tela. -->
        <div v-else-if="liveKind" class="pm-stage__preview" data-testid="pm-stage-preview">
          <div class="pm-stage__frame"><LiveMirror :cleared="false" /></div>
        </div>
        <div v-else class="pm-stage__body">
          <p class="pm-stage__empty">{{ tm("empty.stage") }}</p>
        </div>
        <!-- Vídeo só no retorno: o player dele fica no palco enquanto toca. -->
        <ReturnPlayerBar @close="onShowOnReturn(null)" />
      </section>

      <LibraryPanel
        v-model:tab="libraryTab"
        :full-width="libraryLayout.fullWidth.value"
        :tall="libraryLayout.tall.value"
        :height="libraryLayout.height.value"
        :live-path="libraryLivePath"
        :return-path="returnOverride?.path ?? null"
        :live-bible="liveBibleRef"
        :live-song-id="liveSongId"
        :live-video-id="liveOrigin?.type === 'online' ? liveOrigin.videoId : null"
        @show-on-return="onShowOnReturn"
        @preview="stage.show"
        @play="(p: Playable, options?: { mode: MusicMode }) => dispatch(p, options)"
        @add="(item: ProgramItem) => addItem(item, ensureSession())"
        @stop="takeOff"
        @toggle-width="libraryLayout.toggleWidth"
        @toggle-height="libraryLayout.toggleHeight"
        @resize="libraryLayout.drag"
        @resize-end="libraryLayout.saveHeight"
      />

      <OutputsPanel
        :up-next="upNextItem"
        :up-next-meta="upNextMeta"
        :prepared="!!preparedItemId"
        :locked="outputLocked"
        :can-navigate="canNavigate"
        :flash="upNextFlash"
        :on-air="!!liveKind"
        @take-off="takeOff"
        @first="navigate('first')"
        @prev="navigate('prev')"
        @next="navigate('next')"
        @last="navigate('last')"
        @toggle-lock="toggleLock"
        @send="sendUpNext"
      />
    </div>

    <!-- Um só diálogo de série: a barra da biblioteca e a do palco abrem o mesmo. -->
    <SeriesDialog />

    <ProgramItemDialog
      v-model="itemDialogOpen"
      :item="editingItem"
      :session-id="editingSessionId"
      :sessions="program.sessions"
      @save="onSaveItem"
      @remove="confirmRemoveItem(editingItem?.id ?? null)"
    />
    <ProgramSessionDialog
      v-model="sessionDialogOpen"
      :initial-label="editingSession?.label ?? null"
      @save="onSaveSession"
      @remove="confirmRemoveSession"
    />
    <ProgramSettingsDialog
      v-model="settingsDialogOpen"
      :planned-start="program.plannedStart"
      @save="setPlannedStart"
    />
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LjButton, LjIcon } from "@/components/ui";
import ModuleContainer from "@/components/ModuleContainer.vue";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import Telemetry from "@/helpers/Telemetry";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { isModuleExpanded, toggleModuleExpanded } from "@/composables/useModuleExpanded";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import ProgramPanel from "./ProgramPanel.vue";
import ProgramItemDialog from "./ProgramItemDialog.vue";
import ProgramSessionDialog from "./ProgramSessionDialog.vue";
import ProgramSettingsDialog from "./ProgramSettingsDialog.vue";
import OutputsPanel from "./OutputsPanel.vue";
import StageSlides from "./StageSlides.vue";
import StageVideo from "./StageVideo.vue";
import StagePreview from "./StagePreview.vue";
import MomentStage from "./MomentStage.vue";
import FolderStage from "./FolderStage.vue";
import SeriesDialog from "./SeriesDialog.vue";
import ReturnControl from "./ReturnControl.vue";
import ReturnPlayerBar from "./ReturnPlayerBar.vue";
import PdfStage from "./PdfStage.vue";
import { preparePowerPoint } from "../composables/usePowerPoint";
import { takeOffAir } from "../composables/takeOffAir";
import { returnOverrideFor } from "../composables/returnTarget";
import { useProgramDownloads } from "../composables/useCloudFiles";
import { programFilePaths } from "../program/paths";
import { useStage } from "../composables/useStage";
import { useStageNavigation } from "../composables/useStageNavigation";
import { useReturnBlankSync } from "../composables/useReturnVisibility";
import { claimVideo, resetOrphanScreens } from "../composables/useLayers";
import { useFolderItems } from "../composables/useFolderItems";
import {
  expectationOf,
  filePathOf,
  isOnAir,
  itemIdOf,
  playsVideo,
  samePlayable,
  type Playable,
} from "../program/playable";
import LibraryPanel, { type LibraryTab } from "./LibraryPanel.vue";
import LiveMirror from "./LiveMirror.vue";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { useFileLibrary, type LibraryEntry } from "../composables/useFileLibrary";
import Media from "@/composables/useMedia";
import { useSlides } from "@/composables/useSlides";
import { useLiveContent } from "../composables/useLiveContent";
import {
  cleared,
  returnOverride,
  setCleared,
  showOnReturn,
  startOutputs,
  stopOutputs,
} from "../composables/useOutputs";
import { formatHHMM, plannedStarts } from "../program/time";
import { useProgram } from "../composables/useProgram";
import {
  playCustomMusicInMode,
  playMusicInMode,
  useProgramExecution,
} from "../composables/useProgramExecution";
import { needsModeChoice, type MusicMode } from "../program/musicModes";
import { itemVideoId, openOnline } from "../composables/useOnlinePlayback";
import { useOnlinePrefetch } from "../composables/useOnlinePrefetch";
import { useSeriesRecorder } from "../composables/useSeries";
import { useClicker } from "../composables/useClicker";
import { previewViewOf } from "../program/previewView";
import { useLibraryLayout } from "../composables/useLibraryLayout";
import { useColumnLayout } from "../composables/useColumnLayout";
import { useStageHeader } from "../composables/useStageHeader";
import ColumnResizeHandle from "./ColumnResizeHandle.vue";
import { useProgramLiturgy } from "../composables/useProgramLiturgy";
import { useProgramEditing } from "../composables/useProgramEditing";
import { module as manifest } from "../manifest";

const moduleId = ModuleEnum.PRESENTATION_MODE;
const { tm } = useModuleI18n(moduleId);
/** O `$alert` traduz na hora de pintar: recebe a chave, não o texto. */
const alertKey = (key: string) => `modules.${moduleId}.${key}`;

const {
  program,
  selectedItemId,
  ensureLoaded,
  setPlannedStart,
  addItem,
  duplicateItem,
  goLive,
  toggleOpen,
  preparedItemId,
  upNextItem,
  outputLocked,
  setOutputLocked,
  prepare,
} = useProgram();
const { execute, executeChild, projectPath, sendBible } = useProgramExecution();
const { importFromLiturgy, saveAsLiturgy } = useProgramLiturgy();
const stage = useStage();
const folders = useFolderItems();
onBeforeUnmount(stage.reset);

onMounted(() => {
  void ensureLoaded();
  // A trava vale para o culto em andamento, não para a próxima abertura.
  if (outputLocked.value) setOutputLocked(false);
  // Telas abertas mostrando algo que ninguém controla (o app recarregou): voltam ao fundo.
  void resetOrphanScreens();
});

const expanded = computed(() => isModuleExpanded(moduleId));
/* ─── Biblioteca ─── */

const libraryLayout = useLibraryLayout();
const area = ref<HTMLElement | null>(null);
const columns = useColumnLayout(area);

function toggleExpand(): void {
  toggleModuleExpanded(moduleId);
}

/* ─── Ao vivo ─── */

function findItem(itemId: string): ProgramItem | null {
  for (const session of program.value.sessions) {
    const item = session.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

/** O item do programa por trás do que está no palco (o próprio, o momento, a pasta). */
function itemOf(playable: Playable | null | undefined): ProgramItem | null {
  const id = itemIdOf(playable);
  return id ? findItem(id) : null;
}

interface DispatchOptions {
  /** Música: slide em que ela entra. */
  slideIndex?: number;
  mode?: MusicMode;
  /** Ignora a trava — é o destravar mandando ao ar o que estava na fila. */
  force?: boolean;
}

/**
 * Única porta para o ar. Item com sub-itens só abre a lista e espera o
 * operador escolher. Com a saída travada, a tela fica como está: o item do
 * programa espera na fila; o resto não vai.
 */
function dispatch(
  playable: Playable,
  { slideIndex = 0, mode, force = false }: DispatchOptions = {}
): void {
  const item = itemOf(playable);
  if (itemIdOf(playable) && !item) return;
  // Momento: abrir o item manda o primeiro arquivo; o passador anda pelos outros.
  if (playable.type === "program" && item?.children?.length) {
    toggleOpen(item.id, true);
    dispatch({ type: "child", itemId: item.id, childId: item.children[0].id }, { force });
    return;
  }
  // Pasta: a série passa o próximo vídeo; a pasta comum abre no palco para o operador escolher.
  if (playable.type === "program" && item?.kind === "folder" && item.folder) {
    const folderItem = item;
    void folders.nextOf(item.folder).then((next) => {
      if (next) dispatch({ type: "folderFile", itemId: folderItem.id, entry: next }, { force });
      else stage.show(playable);
    });
    return;
  }
  // Música com a versão em aberto: vai para a prévia, e só entra no ar com a versão escolhida.
  if (playable.type === "program" && item && !mode && needsModeChoice(item)) {
    stage.show(playable);
    return;
  }
  if (outputLocked.value && !force) {
    if (item) prepare(item.id);
    return;
  }

  stage.show(playable);
  // Um vídeo por vez: o que estiver só no retorno sai antes deste entrar.
  if (playsVideo(playable, item)) claimVideo("screen");
  const expected = expectationOf(playable, item, mode);
  if (playable.type === "child" && item) {
    goLive(item.id);
    executeChild(item, playable.childId);
    Telemetry.track("presentation_moment_child_live", { kind: item.kind });
  } else if (playable.type === "folderFile" && item) {
    goLive(item.id);
    library.startQueue(playable.entry, folders.filesOf(item.folder ?? ""));
    projectPath(playable.entry.path, playable.entry.name);
    Telemetry.track("presentation_folder_file_live", {});
  } else if (item) {
    goLive(item.id);
    execute(item, mode);
    Telemetry.track("presentation_item_live", { kind: item.kind });
  } else if (playable.type === "file") {
    library.startQueue(playable.entry);
    projectPath(playable.entry.path, playable.entry.name);
    Telemetry.track("presentation_library_projected", { ext: playable.entry.ext });
  } else if (playable.type === "song") {
    if (playable.customId) playCustomMusicInMode(playable.customId, mode ?? "sung");
    else playMusicInMode(playable.id_music, mode ?? "sung");
  } else if (playable.type === "bible") {
    sendBible(playable.ref);
  } else if (playable.type === "online") {
    onlineQueue.start(playable.videoId);
    openOnline(playable.videoId, playable.title);
    Telemetry.track("presentation_library_online_projected", {});
  }
  stage.markSent(playable, expected);
  if (expected.songId) goToSlideWhenLoaded(expected.songId, slideIndex);
}

/** Duplo clique no programa. */
function activate(itemId: string, options?: DispatchOptions): void {
  dispatch({ type: "program", itemId }, options);
}

/* ─── Palco: prévia × ao vivo ─── */

/** Áudio no ar: não manda nada para as saídas, então não aparece no Broadcast. */
const audioLive = computed(
  () =>
    $appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false) === true &&
    !!$appdata.get<string>(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "") &&
    liveKind.value !== "music"
);
const audioTitle = computed(() => $appdata.get<string>(KEYS.MODULES.MEDIA.CONFIG.TITLE, "") ?? "");
const onAir = computed(() => !!liveKind.value || audioLive.value);

const liveSongId = computed(() => {
  const id = Number(slides.slides.value[0]?.id_music);
  return liveKind.value === "music" && id > 0 ? id : null;
});

/**
 * O que o módulo mandou ao ar, enquanto ainda é o que está no ar. Some
 * sozinho quando a tela passa a mostrar outra coisa — outro módulo, o Esc.
 */
const liveOrigin = computed<Playable | null>(() => {
  const sent = stage.sent.value;
  if (!sent) return null;
  const signal = {
    kind: liveKind.value,
    audio: audioLive.value,
    songId: liveSongId.value,
    customSongId:
      liveKind.value === "music"
        ? ((slides.slides.value[0]?.custom_song_id as string | undefined) ?? null)
        : null,
    passage: live.bible.value?.passage ?? null,
    // O ID vale enquanto o vídeo for o que está por cima na tela.
    videoId:
      liveKind.value === "file" || liveKind.value === "online_video"
        ? live.onlineVideoId.value
        : null,
  };
  return isOnAir(sent.expected, signal) ? sent.playable : null;
});

/** O item em prévia é o que está no ar? Então o palco é o controle dele. */
const previewIsLive = computed(() => {
  const t = stage.preview.value;
  if (!t) return true;
  if (liveOrigin.value && samePlayable(t, liveOrigin.value)) return true;
  // Música tocada de outro módulo: os slides no ar dizem qual é.
  return t.type === "song" && t.id_music === liveSongId.value;
});

const stagePreview = computed(() => !!stage.preview.value && !previewIsLive.value);
const previewView = computed(() => {
  const t = stage.preview.value;
  return t ? previewViewOf(t, itemOf(t)) : null;
});

/**
 * Clique num slide da prévia: a música vai ao ar e, quando os slides dela
 * chegarem, salta para o slide escolhido. Só uma espera por vez: mandar outra
 * coisa ao ar cancela a anterior.
 */
let cancelSlideWait: (() => void) | null = null;
function goToSlideWhenLoaded(idMusic: number, index: number): void {
  cancelSlideWait?.();
  cancelSlideWait = null;
  if (index <= 0) return;
  const stop = watch(
    () => [slides.totalSlides.value, slides.slides.value[0]?.id_music] as const,
    ([total, id]) => {
      if (total <= index || Number(id) !== idMusic) return;
      cancel();
      Media.goToSlide(index);
    },
    { immediate: true }
  );
  const timer = setTimeout(() => cancel(), 15000);
  function cancel(): void {
    stop();
    clearTimeout(timer);
    if (cancelSlideWait === cancel) cancelSlideWait = null;
  }
  cancelSlideWait = cancel;
}
onBeforeUnmount(() => cancelSlideWait?.());

function playPreview(slideIndex = 0, mode?: MusicMode): void {
  const t = stage.preview.value;
  if (t) dispatch(t, { slideIndex, mode });
}

/** Foto ou vídeo só no retorno de palco (biblioteca, programa, YouTube); `null` tira. */
async function onShowOnReturn(target: Playable | null): Promise<void> {
  if (!target) return showOnReturn(null);
  const item = itemOf(target);
  const override = await returnOverrideFor(target, item);
  if (!override) return;
  // Um vídeo por vez: o da tela principal sai antes deste tocar no retorno.
  if (override.type === "video") claimVideo("return");
  await showOnReturn(override);
}

function playPreviewOnReturn(): void {
  if (stage.preview.value) void onShowOnReturn(stage.preview.value);
}

function focusLive(): void {
  if (liveOrigin.value) stage.show(liveOrigin.value);
  else if (liveSongId.value)
    stage.show({ type: "song", id_music: liveSongId.value, title: slides.title.value });
  else stage.show(null);
}

/* ─── Palco ─── */

/** A grade aparece para qualquer música no ar — do programa ou tocada de outro módulo. */
const showSlideGrid = computed(() => liveKind.value === "music" && slides.totalSlides.value > 0);

/** Vídeo no ar — arquivo local ou on-line — ganha o palco com controles. */
const showVideoStage = computed(
  () =>
    liveKind.value === "online_video" ||
    (liveKind.value === "file" && live.file.value?.type === "video")
);

/** O item do programa no ar — o próprio, ou o momento do filho que está no ar. */
/** Momento (ou anúncios) em prévia: o palco mostra a grade dos arquivos dele. */
const momentPreview = computed(() => {
  const t = stage.preview.value;
  if (!stagePreview.value || t?.type !== "program") return null;
  const item = findItem(t.itemId);
  return item && (item.kind === "moment" || item.children?.length) ? item : null;
});

/**
 * A pasta do programa no palco: a que está em prévia, ou a de onde saiu o
 * arquivo no ar (menos vídeo, que fica com o player).
 */
const folderOnStage = computed<ProgramItem | null>(() => {
  const t = stage.preview.value;
  if (stagePreview.value) {
    const item = t?.type === "program" ? findItem(t.itemId) : null;
    return item?.kind === "folder" ? item : null;
  }
  return liveOrigin.value?.type === "folderFile" && !showVideoStage.value
    ? liveProgramItem.value
    : null;
});

/** Abre a pasta do item na aba Arquivos da biblioteca. */
function openFolderInLibrary(item: ProgramItem): void {
  if (!item.folder) return;
  libraryTab.value = "files";
  void library.openPath(item.folder);
}

/** O momento cujo arquivo está no ar. */
const liveMoment = computed(() =>
  liveOrigin.value?.type === "child" ? liveProgramItem.value : null
);

const liveProgramItem = computed(() => {
  const origin = liveOrigin.value;
  return itemOf(origin);
});

function goToSlidePrompt(): void {
  if (!showSlideGrid.value || outputLocked.value) return;
  $alert.prompt({ title: alertKey("stage.go_to_slide_title") }, (value: string | null) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= slides.totalSlides.value) Media.goToSlide(n - 1);
  });
}

/* ─── Saídas ─── */

const slides = useSlides();
const live = useLiveContent();
const liveKind = live.current;
// Tipo escondido no retorno: o retorno mostra só o fundo enquanto ele está no ar.
useReturnBlankSync(liveKind);

const { stageIcon, stageTitle, stageMeta } = useStageHeader({
  stagePreview,
  previewView,
  liveKind,
  liveOrigin,
  liveProgramItem,
  audioLive,
  audioTitle,
  findItem,
});

/** O arquivo no ar saiu da biblioteca? Então a grade o destaca. */
const library = useFileLibrary();
const libraryQueueLive = computed(() => {
  const q = library.queue.value;
  const origin = liveOrigin.value;
  const fromQueue = origin?.type === "file" || origin?.type === "folderFile";
  return !!q && fromQueue && q.entries[q.index]?.path === origin.entry.path;
});

/** Trecho da Bíblia que o módulo pôs no ar — da biblioteca ou de um item do programa. */
const liveBibleRef = computed<ProgramBibleRef | null>(() => {
  const origin = liveOrigin.value;
  if (origin?.type === "bible") return origin.ref;
  return liveProgramItem.value?.bible ?? null;
});

/** Arquivo da biblioteca que está no ar — borda de destaque e ✕ na grade. */
const libraryLivePath = computed(() => {
  const q = library.queue.value;
  return libraryQueueLive.value && q ? q.entries[q.index].path : null;
});

/** Tira do ar o que está na tela, mantendo a apresentação aberta. */
function takeOff(): void {
  Telemetry.track("presentation_take_off", { kind: liveKind.value });
  takeOffAir(liveKind.value);
  stage.clearSent();
}
watch(liveKind, (kind) => $appdata.set(KEYS.MODULES.PRESENTATION_MODE.CAN_TAKE_OFF, !!kind), {
  immediate: true,
});

const upNextFlash = ref(false);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flashUpNext(): void {
  upNextFlash.value = true;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (upNextFlash.value = false), 700);
}

/* ─── Anterior/Próximo ─── */

const { canNavigate, navigate, onlineQueue, pdfDeck } = useStageNavigation({
  liveKind,
  findItem,
  dispatch,
  projectPath,
  outputLocked,
  onEnd: flashUpNext,
});

// Passador e teclado: o mesmo Anterior/Próximo das saídas; "B" e "." alternam a tela preta.
useClicker({ navigate, toggleBlack: () => setCleared(!cleared.value) });

const pathOf = (p: Playable | null) => filePathOf(p, itemOf(p));

useSeriesRecorder(() => pathOf(liveOrigin.value));

// Arquivos do programa que estão só na nuvem descem antes do culto.
useProgramDownloads(() => [
  ...programFilePaths(program.value),
  ...program.value.sessions
    .flatMap((s) => s.items)
    .flatMap((i) => (i.kind === "folder" && i.folder ? folders.neededPathsOf(i.folder) : [])),
]);

// PowerPoint no palco já começa a converter: na hora de mandar, o PDF está pronto.
watch(stage.preview, (p) => {
  const item = p?.type === "program" ? findItem(p.itemId) : null;
  for (const path of [pathOf(p), ...(item?.children ?? []).map((c) => c.path)])
    if (path) preparePowerPoint(path);
});

useOnlinePrefetch(() => {
  const preview = stage.preview.value;
  return [
    preview?.type === "online"
      ? preview.videoId
      : preview?.type === "program"
        ? itemVideoId(findItem(preview.itemId))
        : null,
    itemVideoId(upNextItem.value),
    onlineQueue.nextId.value,
  ];
});

const upNextMeta = computed(() => {
  const item = upNextItem.value;
  if (!item) return "";
  const start = plannedStarts(program.value).get(item.id);
  return [item.subtitle, start === undefined ? "" : formatHHMM(start)].filter(Boolean).join(" · ");
});

function sendUpNext(): void {
  const item = upNextItem.value;
  if (!item) return;
  if (item.id === preparedItemId.value) prepare(null);
  activate(item.id);
}

/** Destravar manda ao ar o que ficou na fila. */
function toggleLock(): void {
  const locking = !outputLocked.value;
  setOutputLocked(locking);
  if (locking) return;
  const queued = preparedItemId.value;
  prepare(null);
  if (queued) activate(queued, { force: true });
}

/* ─── Itens e sessões: os diálogos de edição do programa ─── */

const {
  itemDialogOpen,
  editingItem,
  editingSessionId,
  ensureSession,
  openNewItem,
  openEditItem,
  onSaveItem,
  confirmRemoveItem,
  duplicateSelected,
  sessionDialogOpen,
  editingSession,
  openNewSession,
  openEditSession,
  onSaveSession,
  confirmRemoveSession,
} = useProgramEditing({ findItem, tm, alertKey });

/* ─── Programa ─── */

const settingsDialogOpen = ref(false);

// Todas as ações do ribbon contextual chegam aqui. As que ainda não têm
// handler são ignoradas até a fase que as implementa.
const libraryTab = ref<LibraryTab>("files");

const RIBBON_HANDLERS: Record<string, () => void> = {
  toggle_expand: toggleExpand,
  new_session: openNewSession,
  new_item: openNewItem,
  duplicate: duplicateSelected,
  delete_item: () => confirmRemoveItem(selectedItemId.value),
  import_liturgy: importFromLiturgy,
  save_program: saveAsLiturgy,
  start: () => void startOutputs(),
  stop: () => void stopOutputs(),
  clear: () => setCleared(true),
  take_off: takeOff,
  previous: () => navigate("prev"),
  next: () => navigate("next"),
  lock_output: toggleLock,
  go_to_slide: goToSlidePrompt,
  library_files: () => (libraryTab.value = "files"),
  library_musics: () => (libraryTab.value = "musics"),
  library_bible: () => (libraryTab.value = "bible"),
  library_videos: () => (libraryTab.value = "online"),
  slide_grid: focusLive,
};

useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload) => {
  const data = payload as { module?: string; action?: string } | null;
  if (data?.module !== moduleId || !data.action) return;
  RIBBON_HANDLERS[data.action]?.();
});
</script>

<style scoped>
/* Tudo encolhe no fluxo: nenhum painel se sobrepõe ao outro. */
.pm-area {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--pm-program-w, 282px) minmax(0, 1fr) var(--pm-outputs-w, 306px);
  grid-template-rows: minmax(150px, 1fr) auto;
  background: var(--lj-live-area-bg);
  font-size: var(--lj-text-md);
}

.pm-area > * {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--lj-surface-bg);
}

.pm-program {
  grid-column: 1;
  grid-row: 1 / 3;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-stage {
  grid-column: 2;
  grid-row: 1;
  background: var(--lj-live-stage-bg);
}

.pm-library {
  grid-column: 2;
  grid-row: 2;
  /* O arraste já respeita o palco mínimo; o teto cobre a janela que encolheu depois. */
  height: var(--pm-library-h);
  max-height: 70vh;
}

.pm-outputs {
  grid-column: 3;
  grid-row: 1 / 3;
  overflow-y: auto;
  border-left: 1px solid var(--lj-surface-border);
}

.pm-area--library-wide .pm-program {
  grid-row: 1;
}

/* Biblioteca de largura total: a alça do programa só cobre a linha de cima. */
.pm-area--library-wide > .pm-col-resize--program {
  grid-row: 1;
}

.pm-area--library-wide .pm-library {
  grid-column: 1 / 3;
}

.pm-bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: 30px;
  padding: 0 var(--lj-space-4);
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-bottom: 1px solid var(--lj-surface-border);
  color: var(--lj-text-muted);
}

.pm-bar--soft {
  background: var(--lj-surface-bg-soft);
}

.pm-bar__accent {
  color: var(--lj-orange);
}

.pm-preview-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border: 1px solid var(--lj-navy-active);
  border-radius: 3px;
  color: var(--lj-text);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-on-air {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-on-air__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lj-white);
  animation: pm-on-air-pulse 1.6s infinite;
}

@keyframes pm-on-air-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.pm-bar__meta {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-bar__title {
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Vermelho no texto: o botão cheio de vermelho é o de parar a apresentação. */
.pm-bar__take-off {
  color: var(--lj-danger);
}

.pm-bar__tools {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  margin-left: auto;
  flex-shrink: 0;
}

.pm-panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--lj-space-4);
}

.pm-stage__body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* O palco é escuro em qualquer tema; o texto não pode seguir o tema. */
.pm-stage__preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  container-type: size;
}

/* O maior 16:9 que cabe no palco, sem sobrepor a biblioteca. */
.pm-stage__frame {
  width: min(100cqw, calc(100cqh * 16 / 9));
}

.pm-stage__empty {
  margin: 0;
  color: var(--lj-white-alpha-50);
}
</style>
