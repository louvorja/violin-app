<template>
  <div class="player-gauge">
    <LjButton
      variant="ghost"
      size="sm"
      :disabled="loading"
      :icon="icon"
      icon-only
      @click="emit('toggle')"
    />
    <div class="player-gauge__bar" @click="onClick">
      <LjProgress :value="volume" :height="10" />
    </div>
  </div>
</template>

<script setup>
import { LjButton, LjProgress } from "@/components/ui";
import { ICONS } from "@/config/Icons";
defineProps({
  volume: { type: Number, default: 100 },
  icon: { type: String, default: ICONS.PLAYER.VOLUME_HIGH },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(["toggle", "seek"]);

// A barra é só apresentação: o volume novo sai da posição do clique dentro dela.
function onClick(e) {
  const el = e.currentTarget;
  if (!el) return;
  const { left, width } = el.getBoundingClientRect();
  const pct = Math.round(((e.clientX - left) / width) * 100);
  emit("seek", Math.max(0, Math.min(pct, 100)));
}
</script>

<style scoped>
.player-gauge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-2);
}

.player-gauge__bar {
  flex-grow: 1;
  min-width: 100px;
  cursor: pointer;
}
</style>
