<template>
  <div class="projection-stage">
    <Slide
      :slide="slide"
      :title="title"
      :progress="progress"
      show-progress
      class="projection-fill"
    />
  </div>
  <OverlayRenderer />
  <ProjectionClearScreen />
  <LibrasOverlay
    :slide-lyric="slide?.lyric"
    :music-id="Number(slide?.id_music) || undefined"
    :slide-index="slideIndex"
    type="music"
  />
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import { useProjectionState } from "@/composables/useProjectionState";
import { useProjectionSlideKeys } from "@/composables/useProjectionSlideKeys";
import Slide from "@/components/Slide.vue";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import ProjectionClearScreen from "@/components/ProjectionClearScreen.vue";
import LibrasOverlay from "@/views/LibrasOverlay.vue";

const { slide, progress, title, slideIndex, totalSlides, sessionId } = useProjectionState();

useProjectionSlideKeys({ slideIndex, totalSlides, sessionId });

function _onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    setTimeout(() => window.close(), 200);
  }
}

onMounted(() => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000";
  window.addEventListener("keydown", _onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", _onKey);
});
</script>

<style scoped>
.projection-stage {
  width: 100vw;
  height: 100vh;
}
.projection-fill {
  width: 100%;
  height: 100%;
}
.projection-fill,
.projection-fill :deep(*) {
  cursor: none;
}
</style>
