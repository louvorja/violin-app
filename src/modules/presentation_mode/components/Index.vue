<template>
  <ModuleContainer :manifest="manifest">
    <div
      ref="area"
      class="pm-area"
      :class="{
        'pm-area--library-wide': libraryLayout.fullWidth.value,
        'pm-area--no-program': programHidden,
      }"
      :style="{
        '--pm-library-h': `${libraryLayout.height.value}px`,
        '--pm-program-w': programHidden ? '0px' : `${columns.program.value}px`,
        '--pm-outputs-w': `${columns.outputs.value}px`,
      }"
    >
      <ColumnResizeHandle
        v-for="col in programHidden ? (['outputs'] as const) : (['program', 'outputs'] as const)"
        :key="col"
        :column="col"
        :layout="columns"
      />
      <ProgramPanel
        v-if="!programHidden"
        :live-child-id="liveOrigin?.type === 'child' ? liveOrigin.childId : null"
        :live-history-id="liveHistoryId"
        @replay="
          (entry: HistoryEntry) =>
            dispatch(entry.playable, { mode: entry.mode, muted: entry.muted })
        "
        @save-history="saveHistoryAsProgram"
        @activate="activate"
        @child-preview="
          (itemId: string, childId: string) => stage.show({ type: 'child', itemId, childId })
        "
        @child-play="
          (itemId: string, childId: string) => dispatch({ type: 'child', itemId, childId })
        "
        @preview="previewItem"
        @edit-item="openEditItem"
        @edit-session="openEditSession"
        @new-item="openNewItem"
        @new-session="openNewSession"
        @duplicate-item="duplicateItem"
        @remove-item="(id: string) => confirmRemoveItem(id)"
        @import="importFromLiturgy"
        @save="saveAsLiturgy"
        @settings="settingsDialogOpen = true"
      >
        <template #foot>
          <UpNextBlock
            :up-next="upNextItem"
            :previous="previousItem"
            :meta="upNextMeta"
            :prepared="!!preparedItemId"
            :locked="outputLocked"
            :flash="upNextFlash"
            @send="sendUpNext"
            @previous="sendPrevious"
            @toggle-lock="toggleLock"
          />
        </template>
      </ProgramPanel>

      <section class="pm-stage" data-testid="pm-stage">
        <header class="pm-bar">
          <span v-if="stagePreview" class="pm-preview-badge" data-testid="pm-stage-badge">
            {{ tm("stage.preview") }}
          </span>
          <!-- Reproduzir não é apresentar: o selo diz se está nas telas, e em quais. -->
          <span
            v-else-if="onAir && (screenOn.main || screenOn.stage)"
            class="pm-on-air"
            data-testid="pm-stage-badge"
          >
            <span class="pm-on-air__dot" />
            {{ tm("stage.on_air") }}{{ onAirWhere }}
          </span>
          <span v-else-if="onAir" class="pm-playing-only" data-testid="pm-stage-badge">
            {{ tm("stage.playing_not_presenting") }}
          </span>
          <!-- Na prévia de outra coisa, o aviso de som fora das telas continua à vista. -->
          <span
            v-if="stagePreview && onAir && !screenOn.main && !screenOn.stage"
            class="pm-playing-only"
            data-testid="pm-stage-playing-warning"
          >
            {{ tm("stage.playing_not_presenting") }}
          </span>
          <LjIcon v-if="stageIcon" :icon="stageIcon" :size="14" />
          <span class="pm-bar__title" data-testid="pm-stage-title">{{ stageTitle }}</span>
          <span v-if="stageMeta" class="pm-bar__meta">{{ stageMeta }}</span>
          <div class="pm-bar__tools">
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
        <!-- PowerPoint convertendo: o que está acontecendo e quanto falta. -->
        <PptxProgress />
        <div class="pm-stage__main">
          <!-- Prévia: o que está no ar fica em miniatura no canto; clicar volta para ele. -->
          <LivePip
            v-if="stagePreview && onAir"
            :title="liveTitle"
            :audio-only="audioLive"
            :progress="livePipProgress"
            @focus="focusLive"
          />
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
          <StagePreview
            v-else-if="stagePreview && previewView"
            :view="previewView"
            @play="playPreview"
            @play-return="playPreviewOnReturn"
            @play-muted="stage.preview.value && dispatch(stage.preview.value, { muted: true })"
          />
          <!-- Música e PDF: a grade de hoje. Pasta e momento no ar não repetem os arquivos aqui. -->
          <StageSlides v-else-if="showSlideGrid" :locked="outputLocked" />
          <!-- PDF ampliado: o visor mostra o recorte; "Ajustar" volta à grade das páginas. -->
          <PdfStage
            v-else-if="pdfDeck.active.value && liveZoom.scale.value <= 1"
            :locked="outputLocked"
            :pptx-path="livePptxPath"
            @regenerated="reprojectPowerPoint"
          />
          <!-- Vídeo, imagem, versículo, anúncio: o visor mostra o que está na tela. -->
          <StageVisor v-else-if="liveKind" />
          <!-- Só a música no ar (nada nas telas): o visor mostra o que está tocando. -->
          <StageVisor v-else-if="audioLive" :audio-title="audioTitle" />
          <div v-else class="pm-stage__body">
            <p class="pm-stage__empty">{{ tm("empty.stage") }}</p>
          </div>
        </div>
        <PreviewBand
          v-if="stagePreview"
          :title="stageTitle"
          :can-present="canPresentPreview"
          :needs-mode="!!previewView?.needsMode"
          @discard="focusLive"
          @present="presentPreview"
        />
        <!-- Vídeo só no retorno: o player dele fica no palco enquanto toca. -->
        <ReturnPlayerBar @close="onShowOnReturn(null)" />
        <!-- Vídeo dentro de uma pasta ou momento: a barra anda pelos arquivos; o tempo dele fica aqui. -->
        <LivePlayerBar
          v-if="position && transport.isVideo.value"
          layer="video"
          :player="transport.player"
          :title="liveTitle"
          :locked="outputLocked"
        />
        <!-- Música por baixo da foto: a barra de baixo é da foto; a música tem esta faixa. -->
        <LivePlayerBar
          v-if="transport.audioUnder.value"
          layer="audio"
          :player="transport.player"
          :title="audioTitle"
          :locked="outputLocked"
          @stop="stopAudio"
        />
        <!-- Uma barra para tudo o que vai ao ar: controla sempre o que está no ar, nunca a prévia. -->
        <ControlBar
          :transport="transport"
          :live-kind="liveKind"
          :audio-live="audioLive"
          :live-title="liveTitle"
          :position="position"
          :can-navigate="canNavigate"
          :locked="outputLocked"
          :can-take-off="canTakeOff"
          :up-next-title="upNextItem?.title ?? null"
          @navigate="navigate"
          @take-off="takeOff"
        />
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
        :program-folder="programFolder"
        @show-on-return="onShowOnReturn"
        @preview="stage.show"
        @play="(p: Playable, options?: PlayOptions) => dispatch(fromProgramFolder(p), options)"
        @close-program-folder="programFolder = null"
        @add="(item: ProgramItem) => addItem(item, ensureSession())"
        @stop="takeOff"
        @toggle-width="libraryLayout.toggleWidth"
        @toggle-height="libraryLayout.toggleHeight"
        @resize="libraryLayout.drag"
        @resize-end="libraryLayout.saveHeight"
      />

      <OutputsPanel :up-next="upNextItem" :live-kind="liveKind" :on-air="onAir" />
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
import Telemetry from "@/helpers/Telemetry";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { isModuleExpanded, toggleModuleExpanded } from "@/composables/useModuleExpanded";
import type { ProgramItem } from "@/types/Presentation";
import ProgramPanel from "./ProgramPanel.vue";
import ProgramItemDialog from "./ProgramItemDialog.vue";
import ProgramSessionDialog from "./ProgramSessionDialog.vue";
import ProgramSettingsDialog from "./ProgramSettingsDialog.vue";
import OutputsPanel from "./OutputsPanel.vue";
import StageSlides from "./StageSlides.vue";
import StageVisor from "./StageVisor.vue";
import ControlBar from "./ControlBar.vue";
import PreviewBand from "./PreviewBand.vue";
import LivePip from "./LivePip.vue";
import LivePlayerBar from "./LivePlayerBar.vue";
import StagePreview from "./StagePreview.vue";
import MomentStage from "./MomentStage.vue";
import SeriesDialog from "./SeriesDialog.vue";
import UpNextBlock from "./UpNextBlock.vue";
import ReturnPlayerBar from "./ReturnPlayerBar.vue";
import PdfStage from "./PdfStage.vue";
import PptxProgress from "./PptxProgress.vue";
import { isPowerPoint, preparePowerPoint } from "../composables/usePowerPoint";
import { usePptxNative } from "../composables/usePptxNative";
import { takeOffAir } from "../composables/takeOffAir";
import { returnOverrideFor } from "../composables/returnTarget";
import { useProgramDownloads } from "../composables/useCloudFiles";
import { programFilePaths } from "../program/paths";
import { useStage } from "../composables/useStage";
import { useStageNavigation } from "../composables/useStageNavigation";
import { useReturnBlankSync } from "../composables/useReturnVisibility";
import { claimScreen, claimVideo, resetOrphanScreens } from "../composables/useLayers";
import { useFolderItems } from "../composables/useFolderItems";
import { usePlayerMute } from "../composables/usePlayerMute";
import {
  expectationOf,
  filePathOf,
  isOnAir,
  itemIdOf,
  playsVideo,
  samePlayable,
  type Playable,
  type PlayOptions,
} from "../program/playable";
import LibraryPanel, { LIBRARY_TABS, type LibraryTab } from "./LibraryPanel.vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useFileLibrary } from "../composables/useFileLibrary";
import { useLibraryLiveMarks } from "../composables/useLibraryLiveMarks";
import { useFlash } from "../composables/useFlash";
import { useSlideWait } from "../composables/useSlideWait";
import Media from "@/composables/useMedia";
import { useSlides } from "@/composables/useSlides";
import { useLiveContent } from "../composables/useLiveContent";
import {
  cleared,
  returnOverride,
  screenOn,
  setCleared,
  showOnReturn,
  startOutputs,
  stopOutputs,
} from "../composables/useOutputs";
import { formatHHMM, plannedStarts } from "../program/time";
import { newId, useProgram } from "../composables/useProgram";
import { useAirHistory } from "../composables/useAirHistory";
import { historyItem, type HistoryEntry } from "../program/history";
import {
  playCustomMusicInMode,
  playMusicInMode,
  useProgramExecution,
} from "../composables/useProgramExecution";
import { needsModeChoice, type MusicMode } from "../program/musicModes";
import { useMusicOverride } from "../composables/useMusicOverride";
import { isPending } from "../program/models";
import { itemVideoId, openOnline } from "../composables/useOnlinePlayback";
import { useOnlinePrefetch } from "../composables/useOnlinePrefetch";
import { useSeriesRecorder } from "../composables/useSeries";
import { useClicker } from "../composables/useClicker";
import { useLiveTransport } from "../composables/useLiveTransport";
import { useLiveZoom } from "../composables/useLiveZoom";
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
  setSessions,
  addItem,
  duplicateItem,
  goLive,
  toggleOpen,
  preparedItemId,
  upNextItem,
  previousItem,
  outputLocked,
  setOutputLocked,
  prepare,
} = useProgram();
const { execute, executeChild, projectPath, projectCanva, projectPdf, sendBible } = useProgramExecution();
const { importFromLiturgy, saveAsLiturgy } = useProgramLiturgy();
const stage = useStage();
const folders = useFolderItems();
const playerMute = usePlayerMute();
onBeforeUnmount(stage.reset);

