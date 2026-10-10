<template>
  <div class="pm-slides__grid" :class="{ 'pm-slides__grid--locked': disabled }">
    <button
      v-for="(slide, i) in slides"
      :key="i"
      type="button"
      class="pm-slide-card"
      :class="{
        'pm-slide-card--live': i === liveIndex,
        'pm-slide-card--next': liveIndex >= 0 && i === liveIndex + 1,
      }"
      :disabled="disabled"
      :aria-current="i === liveIndex ? 'true' : undefined"
      :data-testid="`pm-slide-${i}`"
      @click="emit('pick', i)"
    >
      <span class="pm-slide-card__frame">
        <Slide :slide="slide" :title="title" />
      </span>
      <span class="pm-slide-card__foot">
        <span class="pm-slide-card__n">{{ i + 1 }}</span>
        <span v-if="i === 0" class="pm-slide-card__part">{{ tm("stage.cover") }}</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import Slide from "@/components/Slide.vue";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";

/**
 * Grade de slides de uma música, com o `Slide.vue` real. Serve ao palco ao
 * vivo (com o slide no ar marcado) e à prévia (`liveIndex` -1, nada marcado).
 */
withDefaults(
  defineProps<{
    slides: Record<string, unknown>[];
    title: string;
    /** Slide no ar; -1 na prévia. */
    liveIndex?: number;
    disabled?: boolean;
  }>(),
  { liveIndex: -1, disabled: false }
);

const emit = defineEmits<{ pick: [index: number] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
</script>

<style scoped>
.pm-slides__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  /* A letra tem piso de 18px no Slide.vue: abaixo de 168px a miniatura estoura. */
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px;
  align-content: start;
}

.pm-slide-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-white-alpha-50);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pm-slide-card:disabled {
  cursor: not-allowed;
}

.pm-slide-card__frame {
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 3px;
  outline: 1px solid var(--lj-surface-border);
  transition: outline-color 120ms var(--lj-ease);
}

.pm-slide-card:hover:not(:disabled) .pm-slide-card__frame {
  outline-color: var(--lj-live-select);
}

.pm-slide-card--next .pm-slide-card__frame {
  outline: 2px solid var(--lj-live-select);
}

.pm-slide-card--live .pm-slide-card__frame {
  outline: 2px solid var(--lj-orange);
}

.pm-slide-card:focus-visible {
  outline: none;
}

.pm-slide-card:focus-visible .pm-slide-card__frame {
  box-shadow: var(--lj-ui-focus);
}

.pm-slide-card__foot {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.pm-slide-card__n {
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
}

.pm-slide-card__part {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
