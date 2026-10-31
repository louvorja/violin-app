<template>
  <div class="pm-slides" data-testid="pm-stage-slides">
    <SlideGrid
      :slides="slides.slides.value"
      :title="slides.title.value"
      :live-index="index"
      :disabled="locked"
      @pick="goTo"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import Media from "@/composables/useMedia";
import { useSlides } from "@/composables/useSlides";
import SlideGrid from "./SlideGrid.vue";

/**
 * Grade de slides da música no ar. Cada miniatura é o `Slide.vue` real, com a
 * fonte e o posicionamento da projeção; clicar leva a projeção àquele slide
 * (com áudio, a música pula para o tempo do slide). Tocar, posição e tempo
 * ficam na barra de controle do centro.
 */

const props = defineProps<{ locked: boolean }>();

const slides = useSlides();
const index = computed(() => slides.slideIndex.value);

function goTo(i: number): void {
  if (props.locked) return;
  Media.goToSlide(i);
}

// O slide no ar fica sempre à vista, mesmo quando a música avança sozinha.
watch(index, async (i) => {
  await nextTick();
  document
    .querySelector(`[data-testid="pm-slide-${i}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});
</script>

<style scoped>
.pm-slides {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
