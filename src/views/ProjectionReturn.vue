<template>
  <OverlayRenderer />
  <div
    class="return-root"
    :class="{ 'return-root--ready': ready }"
    :style="{ backgroundColor: returnRootBackground }"
  >
    <!-- Slide atual ocupa quase toda a tela (alClient) -->
    <div
      class="return-current"
      :style="{
        backgroundColor: slideStyle.cfg.value.custom_return_background_active
          ? slideStyle.returnTopBgStyle().backgroundColor
          : slideStyle.cfg.value.background_color,
      }"
    >
      <!-- Progresso total da música (barra no topo) -->
      <div v-if="slideStyle.cfg.value.show_progress_bar" class="return-track-progress-bar">
        <div
          class="return-track-progress-fill"
          :style="{ width: progress + '%', background: slideStyle.cfg.value.progress_color }"
        />
      </div>

      <!-- Imagem de fundo do slide atual -->
      <div
        v-if="returnTopBgInline"
        :key="returnTopHasImage ? slideStyle.cfg.value.return_bg_top_image : slide?.url_image"
        class="return-bg"
        :style="returnTopBgInline"
      />

      <div class="return-current-text">
        <div
          v-if="slide && (slide.lyric || slide.name)"
          class="return-text"
          :class="{ 'return-text--cover': isCover }"
          :style="textStyle"
          v-html="slide.lyric || slide.name"
        />
      </div>

      <!-- Título da música no topo -->
      <div v-if="title" class="return-title">{{ title }}</div>

      <!-- Barra de progresso fina no rodapé do painel atual -->
      <div v-if="slideStyle.cfg.value.show_progress_bar" class="return-progress-bar">
        <div
          class="return-progress-fill"
          :style="{ width: slideProgress + '%', background: slideStyle.cfg.value.progress_color }"
        />
      </div>
    </div>

    <!-- Painel fixo no rodapé com próximo slide + contador (alBottom Delphi) -->
    <div
      class="return-bottom"
      :style="{
        height: returnBottomHeight,
        backgroundColor: slideStyle.cfg.value.custom_return_background_active
          ? slideStyle.returnBottomBgStyle().backgroundColor
          : slideStyle.cfg.value.background_color,
        ...(slideStyle.cfg.value.custom_return_background_active
          ? slideStyle.returnBottomBgStyle()
          : {}),
      }"
    >
      <div
        v-if="returnBottomBgInline"
        class="return-bg"
        :style="{ ...returnBottomBgInline, position: 'absolute', inset: 0, opacity: 0.7 }"
      />
      <div class="return-bottom-grid">
        <div>
          <span class="return-next-label">{{ t("shell.proj_return_next") }}</span>
        </div>
        <div class="return-next-text">
          <span
            class="return-next-content"
            :style="{
              ...slideStyle.nextStyle(nextSlide),
              textTransform: slideStyle.returnBottomTextTransform.value,
              textAlign: slideStyle.cfg.value.custom_return_text_format_active
                ? slideStyle.cfg.value.return_bottom_text_align
                : undefined,
            }"
            v-html="nextSlide?.lyric || nextSlide?.name || '—'"
          />
        </div>
        <div class="return-counter">{{ slideIndex + 1 }} / {{ totalSlides || 0 }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectionState } from "@/composables/useProjectionState";
import { useSlideStyle } from "@/composables/useSlideStyle";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import Path from "@/helpers/Path";

const { t } = useI18n();
const { slide, isCover, progress, slideProgress, title, slideIndex, totalSlides, nextSlide } =
  useProjectionState();
const slideStyle = useSlideStyle();

const ready = ref(false);

const returnRootBackground = computed(() => {
  const cfg = slideStyle.cfg.value;
  return cfg.custom_return_background_active
    ? cfg.return_bg_top_color || cfg.background_color || "#000000"
    : cfg.background_color || "#000000";
});

const returnTopHasImage = computed(
  () =>
    slideStyle.cfg.value.custom_return_background_active &&
    !!slideStyle.cfg.value.return_bg_top_image
);

/** Estilo de fundo do painel superior: retorno próprio OU apenas a imagem do slide (sem fundo personalizado). */
const returnTopBgInline = computed(() => {
  if (returnTopHasImage.value) {
    const s = slideStyle.returnTopBgStyle();
    return {
      backgroundImage: s.backgroundImage,
      backgroundSize: s.backgroundSize,
      backgroundPosition: s.backgroundPosition,
      backgroundRepeat: s.backgroundRepeat,
      position: "absolute",
      inset: 0,
      opacity: 0.7,
    };
  }
  // Sem fundo de retorno: usa só a imagem do slide, ignorando o fundo
  // personalizado da projeção (que não deve vazar para o retorno).
  const slideUrl = slide.value?.url_image;
  if (!slideUrl) return null;
  let resolvedUrl = slideUrl;
  try {
    resolvedUrl = Path.file(slideUrl);
  } catch {
    /* mantém URL já resolvida por uma fonte externa */
  }
  return {
    backgroundImage: `url(${resolvedUrl})`,
    backgroundSize: "cover",
    backgroundPosition: "center center",
    backgroundRepeat: "no-repeat",
    position: "absolute",
    inset: 0,
    opacity: 0.7,
  };
});

