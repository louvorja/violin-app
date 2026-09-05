<template>
  <!-- Diálogo de vídeo online -->
  <LjDialog v-model="ui.showOnlineVideoDialog" :title="endAction.t('ribbon.online_video')">
    <div class="ov-body">
      <LjInput
        v-model="ui.onlineVideoSearch"
        :placeholder="endAction.t('ribbon.online_video_search')"
        :icon="ICONS.ACTIONS.SEARCH"
        clearable
      />
      <div class="ov-grid">
        <div
          v-for="video in videos"
          :key="video.url"
          class="ov-card"
          @click="endAction.pickOnlineVideo(video)"
        >
          <img
            v-if="endAction.getVideoThumb(video.url)"
            :src="endAction.getVideoThumb(video.url)"
            alt=""
            loading="lazy"
            class="ov-thumb"
          />
          <div v-else class="ov-thumb-fallback">
            <Icon :icon="ICONS.MEDIA.YOUTUBE" size="28" color="#e74c3c" />
          </div>
          <div class="ov-card-title">{{ video.name }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ov-url">
        <LjInput
          v-model="ui.onlineVideoUrl"
          :placeholder="endAction.t('ribbon.online_video_url')"
          @keydown.enter="endAction.pickCustomUrl"
        />
      </div>
      <LjButton
        variant="default"
        :icon="ICONS.UI.CHECK"
        icon-only
        @click="endAction.pickCustomUrl"
      />
    </template>
  </LjDialog>

  <!-- Diálogo de busca de música -->
  <MusicSpotlight
    v-model="ui.showMusicDialog"
    mode="pick"
    :on-music-action="endAction.handleMusicAction"
    @pick="endAction.onMusicPicked"
  />
</template>

<script setup lang="ts">
import { LjButton, LjDialog, LjInput } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { computed } from "vue";
import MusicSpotlight from "@/components/MusicSpotlight.vue";
import type { TimerEndAction } from "@/composables/useTimerEndAction";

const props = defineProps<{
  endAction: TimerEndAction;
}>();

const ui = props.endAction.ui;

const videos = computed(() => props.endAction.filteredVideos.value);
</script>

<style scoped>
.ov-body {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}
.ov-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.ov-card {
  border-radius: 6px;
  overflow: hidden;
  background: rgba(var(--lj-on-surface-ch), 0.04);
  cursor: pointer;
  transition: transform 0.15s;
}
.ov-card:hover {
  transform: translateY(-2px);
}
.ov-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}
.ov-thumb-fallback {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
}
.ov-card-title {
  font-size: 11px;
  padding: 4px 6px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* O primitivo é inline-flex e não se estica sozinho; o invólucro é o caminho
   para dar a ele o resto da linha do rodapé. */
.ov-url {
  flex: 1;
  min-width: 0;
}
.ov-url :deep(.lj-input) {
  width: 100%;
}
</style>
