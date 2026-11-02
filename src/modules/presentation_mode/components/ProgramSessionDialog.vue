<template>
  <LjDialog
    v-model="open"
    :title="isNew ? tm('session_dialog.new_title') : tm('session_dialog.edit_title')"
    :icon="ICONS.ACTIONS.ADD_BOX"
    size="sm"
  >
    <form data-testid="pm-session-dialog" @submit.prevent="save">
      <LjField :label="tm('session_dialog.label')">
        <LjInput v-model="label" autofocus />
      </LjField>
    </form>

    <template #footer>
      <LjButton v-if="!isNew" variant="danger" :icon="ICONS.ACTIONS.DELETE" @click="emit('remove')">
        {{ t("actions.delete") }}
      </LjButton>
      <span class="pm-session-form__spacer" />
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton variant="primary" :disabled="!label.trim()" @click="save">
        {{ t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";

const props = defineProps<{
  modelValue: boolean;
  /** `null` cria uma sessão nova. */
  initialLabel: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [label: string];
  remove: [];
}>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const isNew = computed(() => props.initialLabel === null);
const label = ref("");

watch(
  () => props.modelValue,
  (value) => {
    if (value) label.value = props.initialLabel ?? "";
  },
  { immediate: true }
);

function save(): void {
  const value = label.value.trim();
  if (!value) return;
  emit("save", value);
  open.value = false;
}
</script>

<style scoped>
.pm-session-form__spacer {
  flex: 1;
}
</style>
