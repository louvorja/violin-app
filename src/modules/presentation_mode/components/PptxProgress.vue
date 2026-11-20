<template>
  <div v-if="p" class="pm-pptx-progress" role="status" data-testid="pm-pptx-progress">
    <div class="pm-pptx-progress__text">
      <strong>{{ tm("pptx.progress_title", { name: p.name }) }}</strong>
      <span>{{ detail }}</span>
    </div>
    <div class="pm-pptx-progress__track">
      <div
        class="pm-pptx-progress__fill"
        :class="{ 'pm-pptx-progress__fill--busy': percent === null }"
        :style="percent === null ? undefined : { width: `${percent}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { powerPointProgress } from "../composables/usePowerPoint";

/**
 * Faixa de andamento do PowerPoint: só aparece quando a conversão demora
 * (fontes sendo procuradas, slides sendo gerados) e conta os slides.
 */

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const p = powerPointProgress;

const detail = computed(() => {
  const cur = p.value;
  if (!cur) return "";
  if (cur.phase === "font" && cur.fontName) return tm("pptx.progress_font", { font: cur.fontName });
  if (cur.phase === "converting" && cur.total)
    return tm("pptx.progress_count", { done: Math.min(cur.done ?? 0, cur.total), total: cur.total });
  if (cur.phase === "converting") return tm("pptx.progress_converting", { converter: cur.converter ?? "" });
  return tm("pptx.progress_fonts");
});

/** Porcentagem só quando há contagem de slides; antes disso, a barra corre. */
const percent = computed<number | null>(() => {
  const cur = p.value;
  if (!cur || cur.phase !== "converting" || !cur.total) return null;
  return Math.round((100 * Math.min(cur.done ?? 0, cur.total)) / cur.total);
});
</script>

<style scoped>
.pm-pptx-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--lj-white-alpha-20);
  font-size: 12px;
  color: var(--lj-white-alpha-50);
}

.pm-pptx-progress__text {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.pm-pptx-progress__text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lj-live-color);
  font-weight: 600;
}

.pm-pptx-progress__track {
  position: relative;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--lj-white-alpha-10);
}

.pm-pptx-progress__fill {
  height: 100%;
  background: var(--lj-orange);
  transition: width 0.3s ease;
}

.pm-pptx-progress__fill--busy {
  position: absolute;
  width: 30%;
  animation: pm-pptx-progress-run 1.2s ease-in-out infinite;
}

@keyframes pm-pptx-progress-run {
  from {
    left: -30%;
  }
  to {
    left: 100%;
  }
}
</style>
