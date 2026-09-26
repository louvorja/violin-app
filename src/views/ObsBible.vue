<template>
  <OverlayRenderer />
  <LibrasOverlay
    v-if="showLibrasObs"
    :verse-text="text"
    :bible-version="version"
    :bible-book-id="bookId"
    :bible-chapter="Number(chapter) || undefined"
    type="bible"
  />
  <div
    ref="container"
    class="obs-bible-root"
    :class="[`align-${vertical_align}`, `justify-${horizontal_align}`]"
    :style="{ padding: `${border_spacing_px}px` }"
  >
    <Transition name="fade-verse" mode="out-in">
      <div
        v-if="active && (displayText || displayReference)"
        :key="displayText + displayReference"
        class="obs-bible-content"
      >
        <span
          v-if="displayText"
          class="obs-bible-text"
          :style="{
            color: font_color || '#FFFFFF',
            fontSize: font_size_px + 'px',
            fontFamily: font || FONT.PROJECTION.FALLBACK,
            textAlign: horizontalTextAlign(horizontal_align),
            ...textShadowStyle,
          }"
        >
          {{ displayText }}
        </span>

        <span
          v-if="displayReference"
          class="obs-bible-reference"
          :style="{
            color: reference_font_color || '#FB8C00',
            fontSize: ref_font_size_px + 'px',
            fontFamily: reference_font || FONT.PROJECTION.FALLBACK,
            textAlign: horizontalTextAlign(horizontal_align),
          }"
        >
          {{ displayReference }}
        </span>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useContainerSize } from "@/composables/useContainerSize";
import UserData from "@/helpers/UserData";
import { FONT, resolveFont } from "@/config/Fonts";
import { horizontalTextAlign, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import LibrasOverlay from "@/views/LibrasOverlay.vue";
import { useLibrasState } from "@/modules/libras/composables/useLibrasState";

const MID = "modules.bible";

const { showOnObs: showLibrasObs } = useLibrasState();
const { container, fontSizePc, measure } = useContainerSize();

const text = ref("");
const reference = ref("");
const book = ref("");
const bookId = ref(undefined);
const chapter = ref("");
const verses = ref([]);
const version = ref("");
const versionId = ref(undefined);
const active = ref(false);

const _tick = ref(0);
function ud(key, fallback = null) {
  void _tick.value;
  const manifestDefault = moduleCustomizationDefault("bible", key, fallback);
  const v = UserData.get(`${MID}.${key}`, manifestDefault);
  return v == null ? manifestDefault : v;
}

const font = computed(() => {
  const saved = ud("font", null);
  return resolveFont(saved, FONT.PROJECTION.FALLBACK);
});
const font_color = computed(() => ud("font_color", "#FFFFFF"));
const font_size = computed(() => ud("font_size", 15));
const text_shadow = computed(() => ud("text_shadow", false));
const text_shadow_color = computed(() => ud("text_shadow_color", "#000000"));
const text_shadow_blur = computed(() => ud("text_shadow_blur", 4));
const reference_font = computed(() =>
  resolveFont(ud("reference_font", null), FONT.PROJECTION.FALLBACK)
);
const reference_font_color = computed(() => ud("reference_font_color", "#FB8C00"));
const reference_font_size = computed(() => ud("reference_font_size", 10));
const border_spacing = computed(() => ud("border_spacing", 10));
const vertical_align = computed(() => ud("vertical_align", "center"));
const horizontal_align = computed(() => ud("horizontal_align", "center"));

const font_size_px = computed(() => fontSizePc(font_size.value));
const ref_font_size_px = computed(() => fontSizePc(reference_font_size.value));
const border_spacing_px = computed(() => Number(border_spacing.value) || 10);

const textShadowStyle = computed(() => {
  if (!text_shadow.value) return {};
  const color = text_shadow_color.value || "#000000";
  const blur = text_shadow_blur.value || 4;
  const css = `0 0 ${blur}px ${color}, 0 0 ${blur}px ${color}`;
  return { textShadow: css };
});

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

useBroadcastListener(BROADCAST_TYPE.BIBLE_VERSE, (payload) => {
  text.value = payload.text || "";
  reference.value = payload.reference || "";
  book.value = payload.book || "";
  bookId.value = payload.book_id;
  chapter.value = payload.chapter || "";
  verses.value = payload.verses || [];
  version.value = payload.version || "";
  versionId.value = payload.version_id;
  active.value = payload.active ?? true;
});

useBroadcastListener(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, () => {
  _tick.value += 1;
});

onMounted(() => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "transparent";
  const requestState = () => {
    if (!active.value) Broadcast.send(BROADCAST_TYPE.REQUEST_BIBLE_STATE);
  };
  requestState();
  setTimeout(requestState, 500);
});

watch(
  [
    font,
    font_color,
    font_size,
    reference_font_color,
    reference_font_size,
    vertical_align,
    horizontal_align,
    border_spacing,
  ],
  measure
);
</script>

<style>
body {
  margin: 0;
  overflow: hidden;
  background: transparent;
}
</style>
<style scoped>
.obs-bible-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  box-sizing: border-box;
  overflow: hidden;
  background: transparent;
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

.obs-bible-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  width: 100%;
}

.obs-bible-text {
  white-space: pre-wrap;
  line-height: 1.45;
}

.obs-bible-reference {
  margin-top: 0.4em;
  letter-spacing: 0.02em;
}

.fade-verse-enter-active,
.fade-verse-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.fade-verse-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-verse-leave-to {
  opacity: 0;
}
</style>
