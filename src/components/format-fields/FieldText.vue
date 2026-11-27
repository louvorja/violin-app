<template>
  <LjInput
    type="text"
    size="sm"
    :model-value="modelValue || ''"
    class="format-field"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>

<script setup>
import LjInput from "@/components/ui/LjInput.vue";

defineProps({
  modelValue: { type: [String, null], default: null },
  field: { type: Object, required: true },
});
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.format-field {
  width: 100%;
}
</style>