onMounted(() => {
  void ensureLoaded();
  // A trava vale para o culto em andamento, não para a próxima abertura.
  if (outputLocked.value) setOutputLocked(false);
  // Telas abertas mostrando algo que ninguém controla (o app recarregou): voltam ao fundo.
  void resetOrphanScreens();
});

const expanded = computed(() => isModuleExpanded(moduleId));
/** Ribbon → Exibição → Mostrar programa: o palco fica com a largura da coluna. */
const programHidden = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.PRESENTATION_MODE.PROGRAM_HIDDEN, false) === true
);
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

interface DispatchOptions extends PlayOptions {
  /** Música: slide em que ela entra. */
  slideIndex?: number;
  /** Ignora a trava — é o destravar mandando ao ar o que estava na fila. */
  force?: boolean;
}

// Clique num slide da prévia: a música vai ao ar e salta para ele quando carregar.
const { goToSlideWhenLoaded } = useSlideWait();

/**
 * Única porta para o ar. Item com sub-itens só abre a lista e espera o
 * operador escolher. Com a saída travada, a tela fica como está: o item do
 * programa espera na fila; o resto não vai.
 */
function dispatch(
  playable: Playable,
  { slideIndex = 0, mode, muted = false, force = false }: DispatchOptions = {}
): void {
  const item = itemOf(playable);
  if (itemIdOf(playable) && !item) return;
  // Momento: abrir o item manda o primeiro arquivo; o passador anda pelos outros.
  if (playable.type === "program" && item?.children?.length) {
    toggleOpen(item.id, true);
    dispatch({ type: "child", itemId: item.id, childId: item.children[0].id }, { force });
    return;
  }
  // Item que ainda não tem conteúdo (ESCOLHER): só o marcador do programa anda.
  if (playable.type === "program" && item && isPending(item)) {
    markOnly(item, force);
    return;
  }
  // Pasta: a série passa o próximo vídeo; a pasta comum abre na biblioteca para o operador escolher.
  // O marcador anda já: pasta vazia ou à espera da escolha também é o momento do culto.
  if (playable.type === "program" && item?.kind === "folder" && item.folder) {
    const folderItem = item;
    markOnly(folderItem, force);
    openProgramFolder(folderItem);
    void folders.nextOf(item.folder).then((next) => {
      if (next) dispatch({ type: "folderFile", itemId: folderItem.id, entry: next }, { force });
    });
    return;
  }
  // Versão de todas as músicas escolhida no topo: a música em aberto já sabe como ir.
  if (playable.type === "program" && item && !mode && needsModeChoice(item) && musicOverride.value)
    mode = musicOverride.value;
  // Música com a versão em aberto: vai para a prévia, e só entra no ar com a versão escolhida.
  if (playable.type === "program" && item && !mode && needsModeChoice(item)) {
    markOnly(item, force);
    stage.show(playable);
    return;
  }
  if (outputLocked.value && !force) {
    if (item) prepare(item.id);
    return;
  }

  const expected = expectationOf(playable, item, mode);
  // Música por baixo do que está nas telas: a prévia e a fila continuam sendo da foto.
  const underVisual = expected.kind === "audio" && !!liveKind.value;
  if (!underVisual) stage.show(playable);
  // A tela é uma só: o que entra tira o vídeo que estava (na tela ou só no retorno).
  const video = playsVideo(playable, item);
  const music = playable.type === "song" || item?.kind === "music";
  claimScreen(video ? "video" : music ? "music" : "other");
  // Sem áudio: o mudo do palco. Outra mídia com som devolve o volume de antes.
  if (muted) playerMute.mute();
  else if (video || playable.type === "song" || item?.kind === "music") playerMute.unmute();
  if (playable.type === "child" && item) {
    goLive(item.id);
    executeChild(item, playable.childId);
    Telemetry.track("presentation_moment_child_live", { kind: item.kind });
  } else if (playable.type === "folderFile" && item) {
    goLive(item.id);
    if (expected.kind !== "audio")
      library.startQueue(playable.entry, folders.filesOf(item.folder ?? ""));
    projectPath(playable.entry.path, playable.entry.name);
    Telemetry.track("presentation_folder_file_live", {});
  } else if (item) {
    goLive(item.id);
    execute(item, mode);
    Telemetry.track("presentation_item_live", { kind: item.kind });
  } else if (playable.type === "file") {
    if (expected.kind !== "audio") library.startQueue(playable.entry);
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
  } else if (playable.type === "canva") {
    projectCanva(playable.designId, playable.title);
    Telemetry.track("canva_project_requested", { mode: "site", via: "presentation_mode" });
  }
  stage.markSent(playable, expected);
  airHistory.record(playable, { mode, muted });
  if (expected.songId) goToSlideWhenLoaded(expected.songId, slideIndex);
}

