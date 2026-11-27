<template>
  <LjInput
    type="number"
    size="sm"
    :model-value="modelValue ?? ''"
    :min="min"
    :max="max"
    class="format-field format-field--number"
    @update:model-value="$emit('update:modelValue', Number($event))"
  />
</template>

<script setup>
import { computed } from "vue";
import LjInput from "@/components/ui/LjInput.vue";

const props = defineProps({
  modelValue: { type: [Number, null], default: null },
  field: { type: Object, required: true },
});
defineEmits(["update:modelValue"]);

/*
 * Faixas por tipo. `opacity` e `radius` admitem 0 de propósito: transparência
 * zero é "fundo invisível" e raio zero é "sem cantos" — os dois são valores
 * legítimos, não ausência.
 */
const min = computed(() =>
  props.field.type === "opacity" || props.field.type === "radius" || props.field.type === "padding"
    ? 0
    : 1
);
const max = computed(() => {
  if (props.field.type === "opacity") return 100;
  if (props.field.type === "radius") return 50;
  if (props.field.type === "border-width") return 20;
  if (props.field.type === "border-spacing") return 50;
  if (props.field.type === "padding") return 100;
  return 300;
});
</script>

<style scoped>
.format-field--number {
  width: 88px;
}
</style>
