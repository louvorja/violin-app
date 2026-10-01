<template>
  <div class="pm-return" data-testid="pm-return-mirror">
    <div v-if="cleared" class="pm-return__fill" :style="background" />
    <div
      v-else-if="override"
      class="pm-return__fill pm-return__override"
      data-testid="pm-return-override"
    >
      <img v-if="override.type === 'image'" :src="override.url" alt="" />
      <video v-else :src="override.url" muted autoplay playsinline />
      <span class="pm-return__only">{{ tm("outputs.return_only") }}</span>
    </div>
    <div v-else class="pm-return__frame">
      <div class="pm-return__current">
        <div class="pm-return__head">
          <span class="pm-return__title">{{ view.title }}</span>
        </div>
        <p class="pm-return__text">{{ view.text }}</p>
      </div>
      <div class="pm-return__bottom">
        <span class="pm-return__pill">{{ t("shell.proj_return_next") }}</span>
        <span class="pm-return__next">{{ view.next }}</span>
        <span class="pm-return__counter">{{ view.counter }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useMainBackground } from "@/composables/useMainBackground";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useLiveContent } from "../composables/useLiveContent";

/**
 * Miniatura do retorno de palco. A composição é a do `ProjectionReturn.vue`
 * (faixa atual em cima, "próximo" embaixo, contador em dourado), refeita em
 * unidades do contêiner: a view real mede tudo pela janela e fecha a janela
 * no Esc — não dá para embuti-la na janela principal.
 */

const props = defineProps<{
  cleared: boolean;
  /** Próximo item do programa, quando o conteúdo no ar não tem próxima parte. */
  upNext: string;
  /** Posição na pasta ou na lista de vídeos ("3/12"), quando o que está no ar veio dela. */
  queueCounter?: string;
  /** Imagem ou vídeo só no retorno — cobre a composição normal. */
  override?: { type: "image" | "video"; url: string } | null;
}>();

const { t } = useI18n();
const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { current, music, bible, file, onlineTitle, announcement } = useLiveContent();
const { style: background } = useMainBackground();

function plain(html: string | undefined | null): string {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

const view = computed(() => {
  switch (current.value) {
    case "music": {
      const total = music.totalSlides.value;
      const next = plain(music.nextSlide.value?.lyric);
      return {
        title: music.title.value,
        text: plain(music.slide.value?.lyric) || music.title.value,
        next: next || props.upNext,
        counter: total ? `${music.slideIndex.value + 1}/${total}` : "",
      };
    }
    case "bible":
      return {
        title: bible.value?.reference ?? "",
        text: bible.value?.text ?? "",
        next: bible.value?.nextReference || props.upNext,
        counter: "",
      };
    case "file":
      return {
        title: file.value?.title ?? "",
        text: file.value?.title ?? "",
        next: props.upNext,
        counter: props.queueCounter || "1/1",
      };
    case "online_video":
      return {
        title: onlineTitle.value,
        text: onlineTitle.value,
        next: props.upNext,
        counter: props.queueCounter || "1/1",
      };
    case "announcements":
      return {
        title: announcement.value?.nome ?? "",
        text: announcement.value?.texto || announcement.value?.nome || "",
        next: props.upNext,
        counter: "",
      };
    default:
      return { title: "", text: "", next: props.upNext, counter: "" };
  }
});
</script>

<style scoped>
.pm-return {
  position: relative;
  aspect-ratio: 16 / 9;
  width: 100%;
  overflow: hidden;
  /* As unidades cq valem para os filhos, nunca para o próprio contêiner. */
  container-type: size;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-color-projection-bg);
  color: var(--lj-white);
  font-family: var(--lj-font-projection);
}

.pm-return__fill {
  position: absolute;
  inset: 0;
}

.pm-return__override {
  background: var(--lj-color-projection-bg);
}

.pm-return__override img,
.pm-return__override video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-return__only {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 5px;
  border-radius: 2px;
  background: var(--lj-color-cover-gold);
  color: var(--lj-color-projection-bg);
  font-family: var(--lj-font-shell);
  font-size: 9px;
  font-weight: 700;
}

.pm-return__frame {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 3cqh;
  padding: 4cqh 3cqw;
}

.pm-return__current {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 3cqh 3cqw;
  background: var(--lj-live-return-slide-bg);
}

.pm-return__head {
  display: flex;
  align-items: baseline;
  gap: 2cqw;
}

.pm-return__title {
  flex: 1;
  min-width: 0;
  font-size: 6cqh;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--lj-color-cover-gold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-return__text {
  flex: 1;
  min-height: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  text-align: center;
  white-space: pre-line;
  font-size: 8cqh;
  font-weight: 700;
  line-height: 1.15;
  text-transform: uppercase;
}

.pm-return__bottom {
  display: flex;
  align-items: center;
  gap: 2cqw;
  height: 22cqh;
  flex-shrink: 0;
  padding: 0 3cqw;
  background: var(--lj-color-return-bg);
  border-top: 2px solid var(--lj-color-cover-gold);
}

.pm-return__pill {
  flex-shrink: 0;
  padding: 0.6cqh 1.4cqw;
  border: 1px solid var(--lj-color-cover-gold);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-color-cover-gold);
  font-size: 5cqh;
  font-weight: 700;
  text-transform: uppercase;
}

.pm-return__next {
  flex: 1;
  min-width: 0;
  font-size: 5.5cqh;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-return__counter {
  flex-shrink: 0;
  font-size: 9cqh;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--lj-color-cover-gold);
}
</style>
