<template>
  <div
    v-if="level"
    class="module-alert-frame"
    :class="`module-alert-frame--${level}`"
    :data-testid="`module-alert-frame-${level}`"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
/**
 * Moldura de aviso de tempo na prévia dos módulos de contagem (Cronômetro,
 * Temporizador, Temporizador de Culto): amarela perto do fim, vermelha depois
 * dele. É a mesma que o `ModuleProjectionLayer` desenha no telão quando o
 * módulo emite `alert`, em escala de prévia.
 *
 * O pai precisa ser `position: relative` — a moldura cobre a área dele.
 */
defineProps<{ level?: "" | "warning" | "danger" | null }>();
</script>

<style scoped>
.module-alert-frame {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  animation: module-alert-frame 1.2s ease-in-out infinite alternate;
}
.module-alert-frame--warning {
  box-shadow:
    inset 0 0 0 6px #f59e0b,
    inset 0 0 36px rgba(245, 158, 11, 0.55);
}
.module-alert-frame--danger {
  box-shadow:
    inset 0 0 0 7px #ef4444,
    inset 0 0 44px rgba(239, 68, 68, 0.6);
  animation-duration: 0.8s;
}
@keyframes module-alert-frame {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.25;
  }
}
@media (prefers-reduced-motion: reduce) {
  .module-alert-frame {
    animation: none;
  }
}
</style>
