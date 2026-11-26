<template>
  <nav ref="tabs" class="lit-daytabs">
    <button
      v-for="(label, i) in dayLabels"
      :key="i"
      type="button"
      class="lit-daytab"
      :class="{ 'is-active': activeDay === i, 'is-today': i === todayIndex }"
      :title="label"
      @click="setActiveDay(i)"
    >
      <LjIcon
        :icon="i === todayIndex ? ICONS.CALENDAR.STAR : ICONS.CALENDAR.BLANK_SOLID"
        size="16"
        class="lit-daytab__icon"
      />
      <span class="lit-daytab__label">{{ label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { nextTick, ref, watch } from "vue";
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

const tabs = ref<HTMLElement | null>(null);

watch(
  () => props.activeDay,
  async () => {
    await nextTick();
    const nav = tabs.value;
    if (!nav || !window.matchMedia("(max-width: 600px)").matches) return;
    const active = nav.querySelector<HTMLElement>(".lit-daytab.is-active");
    if (!active) return;
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    nav.scrollLeft += activeRect.left - navRect.left - (navRect.width - activeRect.width) / 2;
  },
  { immediate: true }
);
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
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  min-height: var(--lj-ui-h-lg);
  padding: var(--lj-space-2) var(--lj-space-5);
  background: transparent;
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  white-space: nowrap;
  transition:
    background var(--lj-transition-normal),
    border var(--lj-transition-normal);
}
.lit-daytab__label {
  overflow: hidden;
  text-overflow: ellipsis;
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

@media (max-width: 600px) {
  .lit-daytabs {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    scroll-snap-type: x proximity;
    touch-action: pan-x;
  }

  .lit-daytabs::-webkit-scrollbar {
    display: none;
  }

  .lit-daytab {
    flex: 0 0 auto;
    min-width: 76px;
    min-height: 44px;
    padding-inline: var(--lj-space-3);
    scroll-snap-align: center;
  }
}
</style>
