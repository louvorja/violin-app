<template>
  <div
    ref="container"
    :class="['lj-u-flex', `lj-u-align-${verticalAlign}`, `lj-u-justify-${horizontalAlign}`]"
    :style="{
      position: 'relative',
      background: backgroundColor,
      width: '100%',
      height: height ? height + 'px' : '100%',
      padding: `${Number(borderSpacing) || 10}px`,
    }"
  >
    <img
      v-if="image"
      :src="image"
      alt=""
      loading="eager"
      :style="{
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        position: 'absolute',
        objectFit: imageFit,
        opacity: imageOpacity / 100,
      }"
    />

    <div v-if="bible" class="lj-u-col" style="width: 100%; max-width: 100%">
      <span
        v-if="displayText"
        class="bible-text"
        :style="{
          zIndex: 1,
          color: fontColor,
          fontSize: `${fontSizePc(fontSize)}px`,
          fontFamily: fontFamily,
          textAlign: horizontalTextAlign(horizontalAlign),
          backgroundColor: textBackgroundEnabled ? textBackgroundColor : 'transparent',
          ...textShadowStyle,
        }"
      >
        {{ displayText }}
      </span>
      <span
        v-if="displayReference"
        class="bible-reference"
        :style="{
          zIndex: 1,
          color: refFontColor,
          fontSize: `${fontSizePc(refFontSize)}px`,
          fontFamily: refFontFamily,
          textAlign: horizontalTextAlign(horizontalAlign),
        }"
      >
        {{ displayReference }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type ComputedRef } from "vue";
import { module as manifest } from "../manifest";
import Modules from "@/helpers/Modules";
import UserData from "@/helpers/UserData";
import AppData from "@/helpers/AppData";
import { useContainerSize } from "@/composables/useContainerSize";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { ModuleState } from "@/types/Module";
import { FONT, resolveFont } from "@/config/Fonts";
import { horizontalTextAlign, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";

interface BibleData {
  text?: string;
  scriptural_reference?: string;
  book?: string;
  chapter?: string;
  verses?: number[];
  version?: string;
}

const props = defineProps<{
  height?: number;
}>();

const { container, fontSizePc } = useContainerSize();

const module_ = computed(() => Modules.get(manifest.id) as ModuleState | undefined);

const _tick = ref(0);

useBroadcastListener(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, () => {
  _tick.value += 1;
});

function ud(key: string, fallback: any = null): any {
  void _tick.value;
  const moduleId = module_.value?.id || manifest.id;
  const manifestDefault = moduleCustomizationDefault(moduleId, key, fallback);
  const v = UserData.get(`modules.${moduleId}.${key}`, manifestDefault);
  return v == null ? manifestDefault : v;
}

const verticalAlign = computed(() => ud("vertical_align", "center"));
const horizontalAlign = computed(() => ud("horizontal_align", "center"));
const backgroundColor = computed(() => ud("background_color", "transparent"));
const borderSpacing = computed(() => ud("border_spacing", 10));
const image = computed(() => ud("image", null));
const imageFit = computed(() => ud("image_fit", "cover"));
const imageOpacity = computed(() => ud("image_opacity", 100));
const fontColor = computed(() => ud("font_color", "#ffffff"));
const fontSize = computed(() => ud("font_size", 15));
const fontFamily = computed(() => resolveFont(ud("font", null), FONT.PROJECTION.FALLBACK));
const refFontColor = computed(() => ud("reference_font_color", "#cccccc"));
const refFontSize = computed(() => ud("reference_font_size", 10));
const refFontFamily = computed(() =>
  resolveFont(ud("reference_font", null), FONT.PROJECTION.FALLBACK)
);
const textShadow = computed(() => ud("text_shadow", false));
const textShadowColor = computed(() => ud("text_shadow_color", "#000000"));
const textShadowBlur = computed(() => ud("text_shadow_blur", 4));
const textBackgroundEnabled = computed(() => ud("text_background_enabled", false));
const textBackgroundColor = computed(() => ud("text_background_color", "transparent"));
const textShadowStyle = computed(() => {
  if (!textShadow.value) return {};
  const color = textShadowColor.value || "#000000";
  const blur = textShadowBlur.value || 4;
  return { textShadow: `0 0 ${blur}px ${color}, 0 0 ${blur}px ${color}` };
});

const bible: ComputedRef<BibleData | null> = computed(() => AppData.get("modules.bible.data"));

const showReference = computed(() => ud("show_reference", true));
const showVersion = computed(() => ud("show_version", true));
const referenceOnly = computed(() => ud("reference_only", false));

function numbersInterval(numbers: number[]): string {
  if (!numbers || numbers.length === 0) return "";
  const sorted = [...numbers].sort((a, b) => a - b);
  const result: string[] = [];
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
  if (!bible.value?.book || !bible.value?.chapter) return "";
  const interval = numbersInterval(bible.value.verses || []);
  return `${bible.value.book} ${bible.value.chapter}${interval ? `:${interval}` : ""}`;
});

const displayText = computed(() => {
  if (!bible.value) return "";
  if (referenceOnly.value) return referenceOnlyText.value;
  return bible.value.text || "";
});

const displayReference = computed(() => {
  if (!bible.value) return "";
  if (referenceOnly.value) return "";
  if (!showReference.value) return "";
  if (!showVersion.value) return referenceOnlyText.value;
  return bible.value.scriptural_reference || "";
});
</script>

<style scoped>
.bible-text {
  white-space: pre-wrap;
  line-height: 1.45;
}

.bible-reference {
  margin-top: 0.4em;
  letter-spacing: 0.02em;
}
</style>
