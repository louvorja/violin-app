<template>
  <div class="pm-visor" data-testid="pm-stage-preview">
    <!-- Áudio não vai para as saídas: o visor mostra só o que está tocando. -->
    <div
      v-if="audioTitle !== undefined"
      class="pm-visor__frame pm-visor__audio"
      data-testid="pm-stage-audio"
    >
      <LjIcon :icon="ICONS.MUSIC.AUDIO" :size="48" />
      <span class="pm-visor__audio-title">{{ audioTitle }}</span>
      <span class="pm-visor__audio-hint">{{ tm("video.audio_only") }}</span>
    </div>
    <!--
      Imagem ou PDF no ar, como nos visualizadores: ajustado, o cursor é o
      normal e a imagem se arrasta como sempre; com zoom, arrastar move o
      recorte. Ctrl/Cmd + roda (ou pinça no trackpad) amplia no ponto; clique
      duplo alterna entre ajustado e o detalhe.
    -->
    <div
      v-else
      ref="frame"
      class="pm-visor__frame"
      :class="{
        'pm-visor__frame--zoomable': zoomable,
        'pm-visor__frame--zoomed': zoom.scale.value > 1,
      }"
      :title="zoomable ? tm('zoom_live.visor_hint') : undefined"
      data-testid="pm-visor-frame"
      @wheel="onWheel"
      @pointerdown="startPan"
      @dblclick="onDoubleClick"
      @mousedown.middle.prevent
      @auxclick.middle.prevent
    >
      <LiveMirror :cleared="false" />
    </div>
    <ZoomControls v-if="zoomable" />
  </div>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { computed, ref } from "vue";
import LiveMirror from "./LiveMirror.vue";
import ZoomControls from "./ZoomControls.vue";
import { useLiveZoom } from "../composables/useLiveZoom";

/**
 * Visor do centro para o que não tem grade (vídeo, imagem, versículo,
 * anúncio): o espelho da tela principal, no maior 16:9 que cabe. Os
 * controles ficam na barra de baixo, a mesma para toda mídia.
 */

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const props = defineProps<{ audioTitle?: string }>();
const zoom = useLiveZoom();
const zoomable = computed(() => props.audioTitle === undefined && !!zoom.target.value);
const frame = ref<HTMLElement | null>(null);

/**
 * A caixa da mídia sem o zoom (o `offset*` ignora o transform): a imagem
 * ocupa o 16:9 inteiro; a página do PDF, só a caixa dela.
 */
function mediaBox(): DOMRect | null {
  const mirror = frame.value?.querySelector<HTMLElement>(".pm-mirror");
  const media = mirror?.querySelector<HTMLElement>(".pm-mirror__page, .pm-mirror__media");
  if (!mirror || !media) return null;
  const r = mirror.getBoundingClientRect();
  return new DOMRect(
    r.left + media.offsetLeft,
    r.top + media.offsetTop,
    media.offsetWidth,
    media.offsetHeight
  );
}

function pointAt(box: DOMRect, x: number, y: number): { x: number; y: number } {
  return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
}

/**
 * Ctrl/Cmd + roda, ou a pinça do trackpad (que chega como roda com Ctrl),
 * amplia no ponto. Sem Ctrl, com zoom, a rolagem (dois dedos no trackpad,
 * roda do mouse; Shift para o lado) move o recorte, como no Preview.
 * Ajustado, a roda sozinha não faz nada.
 */
function onWheel(e: WheelEvent): void {
  if (!zoomable.value) return;
  const box = mediaBox();
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    // A pinça manda passos pequenos; a roda do mouse, passos de ~100. A sensação é a mesma.
    const rate = Math.abs(e.deltaY) < 40 ? 0.01 : 0.002;
    zoom.zoomBy(Math.exp(-e.deltaY * rate), box ? pointAt(box, e.clientX, e.clientY) : undefined);
    return;
  }
  if (zoom.scale.value <= 1 || !box) return;
  e.preventDefault();
  // Linhas (roda de mouse em alguns sistemas) viram pixels.
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height : 1;
  const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
  const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
  // Rolar para baixo mostra o que está mais abaixo: o contrário de arrastar.
  zoom.panBy(-dx / box.width, -dy / box.height);
}

function onDoubleClick(e: MouseEvent): void {
  if (!zoomable.value) return;
  const box = mediaBox();
  zoom.toggle(box ? pointAt(box, e.clientX, e.clientY) : undefined);
}

/**
 * Com zoom, arrastar (botão esquerdo ou a roda pressionada) move o recorte.
 * Ajustado, nada aqui: o arrastar é o do navegador.
 */
function startPan(e: PointerEvent): void {
  // Botão esquerdo ou a roda pressionada (botão do meio), como nos visualizadores.
  if (zoom.scale.value <= 1 || (e.button !== 0 && e.button !== 1)) return;
  const box = mediaBox();
  if (!box) return;
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  let lastX = e.clientX;
  let lastY = e.clientY;
  const move = (ev: PointerEvent) => {
    zoom.panBy((ev.clientX - lastX) / box.width, (ev.clientY - lastY) / box.height);
    lastX = ev.clientX;
    lastY = ev.clientY;
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
</script>

<style scoped>
.pm-visor {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  container-type: size;
}

/* O maior 16:9 que cabe no palco, sem sobrepor a biblioteca. */
.pm-visor__frame {
  width: min(100cqw, calc(100cqh * 16 / 9));
}

.pm-visor__frame--zoomed {
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.pm-visor__frame--zoomed:active {
  cursor: grabbing;
}

/* Com zoom, a imagem não é alvo: o arrastar nativo dela roubaria o ponteiro do pan. */
.pm-visor__frame--zoomed :deep(img) {
  pointer-events: none;
  -webkit-user-drag: none;
}

.pm-visor__audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  aspect-ratio: 16 / 9;
  border: 1px dashed var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  color: var(--lj-white-alpha-50);
  text-align: center;
}

.pm-visor__audio-title {
  max-width: 90%;
  font-size: 18px;
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-white);
  overflow-wrap: anywhere;
}

.pm-visor__audio-hint {
  font-size: 11px;
}
</style>
