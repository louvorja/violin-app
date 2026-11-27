<template>
  <LjSwitch :model-value="!!modelValue" @update:model-value="$emit('update:modelValue', $event)" />
</template>

<script setup>
import LjSwitch from "@/components/ui/LjSwitch.vue";

defineProps({
  modelValue: { type: [Boolean, null], default: false },
  field: { type: Object, required: true },
});
defineEmits(["update:modelValue"]);
</script>
