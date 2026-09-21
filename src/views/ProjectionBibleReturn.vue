<template>
  <OverlayRenderer />
  <div
    class="return-root"
    :class="{ 'return-root--ready': ready }"
    :style="{ backgroundColor: backgroundColor, '--return-accent': ACCENT }"
  >
    <!-- Versículo atual: referência em faixa própria, texto no resto -->
    <div class="return-current" :style="{ background: backgroundColor }">
      <div class="return-head">
        <div v-if="active && displayReference" class="return-title" :style="referenceStyle">
          {{ displayReference }}
        </div>
      </div>

      <div ref="topBox" class="return-stage" :class="`align-${vertical_align}`">
        <div
          v-if="active && displayText"
          ref="topText"
          class="return-text"
          :style="textStyle"
          v-html="displayText"
        />
      </div>
    </div>

    <!-- Painel fixo no rodapé com o próximo versículo -->
    <div
      class="return-bottom"
      :style="{
        background: backgroundColor,
        height: `${SLIDE_STYLE_DEFAULT.return_height_bottom}vh`,
      }"
    >
      <div class="return-bottom-grid">
        <span class="return-next-label">{{ t("shell.proj_return_next") }}</span>
        <div class="return-next-text">
          <div v-if="nextReference" class="return-next-reference" :style="nextReferenceStyle">
            {{ nextReference }}
          </div>
          <div ref="nextBox" class="return-next-body">
            <span
              ref="nextEl"
              class="return-next-content"
              :style="nextTextStyle"
              v-html="nextHtml"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useFitText } from "@/composables/useFitText";
import Broadcast from "@/helpers/Broadcast";
import UserData from "@/helpers/UserData";
import { FONT, resolveFont } from "@/config/Fonts";
import { SLIDE_STYLE_DEFAULT } from "@/config/SlideStyle";
import { horizontalTextAlign, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";
import OverlayRenderer from "@/components/OverlayRenderer.vue";

const { t } = useI18n();
const MID = "modules.bible";

/** Cor de destaque do retorno (rótulo, borda, referência sem cor escolhida). */
const ACCENT = "#efb400";

/**
 * Pisos do ajuste automático, em vh. O tamanho da tela de formatação da Bíblia
 * é o teto; o texto só desce até aqui, e abaixo disso só se nem assim couber —
 * uma seleção enorme de versículos em letra pequena é melhor que cortada.
 */
const MIN_TEXT_VH = 2;
const MIN_NEXT_VH = 1.9;

const ready = ref(false);
const text = ref("");
const reference = ref("");
const book = ref("");
const chapter = ref("");
const verses = ref([]);
const version = ref("");
const nextText = ref("");
const nextReference = ref("");
const active = ref(false);

const _tick = ref(0);

function ud(key, fallback = null) {
  void _tick.value;
  const v = UserData.get(`${MID}.${key}`, fallback);
  return v == null ? fallback : v;
}

// Mesmos defaults da projeção (manifesto do módulo): uma preferência ausente
// não pode valer uma coisa na projeção e outra no retorno.
function udDefault(key, fallback) {
  return ud(key, moduleCustomizationDefault("bible", key, fallback));
}

function _vh(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
}

const font = computed(() =>
  resolveFont(udDefault("font", FONT.PROJECTION.INHERIT), FONT.PROJECTION.FALLBACK)
);
const font_color = computed(() => udDefault("font_color", "#FFFFFF"));
const vertical_align = computed(() => udDefault("vertical_align", "center"));
const horizontal_align = computed(() => udDefault("horizontal_align", "center"));
const backgroundColor = computed(() => udDefault("background_color", "#000000") || "#000000");

// O teto do texto é o "Tamanho da fonte" da formatação da Bíblia, lido como vh:
// quem aumenta o tamanho na projeção vê o retorno acompanhar, e o padrão (15)
// já dá uma letra grande. Quem escolhe o tamanho final é o ajuste automático.
const maxTextVh = computed(() => _vh(udDefault("font_size", 15), 15, 4, 60));
const referenceVh = computed(() => _vh(udDefault("reference_font_size", 10) * 0.34, 3.4, 1.6, 10));

const textShadowStyle = computed(() => {
  if (!udDefault("text_shadow", false)) return {};
  const color = udDefault("text_shadow_color", "#000000") || "#000000";
  const blur = udDefault("text_shadow_blur", 4) || 4;
  return { textShadow: `0 0 ${blur}px ${color}, 0 0 ${blur}px ${color}` };
});

// Sem `fontSize`: o tamanho é do ajuste automático (useFitText). O antigo
// clamp(24px, 11vh, 70px) ignorava a opção de tamanho e cortava versículo longo.
const textStyle = computed(() => ({
  color: font_color.value || "#FFFFFF",
  fontFamily: font.value || FONT.PROJECTION.FALLBACK,
  textAlign: horizontalTextAlign(horizontal_align.value),
  ...textShadowStyle.value,
}));

// O manifesto grava o padrão (laranja, feito para a projeção) no store, e ele
// não se distingue de uma escolha. Só o que difere dele vale como escolha do
// operador; do contrário, o dourado do retorno — o mesmo do rótulo e da borda.
const referenceColor = computed(() => {
  const chosen = ud("reference_font_color", null);
  const standard = moduleCustomizationDefault("bible", "reference_font_color", "");
  const isChosen =
    typeof chosen === "string" && chosen && chosen.toLowerCase() !== String(standard).toLowerCase();
  return isChosen ? chosen : ACCENT;
});

const referenceStyle = computed(() => {
  return {
    color: referenceColor.value,
    fontFamily: resolveFont(
      udDefault("reference_font", FONT.PROJECTION.INHERIT),
      FONT.PROJECTION.FALLBACK
    ),
    fontSize: `max(14px, ${referenceVh.value}vh)`,
  };
});

const nextTextStyle = computed(() => ({
  fontFamily: font.value || FONT.PROJECTION.FALLBACK,
  textAlign: horizontalTextAlign(horizontal_align.value),
}));

const nextReferenceStyle = computed(() => ({
  color: referenceColor.value,
  textAlign: horizontalTextAlign(horizontal_align.value),
}));

const showReference = computed(() => ud("show_reference", true));
const showVersion = computed(() => ud("show_version", true));
const referenceOnly = computed(() => ud("reference_only", false));

function numbersInterval(numbers) {
  if (!numbers || numbers.length === 0) return "";
  const sorted = [...numbers].sort((a, b) => a - b);
  const result = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      result.push(start === end ? `${start}` : `${start}-${end}`);
      start = sorted[i];
      end = sorted[i];
    }
  }
  result.push(start === end ? `${start}` : `${start}-${end}`);
  return result.join(", ");
}