const returnBottomHeight = computed(() => {
  const h = slideStyle.cfg.value.return_height_bottom;
  return `${h}vh`;
});

/** Estilo de fundo do painel inferior: retorno próprio OU fallback com cor sólida. */
const returnBottomBgInline = computed(() => {
  if (
    slideStyle.cfg.value.custom_return_background_active &&
    !!slideStyle.cfg.value.return_bg_bottom_image
  ) {
    const s = slideStyle.returnBottomBgStyle();
    return {
      backgroundImage: s.backgroundImage,
      backgroundSize: s.backgroundSize,
      backgroundPosition: s.backgroundPosition,
      backgroundRepeat: s.backgroundRepeat,
    };
  }
  return null;
});

// Reusa coverStyle / lyricStyle do composable, com tamanhos menores
// para o stage display (Return é menor que Projection fullscreen).
const textStyle = computed(() => {
  const base = isCover.value
    ? slideStyle.coverStyle(slide.value)
    : slideStyle.lyricStyle(slide.value);
  const cfg = slideStyle.cfg.value;
  const sizePct = isCover.value ? cfg.return_font_size_cover : cfg.return_font_size_lyric;
  return {
    ...base,
    fontSize: `clamp(24px, ${sizePct}vh, 160px)`,
    textTransform: slideStyle.returnTopTextTransform.value,
  };
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
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000; /* fallback antes da configuração reativa carregar */
}

.return-bg {
  position: absolute;
  inset: 0;
  opacity: 0.7;
}

.return-current-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.return-text {
  text-align: center;
  line-height: 1.3;
  text-shadow:
    0 2px 12px rgba(0, 0, 0, 0.9),
    0 0 40px rgba(0, 0, 0, 0.6);
  letter-spacing: 0.01em;
  max-width: 92vw;
  color: #fff;
}

.return-text--cover {
  letter-spacing: 0.02em;
}

.return-title {
  position: absolute;
  top: 20px;
  left: 15px;
  right: 16px;
  font-size: 1.7rem;
  font-weight: 500;
  color: #efb400;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
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
  background: #efb400;
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
  background: #efb400;
  transition: width 0.25s linear;
}

/* Painel inferior (alBottom Delphi: 39px) com próximo slide */
.return-bottom {
  position: relative;
  flex: 0 0 auto;
  height: 18vh; /* fallback quando formatação retorno não está ativa */
  min-height: 90px;
  width: 100%;
  background: #000; /* fallback antes da configuração reativa carregar */
  border-top: 2px solid #efb400;
  overflow: hidden;
  display: flex;
  align-items: center;
  margin: 0;
  padding: 8px;
  /* Base para o `cqh` de `nextStyle()` (useSlideStyle.ts) — a fonte do
   * próximo slide precisa ser % deste painel, não da tela inteira. */
  container-type: size;
  /* Guarda final: a fonte já é limitada antes do layout, mas uma fonte local
   * com métricas incomuns nunca pode desenhar fora da moldura do retorno. */
  overflow: clip;
}

.return-bottom-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
  align-items: center;
}

.return-next-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  height: 100%;
  font-size: 14px;
}

.return-next-label {
  font-size: 2vh;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #efb400;
  background: rgba(239, 180, 0, 0.12);
  border: 1px solid rgba(239, 180, 0, 0.4);
  padding: 5px 5px 0 5px;
  border-radius: var(--lj-radius-xs);
  flex-shrink: 0;
  text-transform: uppercase;
}

.return-next-content {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  line-height: 1.35;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  word-wrap: break-word;
  overflow-wrap: break-word;
  flex: 1;
  /* Segunda camada de proteção: se mesmo com o `cqh` corrigido a fonte
   * configurada não couber em duas linhas, corta com reticências no fim
   * da 2ª linha em vez de cortar no meio de uma linha pelo overflow do
   * `.return-next-text` pai — nunca mais "comido" de forma ilegível. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  max-height: 100%;
}

.return-counter {
  font-size: clamp(20px, 7vh, 70px);
  font-weight: 700;
  color: #efb400;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  padding-left: 12px;
  border-left: 3px solid rgba(239, 180, 0, 0.3);
  align-self: center;
  white-space: nowrap;
  line-height: 1;
  max-height: 100%;
}
</style>
