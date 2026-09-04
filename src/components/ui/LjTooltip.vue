<template>
  <TooltipRoot :delay-duration="delay">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="lj-tooltip" :side="side" :side-offset="5">
        {{ text }}
        <kbd v-if="shortcut" class="lj-tooltip__kbd">{{ shortcut }}</kbd>
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";

withDefaults(
  defineProps<{
    text: string;
    shortcut?: string;
    side?: "top" | "right" | "bottom" | "left";
    delay?: number;
  }>(),
  { side: "top", delay: 400 }
);
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
/* Tooltip é a única superfície flutuante invertida do sistema: fundo escuro
   sobre a interface clara, para não competir com menus e popovers. */
.lj-tooltip {
  z-index: 2600;
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  max-width: 280px;
  padding: var(--lj-space-2) var(--lj-space-4);
  background: var(--lj-gray-800);
  border-radius: var(--lj-radius-xs);
  box-shadow: var(--lj-shadow-2);
  color: var(--lj-white);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-sm);
  line-height: 1.4;
}

.lj-tooltip__kbd {
  padding: 0 var(--lj-space-2);
  background: var(--lj-white-alpha-18);
  border-radius: var(--lj-radius-xs);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
}
</style>
