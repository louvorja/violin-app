<template>
  <LjPopover :title="tm('text_size.title')" align="end">
    <template #trigger>
      <button
        type="button"
        class="pm-text-size__trigger"
        :class="{ 'pm-text-size__trigger--on': scale !== DEFAULT }"
        :title="tm('text_size.open')"
        :data-testid="`pm-text-size-${screen}`"
      >
        <LjIcon :icon="ICONS.UI.TEXT_SIZE" :size="13" />
        <span v-if="scale !== DEFAULT" class="pm-text-size__value">{{ scale }}%</span>
      </button>
    </template>
    <div class="pm-text-size">
      <div class="pm-text-size__row">
        <LjButton
          size="sm"
          icon-only
          :icon="ICONS.ACTIONS.MINUS"
          :title="tm('text_size.smaller')"
          :disabled="scale <= MIN"
          :data-testid="`pm-text-size-${screen}-minus`"
          @click="set(scale - STEP)"
        />
        <LjSlider
          class="pm-text-size__slider"
          :model-value="scale"
          :min="MIN"
          :max="MAX"
          :step="STEP"
          show-value
          unit="%"
          :aria-label="tm('text_size.title')"
          @update:model-value="(v: number) => set(v)"
        />
        <LjButton
          size="sm"
          icon-only
          :icon="ICONS.ACTIONS.ADD"
          :title="tm('text_size.bigger')"
          :disabled="scale >= MAX"
          :data-testid="`pm-text-size-${screen}-plus`"
          @click="set(scale + STEP)"
        />
      </div>
      <p class="pm-text-size__hint">{{ tm(`text_size.hint_${screen}`) }}</p>
      <LjButton size="sm" :disabled="scale === DEFAULT" @click="set(DEFAULT)">
        {{ tm("text_size.reset") }}
      </LjButton>
    </div>
  </LjPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjIcon, LjPopover, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useScreenTextScale, TEXT_SCALE } from "../composables/useScreenTextScale";

/**
 * Tamanho do texto das músicas numa tela, à mão durante a passagem de som:
 * muda na hora, e a miniatura da coluna mostra o resultado.
 */

const props = defineProps<{ screen: "main" | "stage" }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { MIN, MAX, STEP, DEFAULT } = TEXT_SCALE;
const textScale = useScreenTextScale();
const scale = computed(() => textScale.get(props.screen));

function set(value: number): void {
  textScale.set(props.screen, value);
}
</script>

<style scoped>
.pm-text-size__trigger {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  height: var(--lj-ui-h-sm);
  padding: 0 6px;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-ui-radius);
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-text-size__trigger:hover {
  background: var(--lj-hover-bg);
  color: var(--lj-text);
}

.pm-text-size__trigger:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* Fora do padrão, o botão mostra a escala: dá para ver de longe que mexeram. */
.pm-text-size__trigger--on {
  border-color: var(--lj-orange);
  color: var(--lj-orange);
}

.pm-text-size__value {
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.pm-text-size {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-4);
  width: 240px;
}

.pm-text-size__row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
}

.pm-text-size__slider {
  flex: 1;
}

.pm-text-size__hint {
  margin: 0;
  color: var(--lj-text-muted);
  font-size: 11.5px;
}
</style>