/**
 * O marcador do programa anda sem mandar nada às telas: o item é o momento do
 * culto mesmo quando não tem o que mostrar. Com a saída travada, vai para a fila.
 */
function markOnly(item: ProgramItem, force: boolean): void {
  if (outputLocked.value && !force) prepare(item.id);
  else goLive(item.id);
}

const { override: musicOverride } = useMusicOverride();

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
/** Apresentando em uma tela só: o selo "no ar" diz qual. */
const onAirWhere = computed(() =>
  screenOn.value.main && screenOn.value.stage
    ? ""
    : ` · ${tm(screenOn.value.main ? "stage.only_main" : "stage.only_stage")}`
);

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

/** A música que o módulo pôs no ar por baixo (ou no lugar) do que está nas telas. */
const audioOrigin = computed<Playable | null>(() =>
  audioLive.value ? (stage.sentAudio.value?.playable ?? null) : null
);

/** Para só a música: a foto (ou o PDF) continua no ar. */
function stopAudio(): void {
  Media.stop();
  stage.clearAudio();
}

/** O item em prévia é o que está no ar? Então o palco é o controle dele. */
const previewIsLive = computed(() => {
  const t = stage.preview.value;
  if (!t) return true;
  if (liveOrigin.value && samePlayable(t, liveOrigin.value)) return true;
  if (audioOrigin.value && samePlayable(t, audioOrigin.value)) return true;
  // Música tocada de outro módulo: os slides no ar dizem qual é.
  return t.type === "song" && t.id_music === liveSongId.value;
});

