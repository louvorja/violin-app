<template>
  <ColorField
    :model-value="modelValue || '#ffffff'"
    size="sm"
    show-hex
    full-width
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>

<script setup>
import ColorField from "@/components/inputs/ColorField.vue";

defineProps({
  modelValue: { type: [String, null], default: null },
  field: { type: Object, required: true },
});
defineEmits(["update:modelValue"]);
</script>
