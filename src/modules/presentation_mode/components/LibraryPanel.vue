<template>
  <section ref="root" class="pm-library" data-testid="pm-library">
    <div
      class="pm-library__resize"
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      :aria-label="tm('library.resize')"
      :title="tm('library.resize')"
      data-testid="pm-library-resize"
      @pointerdown="resize.start"
      @keydown.up.prevent="resize.step(1)"
      @keydown.down.prevent="resize.step(-1)"
      @dblclick="emit('toggle-height')"
    />
    <header class="pm-library__tabs">
      <div class="pm-library__tablist" role="tablist">
        <button
          v-for="libTab in TABS"
          :key="libTab.id"
          type="button"
          role="tab"
          :aria-selected="tab === libTab.id"
          class="pm-library__tab"
          :class="{ 'pm-library__tab--active': tab === libTab.id }"
          :data-testid="`pm-library-tab-${libTab.id}`"
          @click="tab = libTab.id"
        >
          <LjIcon :icon="libTab.icon" :size="15" />
          {{ tm(libTab.label) }}
        </button>
      </div>
      <div class="pm-library__tools">
        <LjButton
          size="sm"
          icon-only
          :icon="fullWidth ? ICONS.ACTIONS.COLLAPSE_WIDTH : ICONS.ACTIONS.EXPAND_WIDTH"
          :title="fullWidth ? tm('library.normal_width') : tm('library.full_width')"
          :aria-pressed="fullWidth"
          data-testid="pm-library-width"
          @click="emit('toggle-width')"
        />
        <LjButton
          size="sm"
          icon-only
          :icon="tall ? ICONS.UI.CHEVRON_DOWN : ICONS.UI.CHEVRON_UP"
          :title="tall ? tm('library.shorter') : tm('library.taller')"
          :aria-pressed="tall"
          data-testid="pm-library-height"
          @click="emit('toggle-height')"
        />
      </div>
    </header>

    <LibraryMusic v-if="tab === 'musics'" :live-song-id="liveSongId" v-bind="relay" />
    <LibraryOnline
      v-else-if="tab === 'online'"
      :live-video-id="liveVideoId"
      :return-path="returnPath"
      v-bind="relay"
      @stop="emit('stop')"
      @show-on-return="(t: Playable | null) => emit('show-on-return', t)"
    />
    <LibraryBible v-else-if="tab === 'bible'" :live="liveBible" v-bind="relay" />
    <LibraryFiles
      v-else
      :live-path="livePath"
      :return-path="returnPath"
      v-bind="relay"
      @stop="emit('stop')"
      @show-on-return="
        (e: LibraryEntry | null) => emit('show-on-return', e && { type: 'file', entry: e })
      "
    />
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import LibraryFiles from "./LibraryFiles.vue";
import LibraryMusic from "./LibraryMusic.vue";
import LibraryBible from "./LibraryBible.vue";
import LibraryOnline from "./LibraryOnline.vue";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import type { MusicMode } from "../program/musicModes";
import type { Playable } from "../program/playable";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { LibraryEntry } from "../composables/useFileLibrary";
import { useVerticalResize } from "../composables/useVerticalResize";

const props = defineProps<{
  fullWidth: boolean;
  tall: boolean;
  height: number;
  livePath: string | null;
  returnPath: string | null;
  /** Trecho da Bíblia no ar, para marcar os versículos na aba Bíblia. */
  liveBible: ProgramBibleRef | null;
  liveVideoId: string | null;
  /** Música com os slides no ar, para marcar a linha na aba Músicas. */
  liveSongId: number | null;
}>();

const emit = defineEmits<{
  "toggle-width": [];
  "toggle-height": [];
  resize: [height: number];
  "resize-end": [height: number];
  /** Todas as abas falam a mesma língua: prévia e ar recebem um Playable; o programa, um item pronto. */
  preview: [playable: Playable];
  play: [playable: Playable, options?: { mode: MusicMode }];
  add: [item: ProgramItem];
  stop: [];
  /** Imagem ou vídeo só no retorno de palco; `null` tira. */
  "show-on-return": [target: Playable | null];
}>();

/** O que toda aba repassa sem tocar: as três ações comuns. */
const relay = {
  onPreview: (p: Playable) => emit("preview", p),
  onPlay: (p: Playable, options?: { mode: MusicMode }) => emit("play", p, options),
  onAdd: (item: ProgramItem) => emit("add", item),
};

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const TABS = [
  { id: "files", label: "library.files", icon: ICONS.UI.FOLDER_OPEN },
  { id: "musics", label: "library.musics", icon: ICONS.MUSIC.MUSIC },
  { id: "bible", label: "library.bible", icon: ICONS.MODULES.BIBLE },
  { id: "online", label: "library.online", icon: ICONS.MEDIA.YOUTUBE },
] as const;
export type LibraryTab = (typeof TABS)[number]["id"];
/** Controlada de fora: o ribbon também troca a aba. */
const tab = defineModel<LibraryTab>("tab", { default: "files" });

const root = ref<HTMLElement | null>(null);
const resize = useVerticalResize({
  root,
  height: () => props.height,
  onResize: (h) => emit("resize", h),
  onEnd: (h) => emit("resize-end", h),
});
</script>

<style scoped>
.pm-library {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--lj-surface-bg);
  border-top: 1px solid var(--lj-surface-border);
}

/* Faixa de pegar sobre a borda de cima; o traço acende ao passar o mouse. */
.pm-library__resize {
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  z-index: 2;
  height: 6px;
  cursor: row-resize;
  touch-action: none;
  transition: background 120ms var(--lj-ease);
}

.pm-library__resize:hover,
.pm-library__resize:active,
.pm-library__resize:focus-visible {
  background: linear-gradient(var(--lj-orange), var(--lj-orange)) top / 100% 2px no-repeat;
}

.pm-library__tabs {
  display: flex;
  align-items: stretch;
  height: 30px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border);
}

/* Só as abas rolam; os botões de tamanho ficam fixos à direita. */
.pm-library__tablist {
  flex: 1;
  min-width: 0;
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
}

.pm-library__tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  flex-shrink: 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--lj-text-muted);
  font-size: 12px;
  cursor: pointer;
}

.pm-library__tab--active {
  background: var(--lj-surface-bg);
  border-bottom-color: var(--lj-orange);
  color: var(--lj-text);
}

.pm-library__tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  flex-shrink: 0;
}
</style>
