<template>
  <video
    v-if="isVideo"
    v-bind="$attrs"
    :src="src || undefined"
    class="module-background-media"
    autoplay
    loop
    muted
    playsinline
    preload="auto"
    disablePictureInPicture
    tabindex="-1"
    aria-hidden="true"
  />
  <img
    v-else
    v-bind="$attrs"
    :src="src || undefined"
    class="module-background-media"
    alt=""
    loading="eager"
    decoding="async"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  src?: string | null;
  /** Força vídeo quando a URL é um blob/objeto sem extensão (fundo de slide). */
  video?: boolean;
}>();

const VIDEO_RE = /\.(mp4|webm|mkv|mov|m4v|avi|ogv)(?:[?#]|$)/i;

const isVideo = computed(() => {
  if (props.video === true) return true;
  const src = String(props.src || "");
  if (!src) return false;
  if (/#video(?:$|[?&#])/i.test(src) || /^data:video\//i.test(src)) return true;
  if (/#image(?:$|[?&#])/i.test(src) || /^data:image\//i.test(src)) return false;
  // URLs blob: não carregam a extensão; os pickers anexam #video para esse caso.
  return VIDEO_RE.test(src);
});
</script>

<style scoped>
.module-background-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
</style>
