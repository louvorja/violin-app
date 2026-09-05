<template>
  <div>
    <div v-if="slides.length === 0" class="rs-empty lj-u-text-center lj-u-muted">
      {{ t("shell.operator_waiting") }}
    </div>
    <template v-else>
      <div class="rs-ref lj-u-caption">
        <Icon :icon="ICONS.MUSIC.NOTE" size="small" />
        <span class="lj-u-truncate">{{ currentTitle }}</span>
      </div>
      <div class="rs-grid">
        <button
          v-for="(s, i) in slides"
          :key="i"
          type="button"
          class="rs-slide"
          :class="{ 'is-active': i === currentSlideIndex }"
          @click="goToSlide(i)"
        >
          <span class="rs-slide__num">{{ i + 1 }}</span>
          <span class="rs-slide__text" v-html="s.lyric || s.name || '—'" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { useI18n } from "vue-i18n";
import { Slide } from "@/types/Slide";
import { apiFetch } from "@/helpers/ApiClient";

const props = defineProps<{
  token?: string;
  slides: Slide[];
  currentSlideIndex: number;
  currentTitle: string;
}>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
  (e: "update:current-slide-index", index: number): void;
}>();

const { t } = useI18n();

function goToSlide(index: number): void {
  emit("update:current-slide-index", index);
  apiFetch(`/api/song-slides?action=go-to-slide&index=${index}&token=${props.token}`).catch(() =>
    emit("show-snackbar", "Erro ao trocar slide", "error")
  );
}
</script>

<style scoped>
.rs-empty {
  padding: var(--lj-space-8);
  font-size: var(--lj-text-lg);
}

/* Faixa de identificação da música. Sobre o fundo suave da página ela só se
   destaca com a superfície cheia, do mesmo jeito que as abas e o rodapé. */
.rs-ref {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-4) var(--lj-space-6);
  background: var(--lj-surface-bg);
  border-bottom: 1px solid var(--lj-surface-border);
  color: var(--lj-text-muted);
}

.rs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

.rs-slide {
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: 16/9;
  padding: var(--lj-space-4);
  overflow: hidden;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rs-slide.is-active {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rs-slide:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rs-slide__num {
  position: absolute;
  top: var(--lj-space-2);
  left: var(--lj-space-2);
  font-size: var(--lj-text-xs);
  opacity: 0.7;
}

.rs-slide__text {
  display: -webkit-box;
  margin: auto;
  overflow: hidden;
  font-size: var(--lj-text-sm);
  line-height: 1.2;
  text-align: center;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}
</style>
