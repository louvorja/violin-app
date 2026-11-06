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
</script>

<script setup lang="ts">
import { computed } from "vue";
import { LjTabs } from "@/components/ui";
import type { LjTab } from "@/components/ui";

const props = defineProps<{
  mode: TimerDockMode;
  /** Segundos do aviso; um valor fora da lista deixa nenhum botão marcado. */
  warningSeconds: number;
  labels: {
    mode: string;
    up: string;
    down: string;
    warning: string;
    /** Rótulo de cada opção de TIMER_DOCK_WARNINGS, na mesma ordem. */
    warnings: string[];
  };
}>();

const emit = defineEmits<{
  "update:mode": [value: TimerDockMode];
  "update:warningSeconds": [value: number];
}>();

const modeTabs = computed<LjTab[]>(() => [
  { value: "up", label: props.labels.up },
  { value: "down", label: props.labels.down },
]);

const warningTabs = computed<LjTab[]>(() =>
  TIMER_DOCK_WARNINGS.map((seconds, i) => ({
    value: String(seconds),
    label: props.labels.warnings[i] ?? String(seconds),
  }))
);
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
</style>
