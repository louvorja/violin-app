<template>
  <nav class="lit-daytabs">
    <button
      v-for="(label, i) in dayLabels"
      :key="i"
      class="lit-daytab"
      :class="{ 'is-active': activeDay === i, 'is-today': i === todayIndex }"
      :title="label"
      @click="setActiveDay(i)"
    >
      <span>
        <LjIcon
          :icon="i === todayIndex ? ICONS.CALENDAR.STAR : ICONS.CALENDAR.BLANK_SOLID"
          size="16"
          class="lit-daytab__icon"
        />
        {{ label }}
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
const props = withDefaults(
  defineProps<{
    activeDay?: number;
    dayLabels?: string[];
    todayIndex?: number;
    setActiveDay: (index: number) => void;
  }>(),
  {
    activeDay: 0,
    dayLabels: () => [],
    todayIndex: 0,
  }
);

void props;
</script>

<style scoped>
.lit-daytabs {
  display: flex;
  align-items: stretch;
  gap: var(--lj-space-2);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg);
  border-bottom: 1px solid var(--lj-surface-border);
  flex-shrink: 0;
}

.lit-daytab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-1);
  min-height: var(--lj-ui-h-lg);
  padding: var(--lj-space-2) var(--lj-space-5);
  background: transparent;
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  transition:
    background var(--lj-transition-normal),
    border var(--lj-transition-normal);
}
.lit-daytab:hover {
  background: rgba(var(--lj-on-surface-ch), 0.06);
}
.lit-daytab.is-active {
  background: var(--lj-ui-accent-soft);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
  font-weight: var(--lj-weight-semibold);
}

.lit-daytab:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.lit-daytab.is-today .lit-daytab__icon {
  color: var(--lj-orange);
}
</style>
