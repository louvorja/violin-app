<template>
  <LjDialog v-model="open" :title="tm('settings_dialog.title')" :icon="ICONS.TIMER.CLOCK_START" size="sm">
    <form data-testid="pm-settings-dialog" @submit.prevent="save">
      <LjField :label="tm('settings_dialog.planned_start')" :hint="tm('settings_dialog.planned_start_hint')">
        <LjInput v-model="start" type="time" autofocus />
      </LjField>
    </form>

    <template #footer>
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton variant="primary" :disabled="!valid" @click="save">{{ t("actions.save") }}</LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { parseHHMM } from "../program/time";

const props = defineProps<{ modelValue: boolean; plannedStart: string }>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [plannedStart: string];
}>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const start = ref("");
const valid = computed(() => parseHHMM(start.value) !== null);

watch(
  () => props.modelValue,
  (value) => {
    if (value) start.value = props.plannedStart;
  },
  { immediate: true }
);

function save(): void {
  if (!valid.value) return;
  emit("save", start.value);
  open.value = false;
}
</script>
