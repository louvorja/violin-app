<template>
  <button
    type="button"
    class="pm-pip"
    :title="tm('stage.show_live')"
    data-testid="pm-live-pip"
    @click="emit('focus')"
  >
    <span class="pm-pip__head">
      <span class="pm-pip__badge">
        <span class="pm-pip__dot" />
        {{ tm("stage.on_air") }}
      </span>
      <span class="pm-pip__title">{{ title }}</span>
    </span>
    <span v-if="audioOnly" class="pm-pip__audio">
      <LjIcon :icon="ICONS.MUSIC.AUDIO" :size="24" />
    </span>
    <LiveMirror v-else :cleared="false" />
    <span v-if="progress !== null" class="pm-pip__track">
      <span :style="{ width: `${progress}%` }" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import LiveMirror from "./LiveMirror.vue";

/**
 * O que está no ar, em miniatura no canto do visor enquanto há uma prévia:
 * o operador nunca perde de vista o telão. Clicar volta para ele.
 */

defineProps<{
  title: string;
  /** Áudio solto: sem imagem nas telas. */
  audioOnly: boolean;
  /** 0–100 quando o que está no ar tem tempo. */
  progress: number | null;
}>();

const emit = defineEmits<{ focus: [] }>();
const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
</script>

<style scoped>
.pm-pip {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  width: 220px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--lj-danger-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
  box-shadow: var(--lj-popup-shadow);
  color: var(--lj-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pm-pip:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-pip__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
}

.pm-pip__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-pip__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lj-white);
}

.pm-pip__title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-pip__audio {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  background: var(--lj-live-stage-bg);
  color: var(--lj-white-alpha-50);
}

.pm-pip__track {
  height: 3px;
  background: var(--lj-white-alpha-10);
}

.pm-pip__track span {
  display: block;
  height: 100%;
  background: var(--lj-orange);
}
</style>
