<template>
  <div
    class="lj-input"
    :class="[`lj-ui-size-${size}`, { 'is-disabled': disabled, 'is-invalid': invalid }]"
  >
    <Icon v-if="icon" :icon="icon" :size="iconSize" class="lj-input__icon" />
    <input
      :id="id"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
      class="lj-input__field"
      @input="onInput"
    />
    <button
      v-if="clearable && String(modelValue ?? '').length"
      type="button"
      class="lj-input__clear"
      :aria-label="t('components.ui.clear')"
      @click="$emit('update:modelValue', '')"
    >
      <Icon :icon="ICONS.ACTIONS.CLOSE" :size="iconSize" />
    </button>
    <slot name="suffix" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    /** Casa com o `htmlFor` do LjField para o rótulo apontar ao campo real. */
    id?: string;
    size?: UiSize;
    type?: string;
    placeholder?: string;
    icon?: string;
    disabled?: boolean;
    invalid?: boolean;
    clearable?: boolean;
  }>(),
  { size: "md", type: "text" }
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();

// O wrapper carrega a moldura; o id precisa cair no <input>, não nele.
defineOptions({ inheritAttrs: false });

const iconSize = computed(() => ICON_SIZE[props.size]);

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<style scoped>
/* O wrapper carrega a moldura para que ícone e botão de limpar fiquem dentro
   dela — o <input> em si é transparente e sem borda. */
.lj-input {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-input:focus-within {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-input.is-disabled {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

.lj-input.is-invalid {
  border-color: var(--lj-danger);
}
.lj-input.is-invalid:focus-within {
  box-shadow: 0 0 0 2px var(--lj-danger-border);
}

.lj-input__icon {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.lj-input__field {
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

.lj-input__field::placeholder {
  color: var(--lj-text-subtle);
}

.lj-input__clear {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  flex-shrink: 0;
}
.lj-input__clear:hover {
  color: var(--lj-text);
}
</style>
