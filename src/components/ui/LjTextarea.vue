<template>
  <textarea
    class="lj-textarea"
    :class="{ 'is-invalid': invalid }"
    :value="modelValue"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
    @input="onInput"
  />
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string;
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
  }>(),
  { rows: 4 }
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}
</script>

<style scoped>
.lj-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: var(--lj-space-3) var(--lj-ui-px-md);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-base);
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-textarea::placeholder {
  color: var(--lj-text-subtle);
}

.lj-textarea:focus-visible {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-textarea:disabled {
  opacity: var(--lj-ui-disabled-opacity);
}

.lj-textarea.is-invalid {
  border-color: var(--lj-danger);
}
</style>
