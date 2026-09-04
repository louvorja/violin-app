<template>
  <v-text-field
    v-model="input"
    :color="primaryColor"
    :disabled="disabled"
    :label="label"
    :prepend-inner-icon="ICONS.ACTIONS.SEARCH"
    :append-inner-icon="input ? ICONS.ACTIONS.CLOSE : ''"
    density="compact"
    variant="outlined"
    :hide-details="!disabled"
    :hint="disabled ? disabledHint : ''"
    :persistent-hint="disabled"
    :loading="disabled"
    :error="error"
    @click:append-inner="reset()"
  />
</template>

<script setup>
import { ICONS } from "@/config/Icons";
import { computed } from "vue";
import AppData from "@/helpers/AppData";

const props = defineProps({
  modelValue: String,
  label: String,
  disabled: Boolean,
  disabledHint: String,
  error: Boolean,
});

const emit = defineEmits(["update:modelValue"]);

const input = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const primaryColor = computed(() => (AppData.get("is_dark") ? undefined : "primary"));

function reset() {
  input.value = "";
}
</script>
