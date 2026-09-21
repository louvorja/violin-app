<template>
  <OverlayRenderer />
  <div
    class="return-root"
    :class="{ 'return-root--ready': ready }"
    :style="{ backgroundColor: returnRootBackground, '--return-accent': cfg.progress_color }"
  >
    <!-- Slide atual (alClient): título e contador em fluxo, letra no resto -->
    <div class="return-current" :style="topPanelStyle">
      <!-- Progresso total da música (barra no topo) -->
      <div v-if="cfg.show_progress_bar" class="return-track-progress-bar">
        <div
          class="return-track-progress-fill"
          :style="{ width: progress + '%', background: cfg.progress_color }"
        />
      </div>

      <div class="return-head">
        <div v-if="title" class="return-title" :style="{ color: cfg.color_cover }">{{ title }}</div>
        <div v-if="totalSlides" class="return-counter">
          {{ slideIndex + 1 }} / {{ totalSlides }}
        </div>
      </div>

      <div ref="topBox" class="return-stage">
        <div
          v-if="topHtml"
          ref="topText"
          class="return-text"
          :class="{ 'return-text--cover': isCover }"
          :style="textStyle"
          v-html="topHtml"
        />
      </div>

      <!-- Barra de progresso fina no rodapé do painel atual -->
      <div v-if="cfg.show_progress_bar" class="return-progress-bar">
        <div
          class="return-progress-fill"
          :style="{ width: slideProgress + '%', background: cfg.progress_color }"
        />
      </div>
    </div>

    <!-- Painel fixo no rodapé com o próximo slide (alBottom Delphi) -->
    <div class="return-bottom" :style="bottomPanelStyle">
      <div class="return-bottom-grid">
        <span class="return-next-label">{{ t("shell.proj_return_next") }}</span>
        <div ref="nextBox" class="return-next-text">
          <span
            ref="nextText"
            class="return-next-content"
            :style="nextTextStyle"
            v-html="nextHtml"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectionState } from "@/composables/useProjectionState";
import { useSlideStyle } from "@/composables/useSlideStyle";
import { useFitText } from "@/composables/useFitText";
import OverlayRenderer from "@/components/OverlayRenderer.vue";

const { t } = useI18n();
const { slide, isCover, progress, slideProgress, title, slideIndex, totalSlides, nextSlide } =
  useProjectionState();
const slideStyle = useSlideStyle();
const cfg = slideStyle.cfg;

/**
 * Pisos do ajuste automático, em vh. O tamanho configurado nas Opções é o teto;
 * o texto só desce até aqui, e abaixo disso só se nem assim couber — cortar a
 * letra é pior que letra pequena.
 */
const MIN_TOP_VH = 2.6;
const MIN_NEXT_VH = 1.9;

const ready = ref(false);

const customBackground = computed(() => cfg.value.custom_return_background_active);

const returnRootBackground = computed(() =>
  customBackground.value
    ? cfg.value.return_bg_top_color || cfg.value.background_color || "#000000"
    : cfg.value.background_color || "#000000"
);

// A imagem de fundo só existe quando o operador a escolheu em "Fundo da tela de
// retorno personalizado". A capa do slide não entra: atrás da letra ela só
// tirava contraste de quem lê de longe.
const topPanelStyle = computed(() =>
  customBackground.value
    ? slideStyle.returnTopBgStyle()
    : { background: cfg.value.background_color }
);

const bottomPanelStyle = computed(() => ({
  ...(customBackground.value
    ? slideStyle.returnBottomBgStyle()
    : { background: cfg.value.background_color }),
  height: `${cfg.value.return_height_bottom}vh`,
}));

const topHtml = computed(() => slide.value?.lyric || slide.value?.name || "");
const nextHtml = computed(() => nextSlide.value?.lyric || nextSlide.value?.name || "—");

// Sem `fontSize` nem `maxWidth`: o tamanho é do ajuste automático (useFitText)
// e a largura é a do palco. Fixá-los aqui era o que cortava a letra.
const textStyle = computed(() => {
  const style = {
    ...(isCover.value ? slideStyle.coverStyle(slide.value) : slideStyle.lyricStyle(slide.value)),
  };
  delete style.fontSize;
  delete style.maxWidth;
  return { ...style, textTransform: slideStyle.returnTopTextTransform.value };
});

const nextTextStyle = computed(() => ({
  ...slideStyle.nextStyle(nextSlide.value),
  textTransform: slideStyle.returnBottomTextTransform.value,
  textAlign: cfg.value.custom_return_text_format_active
    ? cfg.value.return_bottom_text_align
    : "center",
}));

