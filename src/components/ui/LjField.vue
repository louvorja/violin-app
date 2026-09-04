<template>
  <div class="lj-field" :class="`lj-field--${layout}`">
    <label v-if="label" class="lj-field__label" :for="htmlFor">
      {{ label }}
      <span v-if="required" class="lj-field__required" aria-hidden="true">*</span>
    </label>
    <div class="lj-field__control">
      <slot />
      <p v-if="error" class="lj-field__error">{{ error }}</p>
      <p v-else-if="hint" class="lj-field__hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    error?: string;
    htmlFor?: string;
    required?: boolean;
    /** row = rótulo à esquerda (telas densas). column = rótulo acima. */
    layout?: "row" | "column";
  }>(),
  { layout: "row" }
);
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
