<template>
  <div class="player-controls">
    <LjButton
      v-for="(button, key) in buttons"
      v-show="button.show && (compact === false || (compact === true && !button.compact))"
      :key="key"
      :disabled="loading || button.disabled"
      :icon="button.icon"
      :variant="button.highlight ? 'primary' : 'ghost'"
      size="sm"
      icon-only
      @click="button.click"
    />
  </div>
</template>

<script setup>
import { LjButton } from "@/components/ui";
defineProps({
  buttons: { type: Array, required: true },
  compact: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
</script>

<style scoped>
.player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-grow: 1;
  gap: var(--lj-space-4);
  /* Os 6px verticais somam o padding que a faixa já tinha e a margem que cada
     botão carregava: sem eles a linha de controles encolhe durante o culto. */
  padding-block: var(--lj-space-3);
}
</style>
