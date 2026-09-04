<template>
  <div class="pgb">
    <label v-if="$slots.label" class="opt-label">
      <slot name="label" />
    </label>
    <label v-else-if="total > 0" class="opt-label">{{ done }}/{{ total }} ({{ percent }}%)</label>

    <LjProgress :value="percent" :height="8" />

    <div v-if="current" class="opt-folder-path">
      {{ current }}
    </div>

    <slot />

    <div v-if="failed > 0" class="opt-hint">
      <slot name="failed">{{ failed }} falha(s)</slot>
    </div>

    <div v-if="completedMsg" class="opt-folder-path">
      {{ completedMsg }}
    </div>

    <div v-if="showCancel" class="opt-folder-actions" style="margin-top: 8px">
      <LjButton size="sm" variant="danger" :icon="cancelIcon" @click="$emit('cancel')">
        {{ cancelLabel }}
      </LjButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from "@/config/Icons";
import { computed } from "vue";
import LjButton from "@/components/ui/LjButton.vue";
import LjProgress from "@/components/ui/LjProgress.vue";

const props = withDefaults(
  defineProps<{
    done?: number;
    total?: number;
    current?: string | null;
    failed?: number;
    completedMsg?: string;
    showCancel?: boolean;
    cancelIcon?: string;
    cancelLabel?: string;
  }>(),
  {
    done: 0,
    total: 0,
    current: "",
    failed: 0,
    completedMsg: "",
    showCancel: false,
    cancelIcon: ICONS.ACTIONS.CANCEL,
    cancelLabel: "Cancelar",
  }
);

defineEmits<{ cancel: [] }>();

const percent = computed(() =>
  props.total > 0 ? Math.round((props.done / props.total) * 100) : 0
);
</script>

<style scoped>
.pgb {
  display: flex;
  flex-direction: column;
}
</style>
