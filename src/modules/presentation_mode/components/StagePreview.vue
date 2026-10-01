<template>
  <div class="pm-preview" data-testid="pm-stage-preview-item" :data-kind="view.kind">
    <template v-if="view.kind === 'song'">
      <p v-if="songState === 'loading'" class="pm-preview__note">{{ tm("library.loading") }}</p>
      <p v-else-if="songState === 'error'" class="pm-preview__note">{{ tm("preview.song_failed") }}</p>
      <SlideGrid v-else :slides="songSlides" :title="view.title" @pick="(i: number) => emit('play', i)" />
      <footer class="pm-preview__bar">
        <LjButton variant="primary" :icon="ICONS.PLAYER.PLAY" data-testid="pm-preview-play" @click="emit('play')">
          {{ tm("preview.play") }}
        </LjButton>
        <LjMenu v-if="view.chooseMode" :items="modeItems" side="top">
          <template #trigger>
            <LjButton :icon-end="ICONS.UI.CHEVRON_UP" data-testid="pm-preview-play-as">
              {{ tm("music_modes.play_as") }}
            </LjButton>
          </template>
        </LjMenu>
        <span class="pm-preview__hint">{{ tm("preview.song_hint") }}</span>
      </footer>
    </template>

    <div v-else class="pm-preview__stage">
      <div class="pm-preview__frame">
        <img v-if="view.kind === 'image'" class="pm-preview__media" :src="view.url" alt="" />
        <video
          v-else-if="view.kind === 'video'"
          class="pm-preview__media"
          :src="view.url ? `${view.url}#t=1` : undefined"
          muted
          playsinline
          preload="metadata"
        />
        <div v-else-if="view.kind === 'text'" class="pm-preview__text">
          <p>{{ view.text }}</p>
          <span v-if="view.reference">{{ view.reference }}</span>
        </div>
        <ol v-else-if="view.kind === 'list'" class="pm-preview__list">
          <li v-for="(name, i) in view.items" :key="i">{{ name }}</li>
        </ol>
        <div v-else class="pm-preview__other">
          <LjIcon :icon="view.icon" :size="40" />
          <span>{{ view.title }}</span>
        </div>

        <LjButton
          v-if="view.kind === 'image' || view.kind === 'video'"
          size="sm"
          class="pm-preview__return"
          :icon="ICONS.PROJECTION.RETURN"
          data-testid="pm-preview-return"
          @click="emit('play-return')"
        >
          {{ tm("library.play_on_return") }}
        </LjButton>
        <LjTooltip v-if="view.playable" :text="tm('preview.play')">
          <button
            type="button"
            class="pm-preview__play"
            :aria-label="tm('preview.play')"
            data-testid="pm-preview-play"
            @click="emit('play')"
          >
            <LjIcon :icon="ICONS.PLAYER.PLAY" :size="34" />
          </button>
        </LjTooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjIcon, LjMenu, LjTooltip, type LjMenuItem } from "@/components/ui";
import { modesFor, type MusicMode } from "../program/musicModes";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $database from "@/helpers/Database";
import Telemetry from "@/helpers/Telemetry";
import { buildSlidesFrom } from "@/composables/useMedia";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { Music } from "@/types/Music";
import SlideGrid from "./SlideGrid.vue";

/**
 * Prévia de um item que não está no ar. Nada daqui chega à tela: a música é
 * lida do banco e desenhada na grade; imagem e vídeo abrem direto do disco.
 * O botão ▶ (ou o clique num slide) é que manda ao ar.
 */

export interface PreviewView {
  kind: "song" | "image" | "video" | "text" | "list" | "other";
  title: string;
  icon: string;
  playable: boolean;
  songId?: number;
  /** Música da biblioteca: oferece "Reproduzir como…" (no programa, o formato é do item). */
  chooseMode?: boolean;
  url?: string;
  text?: string;
  reference?: string;
  items?: string[];
}

const props = defineProps<{ view: PreviewView }>();
const emit = defineEmits<{
  play: [slideIndex?: number, mode?: MusicMode];
  "play-return": [];
}>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const songSlides = ref<Record<string, unknown>[]>([]);
const songHasInstrumental = ref(false);

const modeItems = computed<LjMenuItem[]>(() =>
  modesFor(songHasInstrumental.value).map((m) => ({
    label: tm(m.label),
    icon: m.icon,
    action: () => emit("play", 0, m.value),
  }))
);
const songState = ref<"idle" | "loading" | "ready" | "error">("idle");
let songSeq = 0;

watch(
  () => props.view.songId,
  async (id) => {
    const seq = ++songSeq;
    songSlides.value = [];
    songHasInstrumental.value = false;
    if (!id) {
      songState.value = "idle";
      return;
    }
    songState.value = "loading";
    try {
      const data = await $database.get<Music>(`music_${id}`);
      if (seq !== songSeq) return;
      if (!data) throw new Error("music_not_found");
      songSlides.value = buildSlidesFrom(data) as Record<string, unknown>[];
      songHasInstrumental.value = !!data.url_instrumental_music;
      songState.value = "ready";
    } catch (e) {
      if (seq !== songSeq) return;
      songState.value = "error";
      Telemetry.captureException(e, { source: "presentation_mode.preview.song" });
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.pm-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-preview__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 1px solid var(--lj-surface-border);
}

.pm-preview__hint {
  font-size: 11px;
  color: var(--lj-text-subtle);
}

.pm-preview__note {
  margin: auto;
  color: var(--lj-white-alpha-50);
}

.pm-preview__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  container-type: size;
}

.pm-preview__frame {
  position: relative;
  width: min(100cqw, calc(100cqh * 16 / 9));
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-color-projection-bg);
  color: var(--lj-white);
}

.pm-preview__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-preview__text,
.pm-preview__other,
.pm-preview__list {
  position: absolute;
  inset: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  padding: 6%;
  text-align: center;
  font-family: var(--lj-font-projection);
}

.pm-preview__text p {
  margin: 0;
  font-size: clamp(16px, 3.2cqh, 34px);
  line-height: 1.3;
}

.pm-preview__text span {
  color: var(--lj-color-cover-gold);
  font-size: clamp(12px, 2.2cqh, 22px);
  text-transform: uppercase;
}

.pm-preview__list {
  list-style: decimal inside;
  gap: var(--lj-space-2);
  font-size: clamp(13px, 2.4cqh, 22px);
}

.pm-preview__other {
  color: var(--lj-white-alpha-50);
}

/* O ▶ fica sobre a prévia, como no FreeShow: é o "manda ao ar" do item. */
.pm-preview__play {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--lj-black-alpha-40);
  color: var(--lj-white);
  cursor: pointer;
  opacity: 0.85;
  transform: translate(-50%, -50%);
  transition:
    opacity 120ms var(--lj-ease),
    background 120ms var(--lj-ease);
}

.pm-preview__return {
  position: absolute;
  right: 10px;
  bottom: 10px;
}

.pm-preview__play:hover,
.pm-preview__play:focus-visible {
  opacity: 1;
  background: var(--lj-black-alpha-75);
}

.pm-preview__play:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
