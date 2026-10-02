<template>
  <div class="pm-pdf" data-testid="pm-pdf">
    <p v-if="!deck.total.value" class="pm-pdf__loading">{{ tm("library.loading") }}</p>
    <div v-else ref="grid" class="pm-pdf__grid">
      <button
        v-for="n in deck.total.value"
        :key="n"
        type="button"
        class="pm-pdf__page"
        :class="{
          'pm-pdf__page--live': n === deck.page.value,
          'pm-pdf__page--next': n === deck.page.value + 1,
        }"
        :disabled="locked"
        :data-testid="`pm-pdf-page-${n}`"
        @click="deck.goTo(n)"
      >
        <span v-intersect="() => deck.thumbOf(n)" class="pm-pdf__thumb">
          <img v-if="deck.thumbs.get(n)" :src="deck.thumbs.get(n)" alt="" />
        </span>
        <span class="pm-pdf__n">{{ n }}</span>
      </button>
    </div>
    <footer class="pm-pdf__bar">
      <LjIcon :icon="ICONS.UI.FILE_PDF" :size="14" />
      <span class="pm-pdf__counter" data-testid="pm-pdf-counter">
        {{ deck.page.value }} / {{ deck.total.value }}
      </span>
      <span class="pm-pdf__hint">{{ tm("pdf.hint") }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, type Directive } from "vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { usePdfDeck } from "../composables/usePdfDeck";

/**
 * Os slides do PDF no ar, como a grade de uma música: clicar vai à página; a
 * no ar em laranja, a próxima em azul. Miniaturas só das páginas à vista.
 */

defineProps<{ locked: boolean }>();
const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const deck = usePdfDeck();

/** Pede a miniatura quando a página entra na área visível. */
const vIntersect: Directive<HTMLElement, () => void> = {
  mounted(el, binding) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        binding.value();
        io.disconnect();
      }
    });
    io.observe(el);
    (el as HTMLElement & { _io?: IntersectionObserver })._io = io;
  },
  unmounted(el) {
    (el as HTMLElement & { _io?: IntersectionObserver })._io?.disconnect();
  },
};

const grid = ref<HTMLElement | null>(null);
watch(deck.page, async (n) => {
  await nextTick();
  grid.value?.querySelectorAll(".pm-pdf__page")[n - 1]?.scrollIntoView({ block: "nearest" });
});
</script>

<style scoped>
.pm-pdf {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-pdf__loading {
  margin: auto;
  color: var(--lj-white-alpha-50);
}

.pm-pdf__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 10px;
  align-content: start;
}

.pm-pdf__page {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: none;
  background: none;
  color: var(--lj-white-alpha-50);
  font: inherit;
  cursor: pointer;
}

.pm-pdf__page:disabled {
  cursor: default;
  opacity: 0.6;
}

.pm-pdf__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 2px solid var(--lj-white-alpha-20);
  border-radius: 3px;
  background: var(--lj-live-stage-bg);
}

.pm-pdf__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-pdf__page:hover .pm-pdf__thumb,
.pm-pdf__page:focus-visible .pm-pdf__thumb {
  border-color: var(--lj-white-alpha-50);
}

.pm-pdf__page:focus-visible {
  outline: none;
}

.pm-pdf__page--live .pm-pdf__thumb {
  border-color: var(--lj-orange);
}

.pm-pdf__page--next .pm-pdf__thumb {
  border-color: var(--lj-navy-active);
}

.pm-pdf__n {
  font-family: var(--lj-font-mono);
  font-size: 11px;
}

.pm-pdf__page--live .pm-pdf__n {
  color: var(--lj-orange);
  font-weight: 700;
}

.pm-pdf__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  flex-shrink: 0;
  border-top: 1px solid var(--lj-white-alpha-10);
  color: var(--lj-white-alpha-50);
  font-size: 11px;
}

.pm-pdf__counter {
  font-family: var(--lj-font-mono);
  color: var(--lj-white);
}

.pm-pdf__hint {
  margin-left: auto;
}
</style>
