<template>
  <div class="player">
    <div class="player__main">
      <div class="player__controls-row">
        <span
          v-if="playlistActive && playlistVideoSequence"
          class="player__queue"
          :data-queue-index="playlistIndex"
          :data-queue-total="playlistTotal"
        >
          {{
            $t("shell.player.playing_video_category", {
              category: playlistName,
              index: playlistIndex + 1,
              total: playlistTotal,
              video: playlistVideoName,
            })
          }}
        </span>
        <PlayerControls :buttons="buttons" :compact="compact" :loading="mediaLoading" />
      </div>
      <PlayerProgress
        v-if="hasPlayback"
        :progress="progress"
        :current-time="currentTime"
        :duration="duration"
        :buffered="buffered"
        :loading="mediaLoading"
        :is-paused="isPaused"
        :volume="volume"
        :slide-index="mediaConfig.slide_index"
        :last-slide="mediaConfig.last_slide"
        @seek="seekToProgress"
      />
    </div>
    <div class="player__side">
      <PlayerActions
        :location="location"
        :minimized="mediaMinimized"
        :compact="compact"
        :loading="mediaLoading"
        :slide-index="mediaConfig.slide_index"
        :mode="mode"
        :menu-modes="menu_modes"
        :slides="slides"
        :compact-buttons="compactButtons"
        @go-to-slide="goToSlide"
        @maximize="maximize"
        @fullscreen="fullscreen"
        @close="close"
      />
      <PlayerGauge
        v-if="hasPlayback"
        :volume="volume"
        :icon="volume_icon"
        :loading="mediaLoading"
        @toggle="toggleVolume"
        @seek="setVolume"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PlayerControls from "@/components/PlayerControls.vue";
import PlayerProgress from "@/components/PlayerProgress.vue";
import PlayerGauge from "@/components/PlayerGauge.vue";
import PlayerActions from "@/components/PlayerActions.vue";
import { usePlayerState } from "@/composables/usePlayerState";
import { playlistControls } from "@/modules/musics/composables/usePlaylistPlayback";
import { MediaConfig } from "@/types/Media";

withDefaults(defineProps<{ location?: string }>(), { location: "" });

const {
  media,
  audio,
  buttons,
  compact,
  mode,
  menu_modes,
  slides,
  volume_icon,
  seekToProgress,
  goToSlide,
  maximize,
  fullscreen,
  close,
  toggleVolume,
  setVolume,
} = usePlayerState();

const { progress, currentTime, duration, buffered, isPaused, volume } = audio;

const mediaLoading = computed(() => !!media.value?.loading);
const playlistActive = playlistControls.isActive;
const playlistVideoSequence = playlistControls.isOnlineVideoSequence;
const playlistIndex = playlistControls.currentIndex;
const playlistTotal = playlistControls.totalSongs;
const playlistName = computed(() => playlistControls.currentPlaylist.value?.name || "");
const playlistVideoName = computed(() => playlistControls.currentSong.value?.name || "");
const mediaMinimized = computed(() => !!media.value?.minimized);
const mediaConfig = computed((): MediaConfig => (media.value?.config as MediaConfig) ?? {});
const hasPlayback = computed(() => !!mediaConfig.value.audio || !!mediaConfig.value.is_youtube);

const compactButtons = computed(() => buttons.value.filter((item) => item.compact === true));
</script>

<style scoped>
.player {
  display: flex;
  align-items: center;
  width: 100%;
  background: var(--lj-footer-bg);
  color: var(--lj-text);
  /* O traço no topo separa o player do conteúdo — papel que a sombra do card
     fazia antes, e que a barra precisa manter sobre o vídeo em tela cheia. */
  border-top: 1px solid var(--lj-footer-border);
}

.player__main {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
}
.player__controls-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-width: 0;
}
.player__queue {
  flex: 0 1 auto;
  max-width: 42%;
  padding-left: var(--lj-space-4);
  overflow: hidden;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.player__side {
  display: flex;
  flex-direction: column;
}
</style>
