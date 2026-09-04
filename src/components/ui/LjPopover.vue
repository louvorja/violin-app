<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="lj-ui-float lj-popover" :side="side" :align="align" :side-offset="4">
        <header v-if="title" class="lj-popover__header">
          <span :id="titleId" class="lj-popover__title">{{ title }}</span>
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
import { ref, useId } from "vue";
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

// LIMITAÇÃO CONHECIDA — o Reka rotula o painel pelo GATILHO: em
// PopoverContentImpl ele faz mergeProps(props, { "aria-labelledby": triggerId })
// com o valor dele por último, então um aria-labelledby vindo daqui é
// descartado. Um popover intitulado "Formatação" aberto por um botão
// "Formatar" é anunciado como "Formatar".
// Contornar exigiria mexer no DOM depois da montagem, o que custa mais do que
// resolve: na prática o gatilho quase sempre descreve o painel. Ao escolher o
// texto do gatilho, lembre que é ele o nome acessível do que abre.
const titleId = useId();
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
