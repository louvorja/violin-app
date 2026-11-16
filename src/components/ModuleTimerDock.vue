<template>
  <!--
    Barra de baixo dos módulos de contagem (Cronômetro, Temporizador,
    Temporizador de Culto): o que se mexe durante o culto, a um clique — o
    modo e o aviso. O que se configura uma vez fica na ribbon.
  -->
  <div class="timer-dock" data-testid="timer-dock">
    <LjTabs
      :model-value="mode"
      :tabs="modeTabs"
      :aria-label="labels.mode"
      @update:model-value="emit('update:mode', $event as TimerDockMode)"
    />

    <slot />

    <div class="timer-dock__spacer" />

    <div class="timer-dock__warning">
      <span class="timer-dock__label">{{ labels.warning }}</span>
      <label
        v-if="customWarning"
        class="timer-dock__custom"
        :class="{ 'is-active': customActive }"
        :title="labels.custom || labels.warning"
        data-testid="timer-dock-custom"
      >
        <input
          v-model="customText"
          class="timer-dock__custom-input"
          type="number"
          min="1"
          max="86400"
          inputmode="numeric"
          step="1"
          :aria-label="labels.custom || labels.warning"
          :placeholder="labels.customPlaceholder || '0'"
          data-testid="timer-dock-custom-input"
          @keydown.enter.prevent="applyCustom"
          @blur="applyCustom"
        />
        <span class="timer-dock__custom-unit" aria-hidden="true">s</span>
      </label>
      <LjTabs
        :model-value="String(warningSeconds)"
        :tabs="warningTabs"
        :aria-label="labels.warning"
        @update:model-value="emit('update:warningSeconds', Number($event))"
      />
    </div>
  </div>
</template>

<script lang="ts">
export type TimerDockMode = "up" | "down";

/** Opções do aviso, em segundos antes do fim; 0 desliga. */
export const TIMER_DOCK_WARNINGS = [0, 60, 120, 300, 600] as const;

/** Limite do aviso personalizado: 24 h em segundos. */
export const TIMER_DOCK_CUSTOM_MAX = 24 * 60 * 60;
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjTabs } from "@/components/ui";
import type { LjTab } from "@/components/ui";

const props = withDefaults(
  defineProps<{
    mode: TimerDockMode;
    /** Segundos do aviso; um valor fora da lista deixa nenhum botão marcado. */
    warningSeconds: number;
    /** Opções de tempo, em segundos; 0 desliga. */
    warnings?: readonly number[];
    /** Mostra o campo de segundos personalizados antes das opções. */
    customWarning?: boolean;
    labels: {
      mode: string;
      up: string;
      down: string;
      warning: string;
      /** Rótulo de cada opção de `warnings`, na mesma ordem. */
      warnings: string[];
      /** Nome acessível do campo personalizado. */
      custom?: string;
      customPlaceholder?: string;
    };
  }>(),
  { warnings: () => TIMER_DOCK_WARNINGS, customWarning: false }
);

const emit = defineEmits<{
  "update:mode": [value: TimerDockMode];
  "update:warningSeconds": [value: number];
}>();

const modeTabs = computed<LjTab[]>(() => [
  { value: "up", label: props.labels.up },
  { value: "down", label: props.labels.down },
]);

const warningOptions = computed<readonly number[]>(() =>
  props.warnings?.length ? props.warnings : TIMER_DOCK_WARNINGS
);

const warningTabs = computed<LjTab[]>(() =>
  warningOptions.value.map((seconds, i) => ({
    value: String(seconds),
    label: props.labels.warnings[i] ?? String(seconds),
  }))
);

const customText = ref("");

/** O valor atual não está entre as opções: o campo é quem mostra o aviso. */
const customActive = computed(
  () => props.warningSeconds > 0 && !warningOptions.value.includes(props.warningSeconds)
);

function syncCustom(): void {
  customText.value = customActive.value ? String(props.warningSeconds) : "";
}

watch(() => [props.warningSeconds, warningOptions.value] as const, syncCustom, { immediate: true });

/** Aplica o que foi digitado; vazio ou inválido volta a mostrar o valor ativo. */
function applyCustom(): void {
  const parsed = Math.floor(Number(customText.value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    syncCustom();
    return;
  }
  const next = Math.min(TIMER_DOCK_CUSTOM_MAX, Math.max(1, parsed));
  customText.value = String(next);
  if (next !== props.warningSeconds) emit("update:warningSeconds", next);
}
</script>

<style scoped>
.timer-dock {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-4) var(--lj-space-6);
  padding: var(--lj-space-4) var(--lj-space-5);
  border-top: 1px solid var(--lj-body-divider);
  background: var(--lj-surface-bg);
}
.timer-dock__spacer {
  flex: 1 1 auto;
}
.timer-dock__warning {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
}
.timer-dock__label {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted, inherit);
  white-space: nowrap;
}
.timer-dock__custom {
  display: inline-flex;
  align-items: center;
  height: var(--lj-tab-height);
  padding-inline: var(--lj-space-3);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  cursor: text;
}
.timer-dock__custom:focus-within,
.timer-dock__custom.is-active {
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
}
.timer-dock__custom-input {
  width: 3.25rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--lj-text-base);
  text-align: right;
  outline: none;
  appearance: textfield;
}
.timer-dock__custom-input::-webkit-outer-spin-button,
.timer-dock__custom-input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}
.timer-dock__custom-input::placeholder {
  color: var(--lj-text-muted, inherit);
}
.timer-dock__custom-unit {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted, inherit);
}
</style>
