<template>
  <div
    v-if="level"
    class="module-alert-frame"
    :class="`module-alert-frame--${level}`"
    :data-testid="`module-alert-frame-${level}`"
    :style="color ? { '--frame-color': color } : undefined"
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
defineProps<{
  level?: "" | "warning" | "danger" | null;
  /** Cor da moldura — a mesma do número ("Cor do aviso"/"Cor do alerta" da Formatação). */
  color?: string;
}>();
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
  --frame-color-default: #f59e0b;
  box-shadow:
    inset 0 0 0 6px var(--frame-color, var(--frame-color-default)),
    inset 0 0 36px
      color-mix(in srgb, var(--frame-color, var(--frame-color-default)) 55%, transparent);
}
.module-alert-frame--danger {
  --frame-color-default: #ef4444;
  box-shadow:
    inset 0 0 0 7px var(--frame-color, var(--frame-color-default)),
    inset 0 0 44px
      color-mix(in srgb, var(--frame-color, var(--frame-color-default)) 60%, transparent);
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
