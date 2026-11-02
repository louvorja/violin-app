<template>
  <div class="pm-pband" data-testid="pm-preview-band">
    <LjIcon :icon="ICONS.UI.EYE" :size="16" class="pm-pband__icon" />
    <span class="pm-pband__text">
      <span class="pm-pband__title">{{ tm("preview_band.title", { title }) }}</span>
      <span class="pm-pband__hint">{{ hint }}</span>
    </span>
    <LjButton
      variant="ghost"
      :icon="ICONS.ACTIONS.CLOSE"
      data-testid="pm-preview-discard"
      @click="emit('discard')"
    >
      {{ tm("preview_band.discard") }}
    </LjButton>
    <LjButton
      variant="primary"
      size="lg"
      :icon="ICONS.PROJECTION.PRESENTATION"
      :disabled="!canPresent"
      :title="tm('preview_band.present_title')"
      data-testid="pm-preview-present"
      @click="emit('present')"
    >
      {{ tm("preview_band.present") }}
    </LjButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";

/**
 * Faixa da prévia: o que está no visor ainda não está no ar. Descartar volta
 * ao que está no ar; Apresentar (ou Enter) troca. A barra de baixo continua
 * controlando o que está no ar.
 */

const props = defineProps<{
  title: string;
  canPresent: boolean;
  /** Música do programa com a versão em aberto: escolher antes de apresentar. */
  needsMode?: boolean;
}>();

const emit = defineEmits<{ discard: []; present: [] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const hint = computed(() =>
  props.needsMode ? tm("preview_band.needs_mode") : tm("preview_band.hint")
);
</script>

<style scoped>
.pm-pband {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-top: 2px solid var(--lj-info-light);
  color: var(--lj-text);
}

.pm-pband__icon {
  flex-shrink: 0;
  color: var(--lj-info-light);
}

.pm-pband__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.pm-pband__title {
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-pband__hint {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-pband > :deep(.lj-button) {
  flex-shrink: 0;
}
</style>
