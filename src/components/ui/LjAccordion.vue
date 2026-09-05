<template>
  <AccordionRoot
    class="lj-accordion"
    :class="{ 'lj-accordion--flush': flush }"
    :type="multiple ? 'multiple' : 'single'"
    :model-value="valorRaiz"
    :collapsible="collapsible"
    :disabled="disabled"
    @update:model-value="aoMudar"
  >
    <AccordionItem
      v-for="(item, index) in items"
      :key="item.value"
      class="lj-accordion__item"
      :value="item.value"
      :disabled="item.disabled"
    >
      <AccordionHeader class="lj-accordion__header">
        <AccordionTrigger class="lj-accordion__trigger">
          <Icon :icon="ICONS.UI.CHEVRON_RIGHT" :size="14" class="lj-accordion__chevron" />
          <Icon v-if="item.icon" :icon="item.icon" :size="14" class="lj-accordion__icon" />
          <span class="lj-accordion__label">{{ item.label }}</span>
        </AccordionTrigger>
      </AccordionHeader>

      <AccordionContent class="lj-accordion__content">
        <div class="lj-accordion__body">
          <slot :name="item.value" :item="item" :index="index">
            <slot name="content" :item="item" :index="index" />
          </slot>
        </div>
      </AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
} from "reka-ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

export interface LjAccordionItem {
  /** Identifica o painel — é o nome do slot de conteúdo e o valor do v-model. */
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: LjAccordionItem[];
    /** Vários painéis abertos ao mesmo tempo. */
    multiple?: boolean;
    /**
     * No modo de um painel só, permite fechar o que está aberto. Ao contrário
     * da Reka, aqui vem ligado: um cabeçalho que não responde ao segundo
     * clique passa por travado, e nada na tela explica por quê.
     */
    collapsible?: boolean;
    disabled?: boolean;
    /** Sem moldura externa — para quando o contêiner ao redor já desenha uma. */
    flush?: boolean;
  }>(),
  { collapsible: true }
);

const model = defineModel<string | string[]>();

// A Reka decide uma única vez, no setup, se é controlada — olhando se o
// modelValue chegou undefined. No modo de um painel só, undefined é um valor
// legítimo (nada aberto), e passá-lo adiante deixaria o componente preso em
// modo não controlado depois do primeiro fechamento. Daqui para baixo o valor
// é sempre definido; quem manda continua sendo o defineModel, que já distingue
// v-model de leitura solta.
const valorRaiz = computed<string | string[]>(() => model.value ?? (props.multiple ? [] : ""));

function aoMudar(valor: string | string[] | undefined): void {
  model.value = valor;
}
</script>

<style scoped>
.lj-accordion {
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg);
  overflow: hidden;
  color: var(--lj-text);
}

.lj-accordion--flush {
  border: none;
  border-radius: 0;
  background: transparent;
}

.lj-accordion__item + .lj-accordion__item {
  border-top: 1px solid var(--lj-surface-divider);
}

.lj-accordion__header {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.lj-accordion__trigger {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  min-height: var(--lj-ui-h-lg);
  padding: 0 var(--lj-space-5);
  background: var(--lj-surface-bg-soft);
  border: none;
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: background var(--lj-transition-fast);
}

.lj-accordion__trigger:hover {
  background: var(--lj-surface-bg-hover);
}

/* Anel por dentro: a moldura recorta o que passa das bordas, e um foco de
   2px por fora sumiria nas laterais de uma linha que ocupa a largura toda. */
.lj-accordion__trigger:focus-visible {
  box-shadow: inset var(--lj-ui-focus);
}

.lj-accordion__trigger[data-disabled] {
  opacity: var(--lj-ui-disabled-opacity);
  cursor: default;
}

.lj-accordion__trigger[data-disabled]:hover {
  background: var(--lj-surface-bg-soft);
}

.lj-accordion__chevron {
  color: var(--lj-text-muted);
  transition: transform var(--lj-transition-fast);
}

.lj-accordion__trigger[data-state="open"] .lj-accordion__chevron {
  transform: rotate(90deg);
}

.lj-accordion__trigger[data-state="open"] {
  color: var(--lj-ui-accent-text);
}

.lj-accordion__icon {
  color: var(--lj-text-muted);
}

.lj-accordion__label {
  flex: 1;
  min-width: 0;
  font-weight: var(--lj-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lj-accordion__content {
  overflow: hidden;
  background: var(--lj-surface-bg);
}

.lj-accordion__content[data-state="open"] {
  animation: lj-accordion-abre var(--lj-ui-float-enter);
}

.lj-accordion__content[data-state="closed"] {
  animation: lj-accordion-fecha var(--lj-ui-float-exit);
}

/* O respiro mora aqui, e não no elemento animado: `height: 0` não zera padding,
   então um painel fechado continuaria ocupando essa faixa. */
.lj-accordion__body {
  padding: var(--lj-space-5);
}

/* `height: auto` não interpola. Quem dá o número é a Reka, que mede o conteúdo
   e publica a altura em --reka-accordion-content-height. */
@keyframes lj-accordion-abre {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--reka-accordion-content-height);
    opacity: 1;
  }
}

@keyframes lj-accordion-fecha {
  from {
    height: var(--reka-accordion-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}
</style>
