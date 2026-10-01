<template>
  <div class="pm-mirror" data-testid="pm-live-mirror" :data-kind="cleared ? 'cleared' : current ?? 'empty'">
    <div v-if="cleared || !current" class="pm-mirror__fill" :style="background" />

    <Slide v-else-if="current === 'music'" :slide="music.slide.value ?? undefined" :title="music.title.value" />

    <Slide v-else-if="current === 'bible' && bible" :slide="bibleSlide ?? undefined" :title="bible.reference" />

    <template v-else-if="current === 'file' && file">
      <img v-if="file.type === 'image'" class="pm-mirror__media" :src="file.url" alt="" />
      <video
        v-else-if="file.type === 'video'"
        ref="videoEl"
        class="pm-mirror__media"
        :src="file.url"
        muted
        playsinline
        preload="auto"
      />
      <div v-else class="pm-mirror__label">
        <LjIcon :icon="ICONS.UI.FILE_PDF" :size="22" />
        <span>{{ file.title }}</span>
      </div>
    </template>

    <div v-else-if="current === 'online_video'" class="pm-mirror__label">
      <LjIcon :icon="ICONS.MEDIA.YOUTUBE" :size="22" />
      <span>{{ onlineTitle }}</span>
    </div>

    <div
      v-else-if="current === 'announcements' && announcement"
      class="pm-mirror__announcement"
      :style="{
        background: announcement.style?.bgColor || undefined,
        color: announcement.style?.textColor || undefined,
      }"
    >
      <img v-if="announcementImage" class="pm-mirror__media" :src="announcementImage" alt="" />
      <span v-else>{{ announcement.texto || announcement.nome }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Slide from "@/components/Slide.vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { applyVideoState } from "@/helpers/VideoSync";
import { VideoStateGate } from "@/helpers/VideoStateVersion";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useMainBackground } from "@/composables/useMainBackground";
import { useLiveContent } from "../composables/useLiveContent";

defineProps<{ cleared: boolean }>();

const { current, music, bible, file, onlineTitle, announcement } = useLiveContent();
const { style: background } = useMainBackground();

const bibleSlide = computed(() =>
  bible.value ? { lyric: bible.value.text, aux_lyric: bible.value.reference, is_bible: true } : null
);

/* O vídeo da miniatura é mudo e segue o relógio do áudio, como no Operador. */
const videoEl = ref<HTMLVideoElement | null>(null);
const gate = new VideoStateGate();
watch(
  () => file.value?.playback_id,
  (id) => gate.begin(id ?? null),
  { immediate: true }
);
useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload) => {
  const el = videoEl.value;
  if (!el || !gate.accepts(payload as never)) return;
  applyVideoState(el, payload as never);
});

/* Anúncio com imagem: o ArrayBuffer vira URL enquanto estiver na tela. */
const announcementImage = ref("");
watch(
  announcement,
  (slide) => {
    if (announcementImage.value) URL.revokeObjectURL(announcementImage.value);
    announcementImage.value = slide?.imageData
      ? URL.createObjectURL(new Blob([slide.imageData], { type: slide.imageMime || "image/png" }))
      : "";
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  if (announcementImage.value) URL.revokeObjectURL(announcementImage.value);
});
</script>

<style scoped>
.pm-mirror {
  position: relative;
  aspect-ratio: 16 / 9;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-live-stage-bg);
  color: var(--lj-white);
}

.pm-mirror__fill,
.pm-mirror__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.pm-mirror__media {
  object-fit: contain;
}

.pm-mirror__label,
.pm-mirror__announcement {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4);
  text-align: center;
  font-size: 11px;
}

.pm-mirror__label {
  color: var(--lj-white-alpha-50);
}
</style>
