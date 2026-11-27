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
      <!-- A marca fica sempre no DOM e quem a mostra é o CSS (`:checked`): assim
           ela tem de onde sair ao desmarcar, em vez de sumir de um quadro para o
           outro, e só anima em mudança de estado — nunca ao montar a tela. -->
      <LjIcon
        :icon="indeterminate ? ICONS.ACTIONS.MINUS : ICONS.UI.CHECK"
        :size="11"
        class="lj-check__icon"
      />
    </span>
    <span v-if="label || $slots.default" class="lj-check__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { nextTick, ref, watch } from "vue";
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
    background-color var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast),
    transform var(--lj-transition-fast);
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

/* A marca é DESENHADA: o traço corre do começo ao fim ao marcar, como quem
   risca o tique à mão, e é recolhido de volta ao desmarcar. Um ícone que só
   aparece e some não diz que algo foi feito.
   O ícone do Tabler é um traço (`stroke`), então basta animar o tracejado: 24 é
   maior que o comprimento de qualquer um dos dois desenhos (o tique mede ~21,
   o traço do indeterminado 14). São transições, não animações: transição não
   roda na primeira pintura, então abrir uma lista com cem caixas já marcadas
   não dispara cem riscos. */
.lj-check__icon :deep(path) {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset var(--lj-exit-panel);
}

.lj-check__input:checked + .lj-check__box .lj-check__icon :deep(path),
.lj-check__input:indeterminate + .lj-check__box .lj-check__icon :deep(path) {
  stroke-dashoffset: 0;
  transition: stroke-dashoffset var(--lj-draw);
}

.lj-check:not(.is-disabled):active .lj-check__box {
  transform: scale(0.88);
}
</style>