const topBox = ref(null);
const topText = ref(null);
const nextBox = ref(null);
const nextText = ref(null);

useFitText({
  box: topBox,
  text: topText,
  maxVh: () =>
    isCover.value ? cfg.value.return_font_size_cover : cfg.value.return_font_size_lyric,
  minVh: () => MIN_TOP_VH,
  deps: () => [topHtml.value, textStyle.value],
});

useFitText({
  box: nextBox,
  text: nextText,
  maxVh: () => cfg.value.font_size_next,
  minVh: () => MIN_NEXT_VH,
  deps: () => [nextHtml.value, nextTextStyle.value, cfg.value.return_height_bottom],
});

function _onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
}

onMounted(async () => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = returnRootBackground.value;

  try {
    await document.fonts.ready;
  } catch {
    /* font-loading API ausente — segue com fade-in imediato */
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ready.value = true;
    });
  });

  window.addEventListener("keydown", _onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", _onKey);
});
</script>

<style scoped>
.return-root,
.return-root :deep(*) {
  cursor: none;
}

.return-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #000;
  font-family: var(--lj-font-projection);
  opacity: 0;
  transition: opacity 120ms linear;
  box-sizing: border-box;
  padding: 24px 24px; /* área segura nas bordas */
}
.return-root--ready {
  opacity: 1;
}

/* Painel atual (alClient) */
.return-current {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000; /* fallback antes da configuração reativa carregar */
}

/* Título e contador ocupam a própria faixa: antes eram absolutos sobre a letra
 * e a primeira linha de uma estrofe comprida passava por baixo do título. */
.return-head {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 2vw;
  padding: 2.4vh 2.5vw 0.6vh;
}

.return-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: max(14px, 3.4vh);
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.return-counter {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: max(14px, 3.4vh);
  font-weight: 700;
  line-height: 1.2;
  color: var(--return-accent);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

/* O palco é a caixa em que a letra é ajustada: não depende do tamanho do texto
 * (flex 1 1 0 + min-height 0), senão a medida corria atrás de si mesma. */
.return-stage {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2.5vw 1.8vh;
  box-sizing: border-box;
}

.return-text {
  width: 100%;
  min-width: 0;
  text-align: center;
  line-height: 1.3;
  letter-spacing: 0.01em;
  color: #fff;
  overflow-wrap: anywhere;
  /* Só vale quando o ajuste precisou quebrar uma linha (white-space: normal
   * inline): reparte a quebra em vez de deixar uma palavra sozinha na última. */
  text-wrap: balance;
}

.return-text--cover {
  letter-spacing: 0.02em;
}

.return-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 10px;
  background: rgba(255, 255, 255, 0.1);
}

.return-progress-fill {
  height: 100%;
  transition: width 0.12s linear;
}

.return-track-progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 8px;
  background: rgba(255, 255, 255, 0.12);
  z-index: 2;
}

.return-track-progress-fill {
  height: 100%;
  transition: width 0.25s linear;
}

/* Painel inferior (alBottom Delphi) com o próximo slide */
.return-bottom {
  position: relative;
  flex: 0 0 auto;
  height: 22vh; /* fallback quando a configuração reativa ainda não carregou */
  min-height: 72px;
  width: 100%;
  background: #000; /* fallback antes da configuração reativa carregar */
  border-top: 2px solid var(--return-accent);
  display: flex;
  align-items: center;
  margin: 0;
  padding: 1vh 2.5vw;
  box-sizing: border-box;
  /* Guarda final: o ajuste já mantém a letra dentro do painel, mas uma fonte
   * local com métricas incomuns nunca pode desenhar fora da moldura. */
  overflow: clip;
}

.return-bottom-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 1.6vw;
  width: 100%;
  height: 100%;
  min-height: 0;
  align-items: center;
}

.return-next-label {
  font-size: max(12px, 2.6vh);
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--return-accent);
  background: color-mix(in srgb, var(--return-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--return-accent) 40%, transparent);
  padding: 0.3em 0.5em 0.1em;
  border-radius: var(--lj-radius-xs);
  text-transform: uppercase;
  white-space: nowrap;
}

/* Caixa do ajuste do próximo slide — mesma regra do palco: o tamanho vem do
 * painel, não do texto. */
.return-next-text {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.return-next-content {
  display: block;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
</style>
