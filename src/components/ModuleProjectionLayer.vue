<!--
  Conteúdo da projeção de um módulo de Utilitários (timer, contador, relógio,
  cronômetro, quadro, nome sorteado, painel…), separado da janela para poder ser
  renderizado em dois lugares.

  Na janela própria (`ModuleProjection.vue`) ele abre uma tela cheia; com a
  Projeção de Fundo ligada, `BackgroundProjection.vue` monta ESTE mesmo
  componente como mais uma camada — aí o utilitário entra e sai com o mesmo
  fade das músicas, da bíblia e do arquivo, em vez de uma janela opaca
  aparecendo por cima do telão.

  O `moduleId` vem por prop aqui (na janela ele vinha da query string): a janela
  de fundo não tem query para ler.
-->
<template>
  <DrawProjection v-if="isDraw" :text="text" :reference="reference" :active="active" />
  <NameDrawProjection v-else-if="isNameDraw" :text="text" :reference="reference" :active="active" />
  <div
    v-else
    ref="container"
    class="module-projection"
    :class="[`lj-u-align-${vertical_align}`, `lj-u-justify-${horizontal_align}`]"
    :style="{
      background: background_color || '#000000',
      padding: `${border_spacing_px}px`,
    }"
  >
    <img
      v-if="image"
      :src="image"
      alt=""
      :style="{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: image_fit || 'cover',
        opacity: (image_opacity ?? 100) / 100,
        zIndex: 0,
      }"
    />

    <Transition :name="isLive ? 'no-transition' : 'fade-content'" mode="out-in">
      <div
        v-if="active && (text || extra)"
        :key="transitionKey"
        class="module-projection__content"
        :style="textBox"
      >
        <span
          v-if="text"
          v-fit-clock-line="
            moduleId === ModuleEnum.CLOCK ? { size: font_size_px, widthFrom: container } : null
          "
          :class="['module-projection__text', `module-projection__text--${moduleId}`]"
          :style="{
            color: color || font_color || '#FFFFFF',
            fontSize: font_size_px + 'px',
            fontFamily: font || FONT.PROJECTION.FALLBACK,
            textAlign: textAlign,
            ...textShadowStyle,
          }"
        >
          {{ text }}
        </span>

        <span
          v-if="extra"
          v-fit-clock-line="
            moduleId === ModuleEnum.CLOCK ? { size: ref_font_size_px, widthFrom: container } : null
          "
          :class="[
            'module-projection__extra',
            { 'module-projection__extra--clock': moduleId === ModuleEnum.CLOCK },
          ]"
          :style="{
            color: reference_font_color || font_color || '#FB8C00',
            fontSize: ref_font_size_px + 'px',
            fontFamily: reference_font || font || FONT.PROJECTION.FALLBACK,
            textAlign: extraAlign,
            ...(moduleId === ModuleEnum.CLOCK ? { fontWeight: 300, letterSpacing: '0.05em' } : {}),
          }"
        >
          {{ extra }}
        </span>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import Broadcast from "@/helpers/Broadcast";
import UserData from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { FONT, resolveFont } from "@/config/Fonts";
import { ModuleEnum } from "@/enums/ModuleEnum";
import DrawProjection from "@/modules/draw/components/DrawProjection.vue";
import NameDrawProjection from "@/modules/name_draw/components/NameDrawProjection.vue";
import { useContainerSize } from "@/composables/useContainerSize";
import {
  horizontalTextAlign,
  moduleCustomizationDefault,
  textBoxStyle,
} from "@/helpers/ModuleFormatting";
import { vFitClockLine } from "@/modules/clock/vFitClockLine";

const { container, fontSizePc } = useContainerSize();

const MID = computed(() => `modules.${moduleId.value}`);

/**
 * Qual módulo esta camada mostra. Na janela própria vem da query string
 * (`?module=<id>`); aqui vem por prop, porque a janela de fundo não tem query.
 */
const props = defineProps({ moduleId: { type: String, default: "" } });
const moduleId = computed(() => props.moduleId);

const text = ref("");
const extra = ref(""); // referência, "Sorteado:", etc.
const reference = ref([]); // draw envia string[] de sorteados (chips)
const active = ref(false);
const color = ref("");

// Módulo draw/name_draw têm layout dedicado que monta chips.
const isDraw = computed(() => moduleId.value === ModuleEnum.DRAW);
const isNameDraw = computed(() => moduleId.value === ModuleEnum.NAME_DRAW);

