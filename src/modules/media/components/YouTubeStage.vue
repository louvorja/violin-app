<template>
  <!-- Fora da janela do Mídia de propósito: minimizar a janela desmonta o conteúdo dela, e o
       vídeo que só toca aqui (sem janela de projeção) perderia o som. O palco fica no body e
       apenas se posiciona sobre a prévia; mover o iframe no DOM o recarregaria. -->
  <Teleport to="body">
    <Fullscreen
      v-if="mounted"
      v-model="fullscreen"
      class="media-yt-stage"
      data-theme="dark"
      data-window-layer
      :class="{ 'media-yt-stage--parked': !fullscreen && !rect }"
      :style="stageStyle"
    >
      <div v-show="!failed" ref="container" class="media-yt-stage__player" />
      <div v-if="failed" class="media-yt-stage__error">
        <span>{{ $t("projection.video_unavailable") }}</span>
        <small>{{ $t("projection.video_unavailable_hint") }}</small>
      </div>
      <l-fullscreen-player v-if="fullscreen" />
    </Fullscreen>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { component as Fullscreen } from "vue-fullscreen";
import LFullscreenPlayer from "@/components/FullscreenPlayer.vue";
import Media from "@/composables/useMedia";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useYouTubeEmbed } from "@/composables/useYouTubeEmbed";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { VideoMediaState } from "@/types/Media";

/** A prévia da janela do Mídia sobre a qual o palco se posiciona; null com a janela minimizada. */
const props = defineProps<{ anchor: HTMLElement | null }>();

// Sem notícia da projeção por este tempo, ela fechou (ou nunca tocou) e o som passa para cá.
const PROJECTION_SILENCE_MS = 3000;
const PROJECTION_STARTUP_MS = 12000;

const config = computed(() => Media.config() as Record<string, unknown> | undefined);
const source = computed(() => {
  const url = config.value?.is_youtube ? String(config.value.youtube_url || "") : "";
  const playbackId = String(config.value?.youtube_playback_id || "");
  return url && playbackId ? { url, playbackId } : null;
});
const fullscreen = computed({
  get: () => !!config.value?.fullscreen && !!source.value,
  set: (value: boolean) => Media.fullscreen(value),
});

const now = ref(Date.now());
const startedAt = ref(0);
const projectionSeenAt = ref(0);
let clock: ReturnType<typeof setInterval> | null = null;

watch(
  () => source.value?.playbackId,
  () => {
    startedAt.value = Date.now();
    projectionSeenAt.value = 0;
  },
  { immediate: true }
);

useBroadcastListener(BROADCAST_TYPE.YOUTUBE_STATE, (payload: unknown) => {
  const state = payload as VideoMediaState;
  if (state?.role !== undefined || state?.playback_id !== source.value?.playbackId) return;
  projectionSeenAt.value = Date.now();
});

const projectionCarries = computed(() => {
  if (projectionSeenAt.value) return now.value - projectionSeenAt.value < PROJECTION_SILENCE_MS;
  return !!config.value?.youtube_projected && now.value - startedAt.value < PROJECTION_STARTUP_MS;
});
const audible = computed(() => !projectionCarries.value);

const rect = ref<{ left: number; top: number; width: number; height: number } | null>(null);
// Com a projeção no ar e a janela do Mídia minimizada não há o que mostrar nem o que tocar aqui.
const mounted = computed(
  () => !!source.value && (audible.value || !!rect.value || fullscreen.value)
);
const stageStyle = computed(() =>
  rect.value && !fullscreen.value
    ? {
        left: `${rect.value.left}px`,
        top: `${rect.value.top}px`,
        width: `${rect.value.width}px`,
        height: `${rect.value.height}px`,
      }
    : undefined
);

const container = ref<HTMLElement | null>(null);
const { failed } = useYouTubeEmbed({
  container,
  source: () => (mounted.value ? source.value : null),
  role: "main",
  audible: () => audible.value,
  volume: () => Number(config.value?.volume ?? 100),
});

let observer: ResizeObserver | null = null;
let settleFrame = 0;

function measure(): void {
  const el = props.anchor;
  const box = el?.isConnected ? el.getBoundingClientRect() : null;
  if (!box || box.width < 1 || box.height < 1) {
    rect.value = null;
    return;
  }
  const next = { left: box.left, top: box.top, width: box.width, height: box.height };
  const current = rect.value;
  if (
    current &&
    current.left === next.left &&
    current.top === next.top &&
    current.width === next.width &&
    current.height === next.height
  )
    return;
  rect.value = next;
}

// A janela do Mídia entra com animação: a prévia só assenta alguns quadros depois de montada.
function settle(frames = 30): void {
  cancelAnimationFrame(settleFrame);
  const step = (left: number) => {
    measure();
    if (left > 0) settleFrame = requestAnimationFrame(() => step(left - 1));
  };
  step(frames);
}

watch(
  () => props.anchor,
  (el) => {
    observer?.disconnect();
    if (el) observer?.observe(el);
    settle();
  },
  { flush: "post" }
);

onMounted(() => {
  observer = new ResizeObserver(() => measure());
  if (props.anchor) observer.observe(props.anchor);
  window.addEventListener("resize", measure);
  clock = setInterval(() => (now.value = Date.now()), 1000);
  settle();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(settleFrame);
  window.removeEventListener("resize", measure);
  if (clock) clearInterval(clock);
});
</script>

<style>
.media-yt-stage {
  position: fixed;
  /* Sobre a janela do Mídia (dialog + 1), abaixo de menus e avisos. */
  z-index: calc(var(--lj-z-dialog) + 2);
  overflow: hidden;
  background: #000;
  /* O vídeo não recebe clique: avançar, voltar e pausar é na barra do player. */
  pointer-events: none;
}

/* Minimizada, a janela some mas o vídeo segue tocando: o player fica fora da tela, vivo. */
.media-yt-stage--parked {
  left: -10000px;
  top: 0;
  width: 320px;
  height: 180px;
}

.media-yt-stage.fullscreen {
  z-index: 9998;
  pointer-events: auto;
}

.media-yt-stage__player,
.media-yt-stage__player iframe {
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}

.media-yt-stage__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  height: 100%;
  color: var(--lj-white);
  text-align: center;
}

.media-yt-stage__error small {
  color: var(--lj-white-alpha-70);
}
</style>
