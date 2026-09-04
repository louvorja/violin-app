<template>
  <span
    class="lj-spinner"
    :style="{ width: px, height: px }"
    role="status"
    :aria-label="label ?? t('components.ui.loading')"
  >
    <svg viewBox="0 0 24 24" :width="size" :height="size">
      <circle
        class="lj-spinner__track"
        cx="12"
        cy="12"
        r="9"
        fill="none"
        :stroke-width="strokeWidth"
      />
      <circle
        class="lj-spinner__head"
        cx="12"
        cy="12"
        r="9"
        fill="none"
        :stroke-width="strokeWidth"
      />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = withDefaults(defineProps<{ size?: number; strokeWidth?: number; label?: string }>(), {
  size: 15,
  strokeWidth: 3,
});

const px = computed(() => `${props.size}px`);
</script>

<style scoped>
.lj-spinner {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.lj-spinner svg {
  animation: lj-spin 0.7s linear infinite;
}

.lj-spinner__track {
  stroke: currentColor;
  opacity: 0.25;
}

/* Arco de ~1/4 da circunferência (2·pi·9 ≈ 56.5). A soma do traço com o vão
   tem de fechar a circunferência, senão o arco "salta" a cada volta. */
.lj-spinner__head {
  stroke: currentColor;
  stroke-linecap: round;
  stroke-dasharray: 14 42.5;
}

@keyframes lj-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
