<template>
  <div
    class="lj-field"
    :class="`lj-field--${layout}`"
    :role="group ? 'group' : undefined"
    :aria-labelledby="group && label ? labelId : undefined"
  >
    <!-- Um rótulo de grupo não pode ser <label for>: ele descreve o conjunto,
         e um `for` teria de escolher arbitrariamente um dos controles. -->
    <component
      :is="group ? 'span' : 'label'"
      v-if="label"
      :id="group ? labelId : undefined"
      class="lj-field__label"
      :for="group ? undefined : inputId"
    >
      {{ label }}
      <span v-if="required" class="lj-field__required" aria-hidden="true">*</span>
    </component>
    <div class="lj-field__control">
      <slot :input-id="inputId" :described-by-id="describedById" />
      <p v-if="error" :id="messageId" class="lj-field__error" role="alert">{{ error }}</p>
      <p v-else-if="hint" :id="messageId" class="lj-field__hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { provideFieldContext } from "./fieldContext";

const props = withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    error?: string;
    htmlFor?: string;
    required?: boolean;
    /** row = rótulo à esquerda (telas densas). column = rótulo acima. */
    layout?: "row" | "column";
    /** O rótulo descreve um conjunto de controles, não um campo só. */
    group?: boolean;
  }>(),
  { layout: "row" }
);

// O id é gerado aqui e publicado no contexto: assim o rótulo e o controle se
// encontram sem o chamador ter de inventar e repetir um id.
const generatedId = useId();
const inputId = computed(() => props.htmlFor || generatedId);
const messageId = computed(() => `${inputId.value}-msg`);
const labelId = computed(() => `${inputId.value}-label`);
const describedById = computed(() => (props.error || props.hint ? messageId.value : undefined));

provideFieldContext({
  inputId,
  describedById,
  invalid: computed(() => !!props.error),
});
</script>

<style scoped>
.lj-field {
  display: flex;
  font-size: var(--lj-text-base);
}

.lj-field--row {
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-5);
}

.lj-field--column {
  flex-direction: column;
  align-items: stretch;
  gap: var(--lj-space-3);
  margin-bottom: var(--lj-space-5);
}

.lj-field__label {
  color: var(--lj-text-muted);
  font-weight: var(--lj-weight-medium);
}

.lj-field--row .lj-field__label {
  flex: 0 0 auto;
  min-width: 180px;
}

.lj-field__required {
  color: var(--lj-danger);
  margin-left: 2px;
}

.lj-field__control {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  min-width: 0;
}

.lj-field--column .lj-field__control {
  align-items: stretch;
}

.lj-field__hint,
.lj-field__error {
  margin: 0;
  font-size: var(--lj-text-sm);
  line-height: 1.4;
}

.lj-field__hint {
  color: var(--lj-text-subtle);
}

.lj-field__error {
  color: var(--lj-alert-error-color, var(--lj-danger));
}
</style>