// Tick force re-read do UserData quando broadcast chega.
const _tick = ref(0);

function ud(key, fallback = null) {
  void _tick.value;
  if (!moduleId.value) return fallback;
  const manifestDefault = moduleCustomizationDefault(moduleId.value, key, fallback);
  const v = UserData.get(`${MID.value}.${key}`, manifestDefault);
  return v == null ? manifestDefault : v;
}

const font = computed(() => {
  const saved =
    ud("font", null) || UserData.get(KEYS.OPTIONS.UTILITIES_FONT, "") || FONT.PROJECTION.INHERIT;
  return resolveFont(saved, FONT.PROJECTION.FALLBACK);
});
const font_color = computed(() => ud("font_color", "#FFFFFF"));
const font_size = computed(() => ud("font_size", 15));
const text_shadow = computed(() => ud("text_shadow", false));
const text_shadow_color = computed(() => ud("text_shadow_color", "#000000"));
const text_shadow_blur = computed(() => ud("text_shadow_blur", 4));
const reference_font = computed(() =>
  resolveFont(ud("reference_font", null), font.value, font.value)
);
const reference_font_color = computed(() => ud("reference_font_color", "#FB8C00"));
const reference_font_size = computed(() => ud("reference_font_size", 10));
const background_color = computed(() => ud("background_color", "#000000"));
const text_background_color = computed(() => ud("text_background_color", "transparent"));
const text_background_enabled = computed(() => ud("text_background_enabled", false));
const text_background_opacity = computed(() => ud("text_background_opacity", 100));
const text_border_enabled = computed(() => ud("text_border_enabled", false));
const text_border_color = computed(() => ud("text_border_color", "#FFFFFF"));
const text_border_opacity = computed(() => ud("text_border_opacity", 100));
const text_border_radius = computed(() => ud("text_border_radius", 0));
const text_border_width = computed(() => ud("text_border_width", 2));

/**
 * Fundo e borda da caixa — o MESMO helper do programa (`useModuleBodyStyle`),
 * para o mesmo módulo não sair diferente no telão.
 */
const textBox = computed(() =>
  textBoxStyle({
    enabled: text_background_enabled.value,
    color: text_background_color.value,
    opacity: text_background_opacity.value,
    borderEnabled: text_border_enabled.value,
    borderColor: text_border_color.value,
    borderOpacity: text_border_opacity.value,
    borderRadius: text_border_radius.value,
    borderWidth: text_border_width.value,
  })
);
const border_spacing = computed(() => ud("border_spacing", 10));
const vertical_align = computed(() => ud("vertical_align", "center"));
const horizontal_align = computed(() => ud("horizontal_align", "center"));
const image = computed(() => ud("image", ""));
const image_opacity = computed(() => ud("image_opacity", 100));
const image_fit = computed(() => ud("image_fit", "cover"));

const textAlign = computed(() => {
  return horizontalTextAlign(horizontal_align.value);
});
const extraAlign = computed(() =>
  moduleId.value === ModuleEnum.CLOCK
    ? textAlign.value
    : horizontal_align.value === "start"
      ? "left"
      : "right"
);

const textShadowStyle = computed(() => {
  if (!text_shadow.value) return {};
  const color = text_shadow_color.value || "#000000";
  const blur = text_shadow_blur.value || 4;
  const css = `0 0 ${blur}px ${color}, 0 0 ${blur}px ${color}`;
  return { textShadow: css };
});

const font_size_px = computed(() => fontSizePc(font_size.value));
const ref_font_size_px = computed(() => fontSizePc(reference_font_size.value));
const border_spacing_px = computed(() => Number(border_spacing.value) || 10);

// Módulos com valor que muda continuamente (clock, stopwatch, draw-roleta)
// — desabilita a transição fade pra não "piscar" a cada troca. A `key` fica
// estável (apenas troca quando active passa para true/false).
const LIVE_MODULES = new Set([
  ModuleEnum.CLOCK,
  ModuleEnum.STOPWATCH,
  ModuleEnum.TIMER,
  ModuleEnum.TIMER_WORSHIP,
  ModuleEnum.DRAW,
]);
const isLive = computed(() => LIVE_MODULES.has(moduleId.value));
const transitionKey = computed(() =>
  isLive.value ? `live:${active.value}` : `${text.value}|${extra.value}`
);

