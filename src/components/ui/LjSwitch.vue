<template>
  <label class="lj-switch" :class="{ 'is-disabled': disabled }">
    <input
      ref="inputEl"
      type="checkbox"
      role="switch"
      class="lj-switch__input"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="lj-switch__track" aria-hidden="true"><span class="lj-switch__thumb" /></span>
    <span v-if="label || $slots.default" class="lj-switch__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{ modelValue?: boolean; label?: string; disabled?: boolean }>();

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
.lj-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  cursor: pointer;
  user-select: none;
  font-size: var(--lj-text-base);
  color: var(--lj-text);
}

.lj-switch.is-disabled {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

.lj-switch__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

/* Trilho discreto (28×16) — o pill largo do Material é o que denuncia a origem */
.lj-switch__track {
  position: relative;
  width: 28px;
  height: 16px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-active);
  border: 1px solid var(--lj-surface-border-strong);
  border-radius: 999px;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-switch__thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  background: var(--lj-surface-bg);
  border-radius: 50%;
  box-shadow: var(--lj-shadow-1);
  transition: transform var(--lj-transition-fast);
}

.lj-switch__input:checked + .lj-switch__track {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
}

.lj-switch__input:checked + .lj-switch__track .lj-switch__thumb {
  transform: translateX(12px);
}

.lj-switch__input:focus-visible + .lj-switch__track {
  box-shadow: var(--lj-ui-focus);
}
</style>
