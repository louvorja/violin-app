<template>
  <ModuleContainer :manifest="manifest">
    <div
      class="pm-area"
      :class="{ 'pm-area--library-wide': libraryLayout.fullWidth.value }"
      :style="{ '--pm-library-h': `${libraryLayout.height.value}px` }"
    >
      <ProgramPanel
        @activate="activate"
        @preview="(id: string) => stage.show({ type: 'program', itemId: id })"
        @edit-item="openEditItem"
        @edit-session="openEditSession"
        @new-item="openNewItem"
        @new-session="openNewSession"
        @duplicate-item="duplicateItem"
        @remove-item="(id: string) => confirmRemoveItem(id)"
        @import="importFromLiturgy"
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
        <StagePreview
          v-if="stagePreview && previewView"
          :view="previewView"
          @play="playPreview"
          @play-return="playPreviewOnReturn"
        />
        <StageSlides
          v-else-if="showSlideGrid"
          :subtitle="liveProgramItem?.kind === 'music' ? liveProgramItem.subtitle : undefined"
          :locked="outputLocked"
        />
        <StageVideo v-else-if="showVideoStage" :locked="outputLocked" />
        <StageVideo v-else-if="audioLive" :locked="outputLocked" :audio-title="audioTitle" />
        <!-- Imagem, versículo, anúncio: o palco mostra o que está na tela. -->
        <div v-else-if="liveKind" class="pm-stage__preview" data-testid="pm-stage-preview">
          <div class="pm-stage__frame"><LiveMirror :cleared="false" /></div>
        </div>
        <div v-else class="pm-stage__body">
          <p class="pm-stage__empty">{{ tm("empty.stage") }}</p>
        </div>
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
        @stop="stopMedia"
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
        :queue-counter="queueCounter"
        @first="navigate('first')"
        @prev="navigate('prev')"
        @next="navigate('next')"
        @last="navigate('last')"
        @toggle-lock="toggleLock"
        @send="sendUpNext"
      />
    </div>

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
import type { ProgramBibleRef, ProgramItem, ProgramSession } from "@/types/Presentation";
import ProgramPanel from "./ProgramPanel.vue";
import ProgramItemDialog from "./ProgramItemDialog.vue";
import ProgramSessionDialog from "./ProgramSessionDialog.vue";
import ProgramSettingsDialog from "./ProgramSettingsDialog.vue";
import OutputsPanel from "./OutputsPanel.vue";
import StageSlides from "./StageSlides.vue";
import StageVideo from "./StageVideo.vue";
import StagePreview from "./StagePreview.vue";
import { useStage } from "../composables/useStage";
import { expectationOf, isOnAir, samePlayable, type Playable } from "../program/playable";
import LibraryPanel, { type LibraryTab } from "./LibraryPanel.vue";
import LiveMirror from "./LiveMirror.vue";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { useFileLibrary, type LibraryEntry } from "../composables/useFileLibrary";
import { KIND_ICONS } from "../program/kinds";
import Media from "@/composables/useMedia";
import { useSlides } from "@/composables/useSlides";
import { useLiveContent, type LiveKind } from "../composables/useLiveContent";
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
import type { MusicMode } from "../program/musicModes";
import $path from "@/helpers/Path";
import { kindFromPath } from "../program/liturgy";
import { itemVideoId, openOnline, useOnlineQueue } from "../composables/useOnlinePlayback";
import { useOnlinePrefetch } from "../composables/useOnlinePrefetch";
import { useSeriesRecorder } from "../composables/useSeries";
import {
  bibleSource,
  fileQueueSource,
  slidesSource,
  useLiveNavigation,
} from "../composables/useLiveNavigation";
import { useBibleLibrary } from "../composables/useBibleLibrary";
import { previewViewOf } from "../program/previewView";
import { useLibraryLayout } from "../composables/useLibraryLayout";
import { useProgramLiturgy } from "../composables/useProgramLiturgy";
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
  addSession,
  updateSession,
  removeSession,
  addItem,
  updateItem,
  duplicateItem,
  removeItem,
  sessionOf,
  goLive,
  toggleOpen,
  preparedItemId,
  upNextItem,
  outputLocked,
  setOutputLocked,
  prepare,
} = useProgram();
const { execute, projectPath, sendBible } = useProgramExecution();
const bibleLibrary = useBibleLibrary();
const { importFromLiturgy, saveAsLiturgy } = useProgramLiturgy();
const stage = useStage();
onBeforeUnmount(stage.reset);

onMounted(() => {
  void ensureLoaded();
  // A trava vale para o culto em andamento, não para a próxima abertura.
  if (outputLocked.value) setOutputLocked(false);
});