const referenceOnlyText = computed(() => {
  if (!book.value || !chapter.value) return "";
  const interval = numbersInterval(verses.value);
  return `${book.value} ${chapter.value}${interval ? `:${interval}` : ""}`;
});

const displayText = computed(() => {
  if (referenceOnly.value) return referenceOnlyText.value;
  return text.value;
});

const displayReference = computed(() => {
  if (referenceOnly.value) return "";
  if (!showReference.value) return "";
  if (!showVersion.value) return referenceOnlyText.value;
  return reference.value;
});

const nextHtml = computed(() => nextText.value || "—");

const topBox = ref(null);
const topText = ref(null);
const nextBox = ref(null);
const nextEl = ref(null);

useFitText({
  box: topBox,
  text: topText,
  maxVh: () => maxTextVh.value,
  minVh: () => MIN_TEXT_VH,
  deps: () => [displayText.value, textStyle.value],
});

useFitText({
  box: nextBox,
  text: nextEl,
  maxVh: () => SLIDE_STYLE_DEFAULT.font_size_next,
  minVh: () => MIN_NEXT_VH,
  deps: () => [nextHtml.value, nextTextStyle.value, nextReference.value],
});

useBroadcastListener(BROADCAST_TYPE.BIBLE_VERSE, (payload) => {
  if (payload === null || payload.active === false) {
    window.close();
    return;
  }
  text.value = payload?.text || "";
  reference.value = payload?.reference || "";
  book.value = payload?.book || "";
  chapter.value = payload?.chapter || "";
  verses.value = payload?.verses || [];
  version.value = payload?.version || "";
  nextText.value = payload?.next_text || "";
  nextReference.value = payload?.next_reference || "";
  active.value = payload?.active ?? !!payload?.text;
});

useBroadcastListener(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, () => {
  _tick.value += 1;
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
  document.body.style.background = backgroundColor.value;

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

  // Solicita estado atual
  const requestState = () => {
    if (active.value) return;
    Broadcast.send(BROADCAST_TYPE.REQUEST_BIBLE_STATE, {});
  };
  requestState();
  setTimeout(requestState, 500);
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
  font-family: var(--lj-font-projection, sans-serif);
  opacity: 0;
  transition: opacity 120ms linear;
  box-sizing: border-box;
  padding: 24px 24px; /* área segura nas bordas */
}
.return-root--ready {
  opacity: 1;
}

.return-current {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
}

/* A referência tem a própria faixa: antes era absoluta sobre o texto. */
.return-head {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  padding: 2.4vh 2.5vw 0.6vh;
}

.return-title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

/* Caixa em que o versículo é ajustado: não depende do tamanho do texto
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

.align-start {
  align-items: flex-start;
}
.align-center {
  align-items: center;
}
.align-end {
  align-items: flex-end;
}

.return-text {
  width: 100%;
  min-width: 0;
  line-height: 1.3;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
  /* Versículo é prosa: quando o ajuste quebra a linha (white-space: normal
   * inline), reparte a quebra em vez de deixar uma palavra sozinha no fim. */
  text-wrap: balance;
}

.return-bottom {
  position: relative;
  flex: 0 0 auto;
  min-height: 72px;
  width: 100%;
  border-top: 2px solid var(--return-accent);
  display: flex;
  align-items: center;
  margin: 0;
  padding: 1vh 2.5vw;
  box-sizing: border-box;
  /* Guarda final: o ajuste já mantém o texto dentro do painel, mas uma fonte
   * local com métricas incomuns nunca pode desenhar fora da moldura. */
  overflow: clip;
}

.return-bottom-grid {
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

.return-next-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.return-next-reference {
  flex: 0 0 auto;
  font-size: max(12px, 2.6vh);
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.4vh;
}

/* Caixa do ajuste do próximo versículo. */
.return-next-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.return-next-content {
  display: block;
  width: 100%;
  min-width: 0;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  line-height: 1.25;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  overflow-wrap: anywhere;
  text-wrap: balance;
}
</style>