const stagePreview = computed(() => !!stage.preview.value && !previewIsLive.value);
const previewView = computed(() => {
  const t = stage.preview.value;
  return t ? previewViewOf(t, itemOf(t)) : null;
});

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

/** "Apresentar ↵" da faixa da prévia: o item de momento manda o primeiro arquivo. */
const canPresentPreview = computed(
  () => !!momentPreview.value || (!!previewView.value?.playable && !previewView.value.needsMode)
);

function presentPreview(): void {
  if (canPresentPreview.value) playPreview();
}

/** Enter: com prévia, apresenta a prévia; sem prévia, envia o próximo item do programa. */
function onEnter(): void {
  if (stagePreview.value) presentPreview();
  else sendUpNext();
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

/** Momento (ou anúncios) em prévia: o palco mostra a grade dos arquivos dele. */
const momentPreview = computed(() => {
  const t = stage.preview.value;
  if (!stagePreview.value || t?.type !== "program") return null;
  const item = findItem(t.itemId);
  return item && (item.kind === "moment" || item.children?.length) ? item : null;
});

/* ─── Pasta do programa: abre na biblioteca, não no palco ─── */

/** O item pasta/série que abriu a pasta na aba Arquivos (a faixa "Aberta pelo programa"). */
const programFolder = ref<ProgramItem | null>(null);

function openProgramFolder(item: ProgramItem): void {
  if (!item.folder) return;
  programFolder.value = item;
  libraryTab.value = "files";
  void library.openPath(item.folder);
}

/** Um clique no programa: pasta abre na biblioteca; o resto vai para a prévia. */
function previewItem(itemId: string): void {
  const item = findItem(itemId);
  if (item?.kind === "folder" && item.folder) openProgramFolder(item);
  else stage.show({ type: "program", itemId });
}

/**
 * Arquivo da pasta aberta pelo programa vai ao ar como parte do item: o
 * programa marca o item ao vivo e a série registra o que passou.
 */
function fromProgramFolder(p: Playable): Playable {
  const item = programFolder.value;
  if (p.type !== "file" || !item?.folder) return p;
  const inFolder = folders.filesOf(item.folder)?.some((e) => e.path === p.entry.path);
  return inFolder ? { type: "folderFile", itemId: item.id, entry: p.entry } : p;
}

const liveProgramItem = computed(() => {
  const origin = liveOrigin.value;
  return itemOf(origin);
});

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

const library = useFileLibrary();
const { libraryLivePath, liveBibleRef } = useLibraryLiveMarks({
  liveOrigin,
  audioOrigin,
  liveProgramItem,
});

/** Tira do ar o que está na tela, mantendo a apresentação aberta. */
function takeOff(): void {
  Telemetry.track("presentation_take_off", {
    kind: liveKind.value,
    return_only: !!returnOverride.value,
  });
  takeOffAir(liveKind.value);
  // O que está só no retorno também está no ar: o operador não vê o palco da mesa.
  if (returnOverride.value) void showOnReturn(null);
  stage.clearSent();
}
/** Há o que tirar do ar: algo na tela principal ou algo só no retorno. */
const canTakeOff = computed(() => !!liveKind.value || !!returnOverride.value);
watch(canTakeOff, (can) => $appdata.set(KEYS.MODULES.PRESENTATION_MODE.CAN_TAKE_OFF, can), {
  immediate: true,
});

// O "A seguir" pisca quando a fila chega ao fim.
const { on: upNextFlash, trigger: flashUpNext } = useFlash(700);

/* ─── Anterior/Próximo ─── */

const { canNavigate, navigate, position, onlineQueue, pdfDeck } = useStageNavigation({
  liveKind,
  findItem,
  dispatch,
  projectPath,
  outputLocked,
  onEnd: flashUpNext,
});

// Passador e teclado: o mesmo Anterior/Próximo das saídas; "B" e "." alternam a tela preta.
const liveZoom = useLiveZoom();

const transport = useLiveTransport({
  liveKind,
  audioLive,
  position,
  navigate,
  locked: outputLocked,
});
/** O título da camada visual; só com a música no ar, o dela. */
const liveTitle = computed(() =>
  liveKind.value || !audioLive.value ? live.title.value : audioTitle.value
);
const livePipProgress = computed(() => {
  const d = transport.duration.value;
  return transport.timed.value && d ? Math.min(100, (transport.currentTime.value / d) * 100) : null;
});

useClicker({
  navigate,
  // PowerPoint com animações por cima do PA: a tela preta é a dele.
  toggleBlack: () => (pptxNative.active.value ? void pptxNative.toggleBlack() : setCleared(!cleared.value)),
  send: onEnter,
  zoomIn: () => liveZoom.zoomIn(),
  zoomOut: () => liveZoom.zoomOut(),
  zoomFit: () => liveZoom.fit(),
  zoomDetail: () => liveZoom.zoomDetail(),
  togglePlay: transport.togglePlay,
  toggleMute: transport.toggleMute,
});

const pathOf = (p: Playable | null) => filePathOf(p, itemOf(p));

/** O PowerPoint por trás do PDF no ar (para apresentar com animações), ou null. */
const pptxNative = usePptxNative();
const livePptxPath = computed(() => {
  const p = pathOf(liveOrigin.value);
  return p && isPowerPoint(p) ? p : null;
});

/*
 * Pasta de anúncios com vários PowerPoints: quem apresentava com animações e
 * passou do último slide continua com animações no próximo PowerPoint, assim
 * que o PDF dele estiver no ar (antes disso, a troca de PDF encerraria o modo).
 */
let keepNative: { from: string | null; until: number; unloaded: boolean } | null = null;
onBeforeUnmount(
  pptxNative.onFinished(
    () => (keepNative = { from: livePptxPath.value, until: Date.now() + 60_000, unloaded: false })
  )
);
// O próximo da fila não é PowerPoint: a continuação acaba ali.
watch(
  () => pathOf(stage.sent.value?.playable ?? null),
  (p) => {
    if (keepNative && p && !isPowerPoint(p)) keepNative = null;
  }
);
watch(
  () => [livePptxPath.value, pdfDeck.active.value] as const,
  ([path, ready]) => {
    if (!keepNative || Date.now() > keepNative.until) return void (keepNative = null);
    // O PDF antigo sai antes de o novo carregar: só então o modo pode voltar.
    if (!ready) keepNative.unloaded = true;
    if (!path || !ready || !keepNative.unloaded || path === keepNative.from) return;
    keepNative = null;
    void pptxNative.start(path, 0);
  }
);

/** PowerPoint gerado de novo: o PDF novo entra no lugar, na mesma página. */
function reprojectPowerPoint(pdf: string): void {
  pdfDeck.openNextAtPage(pdfDeck.page.value);
  projectPdf(pdf, liveTitle.value);
}

useSeriesRecorder(() => pathOf(liveOrigin.value));

// Arquivos do programa que estão só na nuvem descem antes do culto.
const programNeededPaths = () => [
  ...programFilePaths(program.value),
  ...program.value.sessions
    .flatMap((s) => s.items)
    .flatMap((i) => (i.kind === "folder" && i.folder ? folders.neededPathsOf(i.folder) : [])),
];
useProgramDownloads(programNeededPaths);

/*
 * Os PowerPoints do programa — itens, momentos e pastas (a de anúncios) — já
 * convertem antes do culto: no meio da pasta, o passador não espera o PowerPoint.
 * Não com o PowerPoint apresentando: a conversão usa o mesmo programa.
 */
const preparedPptx = new Set<string>();
watch(
  () => [programNeededPaths().filter(isPowerPoint), pptxNative.active.value] as const,
  ([paths, presenting]) => {
    if (presenting) return;
    for (const p of paths) {
      if (preparedPptx.has(p)) continue;
      preparedPptx.add(p);
      preparePowerPoint(p);
    }
  },
  { immediate: true }
);

// PowerPoint no palco já começa a converter: na hora de mandar, o PDF está pronto.
watch(stage.preview, (p) =>
  preparePowerPoint(pathOf(p), findItem(p?.type === "program" ? p.itemId : ""))
);

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

/** "Item anterior": volta ao item antes do que está no ar. */
function sendPrevious(): void {
  const item = previousItem.value;
  if (item) activate(item.id);
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

/* ─── Sem programa: "Já passou hoje" ─── */

const airHistory = useAirHistory();

/** A linha do histórico que está no ar: a última que ainda é o que está nas telas. */
const liveHistoryId = computed(() => {
  const origin = liveOrigin.value;
  if (!origin) return null;
  const list = airHistory.entries.value;
  for (let i = list.length - 1; i >= 0; i--) {
    if (samePlayable(list[i].playable, origin)) return list[i].id;
  }
  return null;
});

/** "Guardar o que passou como programa": as linhas viram os itens do dia, na ordem. */
function saveHistoryAsProgram(): void {
  const list = airHistory.entries.value.map(historyItem).filter((i): i is ProgramItem => !!i);
  if (!list.length) return;
  const sessions = program.value.sessions;
  if (sessions.length) {
    setSessions(sessions.map((s, i) => (i === 0 ? { ...s, items: [...s.items, ...list] } : s)));
  } else {
    setSessions([{ id: newId(), label: tm("history.session_label"), items: list }]);
  }
  Telemetry.track("presentation_history_saved", { items: list.length });
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

// Todas as ações do ribbon contextual chegam aqui; as sem handler são ignoradas.
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
  toggle_program: () =>
    $userdata.set(KEYS.MODULES.PRESENTATION_MODE.PROGRAM_HIDDEN, !programHidden.value),
  ...Object.fromEntries(LIBRARY_TABS.map((t) => [`library_${t}`, () => (libraryTab.value = t)])),
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

.pm-area--no-program .pm-stage,
.pm-area--no-program .pm-library {
  grid-column: 1 / 3;
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
  border: 1px solid var(--lj-live-select);
  border-radius: 3px;
  color: var(--lj-text);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

/* Tocando sem apresentar: âmbar, para não ser confundido com o "no ar". */
.pm-playing-only {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--lj-orange);
  border-radius: 3px;
  color: var(--lj-orange);
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

.pm-stage__main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-stage__body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pm-stage__empty {
  margin: 0;
  color: var(--lj-white-alpha-50);
}
</style>
