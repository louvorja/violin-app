<template>
  <LjPopover :title="tm('layers.title')" align="end">
    <template #trigger>
      <LjButton
        size="lg"
        icon-only
        :variant="busy ? 'primary' : 'default'"
        :icon="ICONS.UI.LAYERS"
        :title="tm('layers.title')"
        data-testid="pm-layers"
      />
    </template>
    <ul class="pm-layers" data-testid="pm-layers-list">
      <li
        v-for="layer in layers"
        :key="layer.id"
        class="pm-layers__row"
        :class="{ 'pm-layers__row--busy': layer.title }"
      >
        <LjIcon :icon="LAYER_ICONS[layer.id]" :size="15" class="pm-layers__icon" />
        <span class="pm-layers__name">{{ tm(`layers.${layer.id}`) }}</span>
        <span class="pm-layers__what" :title="layer.title" :data-testid="`pm-layer-${layer.id}`">
          {{ layer.title || tm("layers.empty") }}
        </span>
        <LjButton
          v-if="layer.title"
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.CLOSE"
          :title="tm('layers.stop')"
          :data-testid="`pm-layer-stop-${layer.id}`"
          @click="layer.stop()"
        />
      </li>
    </ul>
    <LjButton
      block
      variant="danger"
      :icon="ICONS.ACTIONS.CLOSE"
      :disabled="!busy"
      data-testid="pm-layers-stop-all"
      @click="stopAll"
    >
      {{ tm("layers.stop_all") }}
    </LjButton>
  </LjPopover>
</template>

<script setup lang="ts">
import { LjButton, LjIcon, LjPopover } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useLayers, type LayerId } from "../composables/useLayers";

/**
 * "No ar agora": o que está em cada camada — tela principal, só no retorno,
 * áudio — com um X por camada e "Limpar tudo", como no FreeShow. O operador
 * nunca perde de vista algo tocando que ele não está vendo no palco.
 */

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { layers, busy, stopAll } = useLayers();

const LAYER_ICONS: Record<LayerId, string> = {
  screen: ICONS.PROJECTION.SCREEN_OUTLINE,
  return: ICONS.PROJECTION.RETURN,
  audio: ICONS.MUSIC.AUDIO,
};
</script>

<style scoped>
.pm-layers {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 260px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.pm-layers__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 4px;
  border-radius: var(--lj-radius-sm);
  color: var(--lj-text-subtle);
}

.pm-layers__row--busy {
  color: var(--lj-text);
  background: var(--lj-white-alpha-08);
}

.pm-layers__name {
  width: 64px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.pm-layers__what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
