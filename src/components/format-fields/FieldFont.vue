<template>
  <LjSelect
    :model-value="modelValue || ''"
    :items="sortedFonts"
    item-value="family"
    item-label="name"
    size="sm"
    class="format-field"
    @update:model-value="$emit('update:modelValue', String($event))"
  >
    <template #item="{ item }">
      <span class="format-field__font-preview" :style="{ fontFamily: fontPreview(item.family) }">
        {{ item.name }}
      </span>
    </template>
  </LjSelect>
</template>

<script setup>
import { computed } from "vue";
import LjSelect from "@/components/ui/LjSelect.vue";
import { Fonts, resolveFont } from "@/config/Fonts";

defineProps({
  modelValue: { type: [String, null], default: null },
  field: { type: Object, required: true },
});
defineEmits(["update:modelValue"]);

const sortedFonts = computed(() => [...Fonts].sort((a, b) => a.name.localeCompare(b.name)));

function fontPreview(family) {
  return resolveFont(family, "inherit");
}
</script>

<style scoped>
.format-field {
  width: 100%;
}

.format-field__font-preview {
  display: inline-block;
  line-height: 1.35;
}
</style>