const expanded = computed(() => isModuleExpanded(moduleId));
/* ─── Biblioteca ─── */

const libraryLayout = useLibraryLayout();

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
  { slideIndex = 0, mode = "sung", force = false }: DispatchOptions = {}
): void {
  const item = playable.type === "program" ? findItem(playable.itemId) : null;
  if (playable.type === "program") {
    if (!item) return;
    if (item.children?.length) {
      toggleOpen(item.id, true);
      return;
    }
  }
  if (outputLocked.value && !force) {
    if (item) prepare(item.id);
    return;
  }

  stage.show(playable);
  const expected = expectationOf(playable, item, mode);
  if (item) {
    goLive(item.id);
    execute(item);
    Telemetry.track("presentation_item_live", { kind: item.kind });
  } else if (playable.type === "file") {
    library.startQueue(playable.entry);
    projectPath(playable.entry.path, playable.entry.name);
    Telemetry.track("presentation_library_projected", { ext: playable.entry.ext });
  } else if (playable.type === "song") {
    if (playable.customId) playCustomMusicInMode(playable.customId, mode);
    else playMusicInMode(playable.id_music, mode);
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
  return t ? previewViewOf(t, t.type === "program" ? findItem(t.itemId) : null) : null;
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

function playPreview(slideIndex = 0, mode: MusicMode = "sung"): void {
  const t = stage.preview.value;
  if (t) dispatch(t, { slideIndex, mode });
}

function onShowOnReturn(entry: LibraryEntry | null): void {
  if (!entry) {
    void showOnReturn(null);
    return;
  }
  const type = kindFromPath(entry.path);
  if (type !== "image" && type !== "video") return;
  void showOnReturn({ type, url: $path.local(entry.path), title: entry.name, path: entry.path });
}

function playPreviewOnReturn(): void {
  const t = stage.preview.value;
  if (t?.type === "file") onShowOnReturn(t.entry);
  else if (t?.type === "program") {
    const dir = findItem(t.itemId)?.source?.dir;
    if (dir)
      onShowOnReturn({
        name: dir.split(/[\\/]/).pop() ?? dir,
        path: dir,
        isDir: false,
        ext: "",
        size: 0,
        mtimeMs: 0,
      });
  }
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

const liveProgramItem = computed(() =>
  liveOrigin.value?.type === "program" ? findItem(liveOrigin.value.itemId) : null
);

const stageIcon = computed(() => {
  if (stagePreview.value) return previewView.value?.icon ?? null;
  if (!liveKind.value) return null;
  return liveProgramItem.value ? KIND_ICONS[liveProgramItem.value.kind] : null;
});

/** O item do programa no ar; sem ele (biblioteca, outro módulo), o nome do que está na tela. */
const stageTitle = computed(() => {
  if (stagePreview.value) return previewView.value?.title ?? "";
  if (liveProgramItem.value) return liveProgramItem.value.title;
  if (audioLive.value && !liveKind.value) return audioTitle.value;
  switch (liveKind.value) {
    case "music":
      return slides.title.value;
    case "bible":
      return live.bible.value?.reference ?? "";
    case "file":
      return live.file.value?.title ?? "";
    case "online_video":
      return live.onlineTitle.value;
    case "announcements":
      return live.announcement.value?.nome ?? "";
    default:
      return tm("panels.stage");
  }
});

const stageMeta = computed(() => {
  const t = stage.preview.value;
  if (stagePreview.value && t) {
    if (t.type === "program") return findItem(t.itemId)?.subtitle ?? "";
    if (t.type === "song") return t.subtitle ?? "";
    if (t.type === "online") return t.channel ?? "";
    return "";
  }
  return liveKind.value ? (liveProgramItem.value?.subtitle ?? "") : "";
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

/** O arquivo no ar saiu da biblioteca? Então a grade o destaca. */
const library = useFileLibrary();
const libraryQueueLive = computed(() => {
  const q = library.queue.value;
  const origin = liveOrigin.value;
  return !!q && origin?.type === "file" && q.entries[q.index]?.path === origin.entry.path;
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

/** Tira a mídia do ar mantendo as janelas de projeção abertas. */
function stopMedia(): void {
  Media.close(true, false, true);
}

const upNextFlash = ref(false);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flashUpNext(): void {
  upNextFlash.value = true;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (upNextFlash.value = false), 700);
}

/* ─── Anterior/Próximo ─── */

/** O que o módulo enviou, enquanto ainda há algo no ar — a navegação parte daqui, não do eco da tela. */
function sentWhile(kinds: LiveKind[]): Playable | null {
  const kind = liveKind.value;
  return kind && kinds.includes(kind) ? (stage.sent.value?.playable ?? null) : null;
}

function sentBible(): ProgramBibleRef | null {
  const sent = sentWhile(["bible"]);
  if (sent?.type === "bible") return sent.ref;
  return sent?.type === "program" ? (findItem(sent.itemId)?.bible ?? null) : null;
}

/** Manda ao ar sem passar pelo `dispatch`, que recomeçaria a fila pela lista aberta agora. */
function markSent(playable: Playable): void {
  stage.markSent(playable, expectationOf(playable, null));
}

const onlineQueue = useOnlineQueue({
  sent: () => sentWhile(["file", "online_video"]),
  onSent: markSent,
});

const navigation = useLiveNavigation(
  [
    bibleSource({
      sent: sentBible,
      chapterOf: (ref) => bibleLibrary.chapterOf(ref),
      send: (ref) => dispatch({ type: "bible", ref }),
    }),
    onlineQueue.source,
    fileQueueSource({
      queue: () => library.queue.value,
      sent: () => sentWhile(["file"]),
      step: (to) => library.stepQueue(to),
      send: (entry) => {
        projectPath(entry.path, entry.name);
        markSent({ type: "file", entry });
      },
    }),
    slidesSource({
      isMusic: () => liveKind.value === "music",
      total: () => slides.totalSlides.value,
      index: () => slides.slideIndex.value,
    }),
  ],
  outputLocked,
  flashUpNext
);
const { canNavigate, navigate } = navigation;
const queueCounter = navigation.counter;

useSeriesRecorder(() => {
  const origin = liveOrigin.value;
  if (origin?.type === "file") return origin.entry.path;
  return origin?.type === "program" ? (findItem(origin.itemId)?.source?.dir ?? null) : null;
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

/* ─── Itens ─── */

const itemDialogOpen = ref(false);
const editingItem = ref<ProgramItem | null>(null);
const editingSessionId = ref<string | null>(null);

/** Garante uma sessão para receber o item: programa vazio ganha a sessão padrão. */
function ensureSession(): string {
  const selected = selectedItemId.value ? sessionOf(selectedItemId.value) : null;
  if (selected) return selected.id;
  const last = program.value.sessions.at(-1);
  return last ? last.id : addSession(tm("program.default_session")).id;
}

function openNewItem(): void {
  editingItem.value = null;
  editingSessionId.value = ensureSession();
  itemDialogOpen.value = true;
}

function openEditItem(itemId: string): void {
  const item = findItem(itemId);
  if (!item) return;
  editingItem.value = item;
  editingSessionId.value = sessionOf(itemId)?.id ?? null;
  itemDialogOpen.value = true;
}

function onSaveItem({ item, sessionId }: { item: ProgramItem; sessionId: string }): void {
  if (editingItem.value) updateItem(item.id, item, sessionId);
  else addItem(item, sessionId);
}

function confirmRemoveItem(itemId: string | null): void {
  const item = itemId ? findItem(itemId) : null;
  if (!item) return;
  $alert.yesno(
    { title: alertKey("alerts.remove_item_title"), text: alertKey("alerts.remove_item") },
    (resp?: string) => {
      if (resp !== "yes") return;
      removeItem(item.id);
      itemDialogOpen.value = false;
    }
  );
}

function duplicateSelected(): void {
  if (selectedItemId.value) duplicateItem(selectedItemId.value);
}

/* ─── Sessões ─── */

const sessionDialogOpen = ref(false);
const editingSession = ref<ProgramSession | null>(null);

function openNewSession(): void {
  editingSession.value = null;
  sessionDialogOpen.value = true;
}

function openEditSession(sessionId: string): void {
  editingSession.value = program.value.sessions.find((s) => s.id === sessionId) ?? null;
  sessionDialogOpen.value = !!editingSession.value;
}

function onSaveSession(label: string): void {
  if (editingSession.value) updateSession(editingSession.value.id, { label });
  else addSession(label);
}

function confirmRemoveSession(): void {
  const session = editingSession.value;
  if (!session) return;
  const text = session.items.length ? "alerts.remove_session_items" : "alerts.remove_session";
  $alert.yesno(
    { title: alertKey("alerts.remove_session_title"), text: alertKey(text) },
    (resp?: string) => {
      if (resp !== "yes") return;
      removeSession(session.id);
      sessionDialogOpen.value = false;
    }
  );
}

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
  grid-template-columns: 282px minmax(0, 1fr) 306px;
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
