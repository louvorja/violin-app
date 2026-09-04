<template>
  <div class="lj-progress">
    <div v-if="label || showValue" class="lj-progress__header">
      <span v-if="label" class="lj-progress__label">{{ label }}</span>
      <span v-if="showValue && !indeterminate" class="lj-progress__value">{{ rounded }}%</span>
    </div>
    <div
      class="lj-progress__track"
      role="progressbar"
      :aria-valuenow="indeterminate ? undefined : rounded"
      aria-valuemin="0"
      aria-valuemax="100"
      :style="{ height: `${height}px` }"
    >
      <div
        class="lj-progress__bar"
        :class="{ 'lj-progress__bar--indeterminate': indeterminate }"
        :style="indeterminate ? undefined : { width: `${rounded}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    value?: number;
    label?: string;
    showValue?: boolean;
    indeterminate?: boolean;
    height?: number;
  }>(),
  { value: 0, height: 6 }
);

const rounded = computed(() => Math.max(0, Math.min(100, Math.round(props.value))));
</script>

<style scoped>
.lj-progress {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  width: 100%;
}

.lj-progress__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.lj-progress__value {
  font-variant-numeric: tabular-nums;
}

.lj-progress__track {
  width: 100%;
  overflow: hidden;
  background: var(--lj-surface-bg-active);
  border-radius: 999px;
}

.lj-progress__bar {
  height: 100%;
  background: var(--lj-ui-accent);
  border-radius: inherit;
  transition: width var(--lj-transition-normal);
}

.lj-progress__bar--indeterminate {
  width: 35%;
  animation: lj-progress-slide 1.1s var(--lj-ease) infinite;
}

@keyframes lj-progress-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(340%);
  }
}
</style>
