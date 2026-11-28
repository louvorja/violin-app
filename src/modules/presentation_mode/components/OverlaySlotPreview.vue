<template>
  <div ref="wrap" class="ovl-slot" aria-hidden="true">
    <div class="ovl-slot__stage" :style="{ transform: `scale(${scale})` }">
      <div class="ovl-slot__box" :style="slotStyle">
        <div v-if="overlay.type === 'text'" class="ovl-slot__text" :style="textStyle">
          {{ displayText }}
        </div>
        <img
          v-else-if="overlay.type === 'image' && imageUrl"
          :src="imageUrl"
          class="ovl-slot__img"
          :style="imageStyle"
          alt=""
        />
        <div v-else-if="overlay.type === 'module_mirror'" class="ovl-slot__text" :style="textStyle">
          {{ displayText }}
        </div>
      </div>
      <LjIcon
        v-if="overlay.type === 'image' && !imageUrl"
        :icon="ICONS.MEDIA.IMAGE"
        :size="24"
        class="ovl-slot__placeholder"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { getImage, resolveImageUrl } from "@/helpers/Overlay";
import {
  STAGE_UNITS,
  overlayImageStyle,
  overlaySlotStyle,
  overlayTextStyle,
} from "@/helpers/OverlayStyle";
import type { OverlaySlot } from "@/types/Overlay";
import { useStageScale } from "../composables/useStageScale";

/**
 * Miniatura fiel de uma sobreposição: o slot é desenhado num palco 1920×1080 e
 * reduzido com `transform`, como na prévia do módulo. Deslocamentos, fonte e
 * imagem escalam juntos, então o card mostra o que sai na projeção.
 */
const props = defineProps<{
  overlay: OverlaySlot;
  /** Texto atual do espelho de módulo (o card não abre o painel do módulo). */
  mirrorText?: string;
  /** Cor de aviso/alerta publicada pelo módulo espelhado. */
  mirrorColor?: string;
  /** Nome do tipo para quando o slot ainda não tem conteúdo. */
  placeholder?: string;
}>();

const wrap = ref<HTMLElement | null>(null);
const { scale } = useStageScale(wrap);

const slotStyle = computed<Record<string, string>>(() => ({
  ...overlaySlotStyle(props.overlay),
  pointerEvents: "none",
}));
const textStyle = computed(() =>
  overlayTextStyle(props.overlay, STAGE_UNITS, () => props.mirrorColor || "")
);
const imageStyle = computed(() => overlayImageStyle(props.overlay, STAGE_UNITS));
const displayText = computed(() =>
  props.overlay.type === "module_mirror"
    ? props.mirrorText || props.placeholder || ""
    : props.overlay.content || props.placeholder || ""
);

const imageUrl = ref("");
let blobUrl = "";
let generation = 0;

function releaseImage(): void {
  if (blobUrl.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrl = "";
  imageUrl.value = "";
}

async function loadImage(): Promise<void> {
  const current = ++generation;
  releaseImage();
  if (props.overlay.type !== "image" || !props.overlay.file_id) return;
  try {
    const record = await getImage(props.overlay.file_id);
    if (current !== generation) return;
    const url = resolveImageUrl(record);
    imageUrl.value = url;
    blobUrl = url;
  } catch {
    /* Miniatura: se o IDB falhar, fica o marcador de imagem. */
  }
}

watch(
  () => [props.overlay.type, props.overlay.file_id],
  () => void loadImage(),
  { immediate: true }
);

onBeforeUnmount(() => {
  generation++;
  releaseImage();
});
</script>

<style scoped>
.ovl-slot {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--lj-color-projection-bg);
  border-radius: var(--lj-radius-sm);
}

.ovl-slot__stage {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  transform-origin: top left;
  container-type: size;
}

.ovl-slot__box {
  position: absolute;
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.ovl-slot__text {
  white-space: pre-wrap;
  user-select: none;
}

.ovl-slot__img {
  display: block;
}

.ovl-slot__placeholder {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--lj-white-alpha-50);
}
</style>
