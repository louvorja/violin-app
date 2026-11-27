<template>
  <div ref="host" class="lit-daytabs" :data-today-index="todayIndex">
    <LjTabs
      :model-value="String(activeDay)"
      :tabs="dayTabItems"
      :aria-label="t('day_tabs.label')"
      @update:model-value="setActiveDay(Number($event))"
    />
  </div>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { LjTabs, type LjTab } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    activeDay?: number;
    dayLabels?: string[];
    dayItemCounts?: number[];
    todayIndex?: number;
    setActiveDay: (index: number) => void;
  }>(),
  {
    activeDay: 0,
    dayLabels: () => [],
    dayItemCounts: () => [],
    todayIndex: 0,
  }
);

const { t } = useLiturgyI18n();
const host = ref<HTMLElement | null>(null);

const dayTabItems = computed<LjTab[]>(() =>
  props.dayLabels.map((label, i) => ({
    value: String(i),
    label,
    icon: i === props.todayIndex ? ICONS.CALENDAR.STAR : ICONS.CALENDAR.BLANK_SOLID,
    badge: (props.dayItemCounts[i] ?? 0) > 0 ? props.dayItemCounts[i] : undefined,
  }))
);

watch(
  () => props.activeDay,
  async () => {
    await nextTick();
    const list = host.value?.querySelector<HTMLElement>(".lj-tabs__list");
    if (!list || !window.matchMedia("(max-width: 600px)").matches) return;
    const active = list.querySelector<HTMLElement>('.lj-tabs__trigger[data-state="active"]');
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    list.scrollLeft += activeRect.left - listRect.left - (listRect.width - activeRect.width) / 2;
  },
  { immediate: true }
);
</script>

<style scoped>
.lit-daytabs {
  background: var(--lj-surface-bg);
  flex-shrink: 0;
}

.lit-daytabs :deep(.lj-tabs__list) {
  padding: 0 var(--lj-space-4);
  gap: 0;
}

.lit-daytabs :deep(.lj-tabs__trigger) {
  flex: 1;
  min-width: 0;
  justify-content: center;
  height: 36px;
  padding-inline: var(--lj-space-3);
}

.lit-daytabs :deep(.lj-tabs__trigger .lj-chip) {
  font-variant-numeric: tabular-nums;
}

.lit-daytabs :deep(.lj-tabs__trigger[data-state="active"] .lj-chip) {
  background: var(--lj-ui-accent-soft);
  border-color: transparent;
  color: var(--lj-ui-accent-text);
}

/* Destaque sutil no ícone do dia atual (hoje). */
.lit-daytabs[data-today-index="0"] :deep(.lj-tabs__trigger:nth-of-type(1) .lj-icon),
.lit-daytabs[data-today-index="1"] :deep(.lj-tabs__trigger:nth-of-type(2) .lj-icon),
.lit-daytabs[data-today-index="2"] :deep(.lj-tabs__trigger:nth-of-type(3) .lj-icon),
.lit-daytabs[data-today-index="3"] :deep(.lj-tabs__trigger:nth-of-type(4) .lj-icon),
.lit-daytabs[data-today-index="4"] :deep(.lj-tabs__trigger:nth-of-type(5) .lj-icon),
.lit-daytabs[data-today-index="5"] :deep(.lj-tabs__trigger:nth-of-type(6) .lj-icon),
.lit-daytabs[data-today-index="6"] :deep(.lj-tabs__trigger:nth-of-type(7) .lj-icon) {
  color: var(--lj-orange);
}

@media (max-width: 600px) {
  .lit-daytabs :deep(.lj-tabs__list) {
    min-width: 0;
    max-width: 100%;
    padding: 0 var(--lj-space-2);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    scroll-snap-type: x proximity;
    touch-action: pan-x;
  }

  .lit-daytabs :deep(.lj-tabs__list::-webkit-scrollbar) {
    display: none;
  }

  .lit-daytabs :deep(.lj-tabs__trigger) {
    flex: 0 0 auto;
    min-width: 84px;
    height: 44px;
    padding-inline: var(--lj-space-4);
    scroll-snap-align: center;
  }
}
</style>
