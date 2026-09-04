<template>
  <label class="lj-check" :class="{ 'is-disabled': disabled }">
    <input
      ref="inputEl"
      type="checkbox"
      class="lj-check__input"
      :checked="modelValue"
      :disabled="disabled"
      :indeterminate="indeterminate"
      @change="onChange"
    />
    <span class="lj-check__box" aria-hidden="true">
      <Icon v-if="indeterminate" :icon="ICONS.ACTIONS.MINUS" :size="11" />
      <Icon v-else-if="modelValue" :icon="ICONS.UI.CHECK" :size="11" />
    </span>
    <span v-if="label || $slots.default" class="lj-check__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

const props = defineProps<{
  modelValue?: boolean;
  label?: string;
  disabled?: boolean;
  indeterminate?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

// O <input> nativo já alternou sozinho quando o usuário clicou. Se o pai não
// aceitar a mudança (validação, confirmação, limite de seleção), `modelValue`
// não muda — e como o valor ligado continua o mesmo, o Vue não repinta a
// propriedade e o controle fica mostrando um estado que o modelo não tem.
// Num app conduzido ao vivo o operador confia no que vê, então o DOM é
// devolvido ao estado do modelo a cada mudança.
const inputEl = ref<HTMLInputElement | null>(null);

function syncFromModel(): void {
  if (inputEl.value) inputEl.value.checked = !!props.modelValue;
}

watch(() => props.modelValue, syncFromModel);

function onChange(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
  nextTick(syncFromModel);
}
</script>

<style scoped>
.lj-check {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  cursor: pointer;
  user-select: none;
  font-size: var(--lj-text-base);
  color: var(--lj-text);
}

.lj-check.is-disabled {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

/* Input real fica invisível mas focável — o :focus-visible dele estiliza a caixa */
.lj-check__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.lj-check__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-ui-accent-fg);
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-check__input:checked + .lj-check__box,
.lj-check__input:indeterminate + .lj-check__box {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
}

.lj-check__input:focus-visible + .lj-check__box {
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.lj-check:hover .lj-check__box {
  border-color: var(--lj-ui-accent);
}
</style>
