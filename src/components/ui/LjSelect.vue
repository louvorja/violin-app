<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger
      v-bind="$attrs"
      class="lj-select"
      :class="[`lj-ui-size-${size}`, { 'is-invalid': invalid }]"
      :aria-label="ariaLabel"
    >
      <Icon v-if="icon" :icon="icon" :size="iconSize" class="lj-select__icon" />
      <SelectValue class="lj-select__value" :placeholder="placeholder">
        <slot name="value" :item="selectedItem">{{ selectedLabel }}</slot>
      </SelectValue>
      <Icon :icon="ICONS.UI.CHEVRON_DOWN" :size="iconSize" class="lj-select__caret" />
    </SelectTrigger>

    <SelectPortal>
      <SelectContent class="lj-ui-float lj-select__content" position="popper" :side-offset="4">
        <SelectScrollUpButton class="lj-select__scroll">
          <Icon :icon="ICONS.UI.CHEVRON_UP" :size="13" />
        </SelectScrollUpButton>

        <SelectViewport class="lj-select__viewport">
          <template v-for="item in items" :key="String(valueOf(item))">
            <SelectItem class="lj-select__item" :value="toInternal(valueOf(item))">
              <span class="lj-select__check">
                <Icon :icon="ICONS.UI.CHECK" :size="12" />
              </span>
              <SelectItemText>
                <slot name="item" :item="item">{{ labelOf(item) }}</slot>
              </SelectItemText>
            </SelectItem>
          </template>
        </SelectViewport>

        <SelectScrollDownButton class="lj-select__scroll">
          <Icon :icon="ICONS.UI.CHEVRON_DOWN" :size="13" />
        </SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<script setup lang="ts" generic="T extends string | number | object">
import { computed } from "vue";

import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

type Primitive = string | number;

const props = withDefaults(
  defineProps<{
    modelValue?: Primitive | null;
    items?: T[];
    /** Chave do valor quando os itens são objetos. */
    itemValue?: string;
    /** Chave do rótulo quando os itens são objetos. */
    itemLabel?: string;
    size?: UiSize;
    placeholder?: string;
    icon?: string;
    disabled?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
  }>(),
  {
    items: () => [],
    itemValue: "value",
    itemLabel: "label",
    size: "md",
    placeholder: "Selecione…",
  }
);

const emit = defineEmits<{ "update:modelValue": [value: Primitive] }>();

// SelectRoot não emite DOM — sem isto, class/style aplicados na tag do
// componente se perderiam em vez de chegar ao gatilho visível.
defineOptions({ inheritAttrs: false });

// O Reka reserva a string vazia para "sem seleção", mas no app "" é um valor
// legítimo — "mesma janela", "fonte padrão". Traduzimos nos dois sentidos para
// que os consumidores continuem usando "" normalmente.
const EMPTY = "\u0000lj-empty";

function toInternal(value: Primitive): Primitive {
  return value === "" ? EMPTY : value;
}

function fromInternal(value: Primitive): Primitive {
  return value === EMPTY ? "" : value;
}

const model = computed({
  get: () => (props.modelValue == null ? undefined : toInternal(props.modelValue)),
  set: (value) => emit("update:modelValue", fromInternal(value as Primitive)),
});

const iconSize = computed(() => ICON_SIZE[props.size]);

function valueOf(item: T): Primitive {
  return typeof item === "object" && item !== null
    ? ((item as Record<string, unknown>)[props.itemValue] as Primitive)
    : (item as Primitive);
}

function labelOf(item: T): string {
  return typeof item === "object" && item !== null
    ? String((item as Record<string, unknown>)[props.itemLabel] ?? "")
    : String(item);
}

const selectedItem = computed(() => props.items.find((item) => valueOf(item) === props.modelValue));

const selectedLabel = computed(() => (selectedItem.value ? labelOf(selectedItem.value) : ""));
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-select {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
  outline: none;
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-select:hover {
  border-color: var(--lj-ui-accent);
}

.lj-select:focus-visible,
.lj-select[data-state="open"] {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-select[data-disabled] {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

.lj-select.is-invalid {
  border-color: var(--lj-danger);
}

.lj-select__icon {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.lj-select__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
}

.lj-select__value[data-placeholder] {
  color: var(--lj-text-subtle);
}

.lj-select__caret {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

/* O painel acompanha a largura do gatilho — dropdown mais estreito ou mais
   largo que o campo é a assinatura visual de menu Material. */
.lj-select__content {
  min-width: var(--reka-select-trigger-width);
  max-height: 280px;
  overflow: hidden;
  z-index: 2400;
}

.lj-select__viewport {
  padding: var(--lj-space-1);
}

.lj-select__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  height: var(--lj-ui-h-md);
  padding-inline: var(--lj-space-2) var(--lj-space-5);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.lj-select__item[data-highlighted] {
  background: var(--lj-surface-bg-hover);
}

.lj-select__item[data-state="checked"] {
  font-weight: var(--lj-weight-semibold);
}

.lj-select__item[data-disabled] {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

/* Espaço reservado para a marca de seleção — sem ele a lista "pula"
   horizontalmente ao trocar de item. */
.lj-select__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
  color: var(--lj-ui-accent-text);
  visibility: hidden;
}

.lj-select__item[data-state="checked"] .lj-select__check {
  visibility: visible;
}

.lj-select__scroll {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  background: var(--lj-surface-bg);
  color: var(--lj-text-subtle);
  cursor: default;
}
</style>
