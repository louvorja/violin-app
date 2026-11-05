<template>
  <div
    ref="container"
    :class="['lj-u-flex', `lj-u-align-${vertical_align}`, `lj-u-justify-${horizontal_align}`]"
    :style="containerStyle"
  >
    <!--    Imagem de fundo -->
    <ModuleBackgroundMedia
      v-if="image"
      :src="image"
      :style="{
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        position: 'absolute',
        objectFit: image_fit,
        opacity: (image_opacity ?? 100) / 100,
      }"
    />

    <div
      v-if="active && (wheel || text)"
      class="draw-proj-content"
      :style="{ textAlign: horizontalTextAlign(horizontal_align), color: font_color }"
    >
      <!-- Sem wheel (texto avulso), a mesma faixa do wheel vira o fundo do texto. -->
      <span
        v-if="!wheel && text_background_enabled"
        class="draw-proj-band"
        :style="bandStyle ?? undefined"
        aria-hidden="true"
      />
      <div
        v-if="wheel"
        class="draw-proj-wheel"
        :style="{
          color: font_color,
          fontSize: `${fontSizePc(font_size)}px`,
          fontFamily: font,
          ...textShadowStyle,
        }"
      >
        <DrawWheel :wheel="wheel" :band-style="bandStyle" :font-key="wheelFontKey" />
      </div>
      <span
        v-else-if="text"
        class="draw-proj-number"
        :class="{ 'draw-proj-number--name': mode === 'names' }"
        :style="{
          color: font_color,
          fontSize: `${fontSizePc(font_size)}px`,
          fontFamily: font,
          ...textShadowStyle,
        }"
      >
        {{ text }}
      </span>
    </div>

    <Transition name="draw-history">
      <div
        v-if="active && chips.length"
        class="draw-proj-footer"
        :style="{
          padding: `0 ${Number(border_spacing) || 10}px ${Number(border_spacing) || 10}px`,
        }"
      >
        <span class="draw-proj-label" :style="{ color: font_color }">
          {{ tm("data.drawn") }}
        </span>
        <div class="draw-proj-chip-list">
          <span
            v-for="(c, i) in chips"
            :key="`${c}-${i}`"
            class="draw-proj-chip"
            :style="{
              color: background_color,
              background: font_color,
              fontSize: `${fontSizePc(chip_font_size / 3)}px`,
            }"
          >
            {{ c }}
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type CSSProperties } from "vue";
import UserData from "@/helpers/UserData";
import type { ModuleWheelState } from "@/presentation/ModulePresentationState";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import DrawWheel from "./DrawWheel.vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useContainerSize } from "@/composables/useContainerSize";
import { useStoredImageUrl } from "@/composables/useStoredImageUrl";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useI18n } from "vue-i18n";
import { getModule } from "@/config/modules";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { FONT, resolveFont } from "@/config/Fonts";
import { horizontalTextAlign, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";
import { corComAlfa, larguraDeBorda, raioDeBorda } from "@/helpers/ColorAlpha";

interface Props {
  text?: string;
  /** `string[]` de números sorteados — cada string vira um chip. */
  reference?: string[] | string | null;
  active?: boolean;
  height?: number | null;
  mode?: "number" | "names";
  wheel?: ModuleWheelState | null;
}

const props = withDefaults(defineProps<Props>(), {
  text: "",
  reference: null,
  active: true,
  height: null,
  mode: "number",
  wheel: null,
});

const module = getModule(ModuleEnum.DRAW);
const { t: i18nT } = useI18n();
const tm = (text: string): string => i18nT(`modules.${module?.id}.${text}`);

const { container, fontSizePc } = useContainerSize();

// Tick reativo — re-lê o UserData quando formatação muda (ribbon/format).
const tick = ref(0);

function ud<T>(key: string, fallback: T): T {
  void tick.value;
  const manifestDefault = moduleCustomizationDefault(ModuleEnum.DRAW, key, fallback);
  const v = UserData.get<T>(`modules.draw.${key}`, manifestDefault);
  return v == null ? manifestDefault : v;
}

const background_color = computed(() => ud("background_color", "#000000"));
const font = computed(() => resolveFont(ud("font", null), FONT.PROJECTION.FALLBACK));
const font_color = computed(() => ud("font_color", "#FFFFFF"));
const font_size = computed(() => ud("font_size", props.mode === "names" ? 40 : 50));
const wheelFontKey = computed(() => `${font.value}|${fontSizePc(font_size.value)}`);
const text_shadow = computed(() => ud("text_shadow", false));
const text_shadow_color = computed(() => ud("text_shadow_color", "#000000"));
const text_shadow_blur = computed(() => ud("text_shadow_blur", 4));
const text_background_enabled = computed(() => ud("text_background_enabled", false));
const text_background_color = computed(() => ud("text_background_color", "transparent"));
const text_background_opacity = computed(() => ud("text_background_opacity", 100));
const text_border_enabled = computed(() => ud("text_border_enabled", false));
const text_border_color = computed(() => ud("text_border_color", "#FFFFFF"));
const text_border_opacity = computed(() => ud("text_border_opacity", 100));
const text_border_radius = computed(() => ud("text_border_radius", 0));
const text_border_width = computed(() => ud("text_border_width", 2));
const text_padding_x = computed(() => ud("text_padding_x", 0));
const text_padding_y = computed(() => ud("text_padding_y", 0));
const chip_font_size = computed(() => ud("chip_font_size", 12));
const border_spacing = computed(() => ud("border_spacing", 10));
const vertical_align = computed<CSSProperties["alignItems"]>(
  () => ud("vertical_align", "center") as CSSProperties["alignItems"]
);
const horizontal_align = computed<CSSProperties["justifyContent"]>(
  () => ud("horizontal_align", "center") as CSSProperties["justifyContent"]
);
const image = useStoredImageUrl(() => ud("image", ""));
const image_opacity = computed(() => ud("image_opacity", 100));
const image_fit = computed<CSSProperties["objectFit"]>(
  () => ud("image_fit", "cover") as CSSProperties["objectFit"]
);

// Fundo do texto = a própria faixa central do wheel, com cor/opacidade do painel.
// O padding horizontal encurta a faixa e o vertical aumenta a espessura.
const bandStyle = computed<CSSProperties | null>(() => {
  if (!text_background_enabled.value) return null;
  const inset = Math.max(0, Number(text_padding_x.value) || 0);
  const extraY = Math.max(0, Number(text_padding_y.value) || 0);
  // A faixa de fallback não tem o font-size do wheel como referência; usa px
  // para manter a mesma altura da fonte configurada nos dois casos.
  const bandHeight = fontSizePc(font_size.value) * 1.18 + extraY * 2;
  const borderWidth = larguraDeBorda(text_border_width.value);
  const borderColor = corComAlfa(text_border_color.value, text_border_opacity.value);
  const borderRadius = raioDeBorda(text_border_radius.value);
  return {
    left: `calc(5% + ${inset}px)`,
    right: `calc(5% + ${inset}px)`,
    height: `${bandHeight}px`,
    background: corComAlfa(text_background_color.value, text_background_opacity.value),
    border:
      text_border_enabled.value && borderWidth > 0
        ? `${borderWidth}px solid ${borderColor}`
        : "none",
    ...(text_border_enabled.value && borderRadius > 0 ? { borderRadius: `${borderRadius}px` } : {}),
    boxSizing: "border-box",
  };
});

const chips = computed(() => {
  const r = props.reference;
  return Array.isArray(r) ? r.map((c) => String(c)) : [];
});

const textShadowStyle = computed<CSSProperties>(() => {
  if (!text_shadow.value) return {};
  const color = text_shadow_color.value || "#000000";
  const blur = text_shadow_blur.value || 4;
  const css = `0 0 ${blur}px ${color}, 0 0 ${blur}px ${color}`;
  return { textShadow: css };
});

const containerStyle = computed<CSSProperties>(() => ({
  position: "relative",
  background: background_color.value,
  width: "100%",
  height: props.height ? props.height + "px" : "100%",
  padding: `${Number(border_spacing.value) || 10}px`,
}));

// Reage a mudanças de formatação e de dados do módulo (switch sorteados etc.).
useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
  const p = payload as { path?: string } | null;
  if (p && typeof p.path === "string" && p.path.startsWith("modules.draw.")) {
    tick.value += 1;
  }
});

