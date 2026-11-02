<template>
  <div class="pm-music-override-wrap">
    <div
      class="pm-music-override"
      role="group"
      :aria-label="tm('music_override.label')"
      data-testid="pm-music-override"
    >
      <span class="pm-music-override__label" :title="tm('music_override.hint')">
        {{ tm("music_override.short_label") }}
      </span>
      <div class="pm-music-override__buttons">
        <LjButton
          v-for="option in OPTIONS"
          :key="option.value"
          size="sm"
          :variant="override === option.value ? 'primary' : 'default'"
          :icon="option.icon"
          :aria-pressed="override === option.value"
          :title="tm(override === option.value ? 'music_override.release' : 'music_override.hint')"
          :data-testid="`pm-music-override-${option.value}`"
          @click="setOverride(override === option.value ? '' : option.value)"
        >
          {{ tm(`music_override.${option.value}`) }}
        </LjButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LjButton } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useMusicOverride } from "../composables/useMusicOverride";
import type { MusicOverride } from "../program/musicModes";

/**
 * Versão de todas as músicas: com banda, só letra; sem banda, cantado ou
 * playback. Nenhum apertado, cada música segue a sua; clicar no apertado solta.
 */

const OPTIONS: readonly { value: Exclude<MusicOverride, "">; icon: string }[] = [
  { value: "lyric", icon: ICONS.MUSIC.NO_AUDIO },
  { value: "sung", icon: ICONS.MUSIC.SING },
  { value: "pb", icon: ICONS.MUSIC.PLAYBACK },
];

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { override, setOverride } = useMusicOverride();
</script>

<style scoped>
/* A coluna do programa muda de largura: estreita, o rótulo sobe e os ícones saem. */
.pm-music-override-wrap {
  container-type: inline-size;
}

.pm-music-override {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}

@container (max-width: 380px) {
  .pm-music-override {
    flex-direction: column;
    align-items: stretch;
    gap: var(--lj-space-2);
  }
}

@container (max-width: 300px) {
  .pm-music-override__buttons :deep(.lj-icon) {
    display: none;
  }
}

.pm-music-override__label {
  flex-shrink: 0;
  color: var(--lj-text-subtle);
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: help;
}

.pm-music-override__buttons {
  display: flex;
  flex: 1;
  gap: var(--lj-space-2);
  min-width: 0;
}

.pm-music-override__buttons > * {
  flex: 1;
  min-width: 0;
}
</style>
