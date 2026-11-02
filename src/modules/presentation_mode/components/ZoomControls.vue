<template>
  <div class="pm-zoom" data-testid="pm-zoom-controls" @pointerdown.stop @wheel.stop>
    <!-- Mapa do recorte: a imagem inteira e o pedaço que está nas telas; clicar ou arrastar move. -->
    <div
      v-if="zoom.scale.value > 1 && mapSrc"
      ref="map"
      class="pm-zoom__map"
      :style="{ aspectRatio: String(mapRatio) }"
      data-testid="pm-zoom-map"
      @pointerdown="startMap"
    >
      <img :src="mapSrc" alt="" @load="onMapLoad" />
      <span class="pm-zoom__rect" :style="rectStyle" />
    </div>
    <div class="pm-zoom__bar">
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        :icon="ICONS.ACTIONS.MINUS"
        :title="tm('zoom_live.out')"
        :disabled="zoom.scale.value <= 1"
        data-testid="pm-zoom-out"
        @click="zoom.zoomOut()"
      />
      <span class="pm-zoom__pct" data-testid="pm-zoom-pct">{{ zoom.percent.value }}%</span>
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        :icon="ICONS.ACTIONS.ADD"
        :title="tm('zoom_live.in')"
        data-testid="pm-zoom-in"
        @click="zoom.zoomIn()"
      />
      <LjButton
        size="sm"
        variant="ghost"
        :title="
          zoom.detail.value.label === '100%'
            ? tm('zoom_live.actual_title')
            : tm('zoom_live.double_title')
        "
        data-testid="pm-zoom-detail"
        @click="zoom.zoomDetail()"
      >
        {{ zoom.detail.value.label }}
      </LjButton>
      <LjButton
        size="sm"
        variant="ghost"
        :disabled="zoom.scale.value <= 1"
        :title="tm('zoom_live.fit_title')"
        data-testid="pm-zoom-fit"
        @click="zoom.fit()"
      >
        {{ tm("zoom_live.fit") }}
      </LjButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useLiveZoom } from "../composables/useLiveZoom";
import { usePdfDeck } from "../composables/usePdfDeck";

/**
 * Barra de zoom flutuante do visor (− / % / + / Ajustar) e o mapa do
 * recorte. A tela principal e o retorno seguem o que se faz aqui.
 */

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const zoom = useLiveZoom();
const deck = usePdfDeck();

const mapSrc = computed(() => {
  const t = zoom.target.value;
  if (!t) return "";
  return t.type === "image" ? t.url : (deck.thumbs.get(t.page) ?? "");
});

/** A imagem ocupa a caixa 16:9 da tela; a página do PDF, a caixa dela. */
const pageRatio = ref(16 / 9);
const mapRatio = computed(() => (zoom.target.value?.type === "pdf" ? pageRatio.value : 16 / 9));
function onMapLoad(e: Event): void {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth && img.naturalHeight) pageRatio.value = img.naturalWidth / img.naturalHeight;
}

const rectStyle = computed(() => {
  const z = zoom.current.value;
  if (!z) return {};
  const size = 100 / z.scale;
  return {
    width: `${size}%`,
    height: `${size}%`,
    left: `${(z.cx - 1 / (2 * z.scale)) * 100}%`,
    top: `${(z.cy - 1 / (2 * z.scale)) * 100}%`,
  };
});

const map = ref<HTMLElement | null>(null);
function moveTo(e: PointerEvent): void {
  const el = map.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  zoom.centerAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}
function startMap(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  moveTo(e);
  const move = (ev: PointerEvent) => moveTo(ev);
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
.pm-zoom {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.pm-zoom__bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
  box-shadow: var(--lj-popup-shadow);
  color: var(--lj-text);
}

.pm-zoom__pct {
  min-width: 42px;
  text-align: center;
  font-family: var(--lj-font-mono);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.pm-zoom__map {
  position: relative;
  width: 140px;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-live-stage-bg);
  box-shadow: var(--lj-popup-shadow);
  cursor: grab;
  touch-action: none;
}

.pm-zoom__map img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.7;
  pointer-events: none;
}

.pm-zoom__rect {
  position: absolute;
  border: 2px solid var(--lj-orange);
  background: var(--lj-orange-alpha-12);
  pointer-events: none;
}
</style>
