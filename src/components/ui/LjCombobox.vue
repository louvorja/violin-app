<template>
  <ComboboxRoot v-model="model" v-model:open="open" class="lj-combobox" :disabled="disabled">
    <ComboboxAnchor
      class="lj-combobox__anchor"
      :class="[`lj-ui-size-${size}`, { 'is-invalid': invalid }]"
    >
      <Icon :icon="ICONS.ACTIONS.SEARCH" :size="iconSize" class="lj-combobox__icon" />
      <ComboboxInput
        :id="resolvedId"
        class="lj-combobox__input"
        :placeholder="placeholder ?? t('components.ui.search_placeholder')"
        :display-value="displayValue"
        :aria-label="ariaLabel"
        :aria-describedby="describedBy"
      />
      <ComboboxTrigger class="lj-combobox__trigger">
        <Icon :icon="ICONS.UI.CHEVRON_DOWN" :size="iconSize" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent class="lj-ui-float lj-combobox__content" position="popper" :side-offset="4">
        <ComboboxViewport class="lj-combobox__viewport">
          <ComboboxEmpty class="lj-combobox__empty">
            {{ emptyText ?? t("components.ui.no_results") }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="item in items"
            :key="String(valueOf(item))"
            class="lj-combobox__item"
            :value="item"
          >
            <span class="lj-combobox__check"><Icon :icon="ICONS.UI.CHECK" :size="12" /></span>
            {{ labelOf(item) }}
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { useFieldContext } from "./fieldContext";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

type Item = string | number | Record<string, unknown>;

const props = withDefaults(
  defineProps<{
    modelValue?: Item | null;
    items?: Item[];
    itemValue?: string;
    itemLabel?: string;
    size?: UiSize;
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    invalid?: boolean;
    /** Nome acessível quando o combobox não está dentro de um LjField. */
    ariaLabel?: string;
    id?: string;
  }>(),
  {
    items: () => [],
    itemValue: "value",
    itemLabel: "label",
    size: "md",
  }
);

const emit = defineEmits<{ "update:modelValue": [value: Item] }>();

const { t } = useI18n();

// O root do Combobox é uma div sem papel: sem repassar explicitamente, o
// aria-label pousaria nela e o input com role="combobox" ficaria anônimo.
const field = useFieldContext();
const resolvedId = computed(() => props.id ?? field?.inputId.value);
const describedBy = computed(() => field?.describedById.value);
const isInvalid = computed(() => props.invalid || field?.invalid.value || false);

const open = ref(false);

const model = computed({
  get: () => props.modelValue ?? undefined,
  set: (value) => emit("update:modelValue", value as Item),
});

const iconSize = computed(() => ICON_SIZE[props.size]);

function valueOf(item: Item): string | number {
  return typeof item === "object" && item !== null
    ? (item[props.itemValue] as string | number)
    : item;
}

function labelOf(item: Item): string {
  return typeof item === "object" && item !== null
    ? String(item[props.itemLabel] ?? "")
    : String(item);
}

function displayValue(item: unknown): string {
  return item ? labelOf(item as Item) : "";
}
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-combobox__anchor {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-combobox__anchor:focus-within {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-combobox__anchor.is-invalid {
  border-color: var(--lj-danger);
}

.lj-combobox__icon {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.lj-combobox__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}

.lj-combobox__input::placeholder {
  color: var(--lj-text-subtle);
}

.lj-combobox__trigger {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  flex-shrink: 0;
}

.lj-combobox__content {
  min-width: var(--reka-combobox-trigger-width);
  max-height: 280px;
  overflow: hidden;
  z-index: 2400;
}

.lj-combobox__viewport {
  max-height: 280px;
  overflow: auto;
  padding: var(--lj-space-1);
}

.lj-combobox__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-height: var(--lj-ui-h-md);
  padding-inline: var(--lj-space-2) var(--lj-space-5);
  border-radius: var(--lj-radius-xs);
  font-size: var(--lj-text-base);
  cursor: pointer;
  outline: none;
}

.lj-combobox__item[data-highlighted] {
  background: var(--lj-surface-bg-hover);
}

.lj-combobox__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
  color: var(--lj-ui-accent-text);
  visibility: hidden;
}

.lj-combobox__item[data-state="checked"] .lj-combobox__check {
  visibility: visible;
}

.lj-combobox__empty {
  padding: var(--lj-space-5);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
  text-align: center;
}
</style>