useBroadcastListener(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, (payload) => {
  const p = payload as { module?: string } | null;
  if (p && p.module === "draw") tick.value += 1;
});
</script>

<style scoped>
.draw-proj-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  max-width: 100%;
  width: 100%;
}

/* Área do wheel dentro da projeção; herda fonte/cor do formato. */
.draw-proj-wheel {
  width: 100%;
  max-width: 100%;
}

/* Faixa de reserva para quando a projeção tem texto sem wheel. */
.draw-proj-band {
  position: absolute;
  top: 50%;
  z-index: 0;
  transform: translateY(-50%);
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  pointer-events: none;
}

.draw-proj-number {
  position: relative;
  z-index: 1;
  font-weight: 200;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  white-space: nowrap;
}

.draw-proj-number--name {
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  font-variant-numeric: normal;
}

/* Entrada/saída do bloco de sorteados no rodapé (fade + zoom). */
.draw-history-enter-active,
.draw-history-leave-active {
  transition:
    opacity 240ms var(--lj-ease, ease),
    transform 240ms var(--lj-ease, ease);
}

.draw-history-enter-from,
.draw-history-leave-to {
  opacity: 0;
  transform: scale(0.82);
}

/* Rodapé fixo com o histórico de sorteados. */
.draw-proj-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45em;
  max-height: 38%;
  overflow-y: auto;
  text-align: center;
}

.draw-proj-label {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.draw-proj-chip-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 100%;
}

/* Pílula com medidas em em: a fonte do chip é escolhida pelo usuário e
   reescalada pelo tamanho do container, então altura fixa cortaria o número. */
.draw-proj-chip {
  display: inline-flex;
  align-items: center;
  margin: 5px;
  padding: 0.3em 0.9em;
  border-radius: var(--lj-radius-pill);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  box-shadow: var(--lj-shadow-1);
}
</style>