const EMPTY_ICONS = {
  bible: "📖",
  message_board: "📋",
  draw: "🎲",
  name_draw: "👥",
  counter: "🔢",
  clock: "🕐",
  stopwatch: "⏱",
  timer: "⏳",
};
const emptyIcon = computed(() => EMPTY_ICONS[moduleId.value] || "🖥");
const emptyHint = computed(() => "Aguardando…");

useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_VALUE, (payload) => {
  if (!payload || payload.module !== moduleId.value) return;
  text.value = payload.text || "";
  if (isDraw.value || isNameDraw.value) {
    reference.value = Array.isArray(payload.reference) ? payload.reference : [];
    extra.value = "";
  } else {
    extra.value = payload.reference || payload.extra || "";
  }
  active.value = payload.active ?? true;
  color.value = payload.color || "";
});

useBroadcastListener(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, (payload) => {
  if (!payload || payload.module !== moduleId.value) return;
  _tick.value += 1;
});

useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
  if (!payload || typeof payload.path !== "string") return;
  if (
    payload.path.startsWith(`modules.${moduleId.value}.`) ||
    payload.path === "options.utilities_font" ||
    payload.path === "options.font"
  ) {
    _tick.value += 1;
  }
});

onMounted(() => {
  // Pede o estado atual à janela principal (request-state pattern).
  // Broadcast REQUEST_MODULE_STATE é fire-and-forget: se a projeção abre
  // depois do módulo já ter emitido, não recebe nada e fica vazia. Pequeno
  // delay para garantir que o listener da janela principal já está ativo
  // após o roteamento. Tenta várias vezes se ainda estiver vazio — resolve
  // latências de abertura de janela no Electron (mesmo padrão da Bíblia).
  const requestState = () => {
    if (active.value) return; // Já recebeu estado
    Broadcast.send(BROADCAST_TYPE.REQUEST_MODULE_STATE, { module: moduleId.value });
  };
  requestState();
  setTimeout(requestState, 100);
  setTimeout(requestState, 500);
  setTimeout(requestState, 1000);
});
</script>

<style scoped>
/*
 * Na janela própria o módulo ocupa a tela inteira; dentro da janela de fundo é
 * uma camada — quem dá o tamanho é o pai.
 */
.module-projection {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  box-sizing: border-box;
  overflow: hidden;
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
.justify-start {
  justify-content: flex-start;
}
.justify-center {
  justify-content: center;
}
.justify-end {
  justify-content: flex-end;
}

/*
 * A caixa acompanha o texto, como a dos slides (`Slide.vue`): o pai é flex e
 * nunca estica os filhos, então `fit-content` + padding lateral dão a mesma
 * margem ao redor da letra. Era `width: 100%` — o fundo preenchia a linha toda.
 */
.module-projection__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  width: fit-content;
  padding: 0.2em 0.4em;
}

.module-projection__text {
  white-space: pre-wrap;
  line-height: 1.4;
}

/* Os módulos utilitários usam estes mesmos pesos e métricas no preview do
   programa. Sem a classe, a projeção caía no peso normal do navegador e o
   relógio/cronômetros pareciam ter outra formatação, mesmo com a mesma fonte
   e tamanho configurados. */
.module-projection__text--clock {
  font-weight: 300;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}
.module-projection__text--counter {
  font-weight: 200;
  font-variant-numeric: tabular-nums;
}
.module-projection__text--stopwatch,
.module-projection__text--timer,
.module-projection__text--timer_worship {
  font-weight: 300;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  white-space: pre-line;
}

.module-projection__extra {
  margin-top: 0.4em;
  letter-spacing: 0.02em;
}

.module-projection__extra--clock {
  margin-top: 0.15em;
  line-height: 1.1;
  white-space: nowrap;
}

.module-projection__empty {
  position: relative;
  z-index: 1;
  text-align: center;
  color: rgba(255, 255, 255, 0.32);
  user-select: none;
}

.module-projection__empty-icon {
  font-size: 6vw;
  margin-bottom: 1vw;
  opacity: 0.55;
}

.module-projection__empty-hint {
  font-size: 1.5vw;
  font-family: DINCondensedBold;
  letter-spacing: 0.04em;
}

.fade-content-enter-active,
.fade-content-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.fade-content-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-content-leave-to {
  opacity: 0;
}

/* Módulos "live" (clock/stopwatch) — sem transição entre tics. */
.no-transition-enter-active,
.no-transition-leave-active {
  transition: none;
}
</style>
