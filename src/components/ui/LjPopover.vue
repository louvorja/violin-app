<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="lj-ui-float lj-popover" :side="side" :align="align" :side-offset="4">
        <header v-if="title" class="lj-popover__header">
          <span class="lj-popover__title">{{ title }}</span>
          <PopoverClose class="lj-popover__close" :aria-label="t('actions.close')">
            <Icon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
          </PopoverClose>
        </header>
        <div class="lj-popover__body"><slot /></div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PopoverClose, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

const { t } = useI18n();

withDefaults(
  defineProps<{
    title?: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  }>(),
  { side: "bottom", align: "start" }
);

const open = ref(false);
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-popover {
  z-index: 2400;
  min-width: 220px;
  max-width: 360px;
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
}

.lj-popover__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.lj-popover__title {
  font-weight: var(--lj-weight-semibold);
}

.lj-popover__close {
  display: inline-flex;
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}
.lj-popover__close:hover {
  color: var(--lj-text);
}

.lj-popover__body {
  padding: var(--lj-space-4);
}
</style>
