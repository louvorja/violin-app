<template>
  <LjDialog
    v-model="open"
    :title="tm('settings_dialog.title')"
    :icon="ICONS.TIMER.CLOCK_START"
    size="md"
  >
    <form data-testid="pm-settings-dialog" @submit.prevent="save">
      <LjField
        :label="tm('settings_dialog.planned_start')"
        :hint="tm('settings_dialog.planned_start_hint')"
      >
        <LjInput v-model="start" type="time" autofocus />
      </LjField>

      <!-- Pasta da igreja: vale para este computador, na hora (não espera o Salvar). -->
      <LjField
        v-if="church.supported"
        :label="tm('church.folder')"
        :hint="church.root.value ? tm('church.hint_on') : tm('church.hint_off')"
      >
        <div class="pm-settings__folder">
          <span
            class="pm-settings__path"
            :class="{ 'pm-settings__path--set': !!church.root.value }"
            :title="church.root.value ?? ''"
            data-testid="pm-church-folder"
          >
            <bdi dir="ltr">{{ church.root.value || tm("church.none") }}</bdi>
          </span>
          <LjButton
            size="sm"
            :icon="ICONS.UI.FOLDER_OPEN"
            data-testid="pm-church-choose"
            @click="church.choose()"
          >
            {{ church.root.value ? tm("church.change") : tm("church.choose") }}
          </LjButton>
          <LjButton
            v-if="church.root.value"
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.CLOSE"
            :title="tm('church.remove')"
            :aria-label="tm('church.remove')"
            @click="church.clear()"
          />
        </div>
      </LjField>
    </form>

    <template #footer>
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton variant="primary" :disabled="!valid" @click="save">
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
import { parseHHMM } from "../program/time";
import { useChurchFolder } from "../composables/useChurchFolder";

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

const church = useChurchFolder();
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

<style scoped>
form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}

.pm-settings__folder {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.pm-settings__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

/* Caminho longo: corta o começo, que é o menos útil ("/Users/…/OneDrive/…"). */
.pm-settings__path--set {
  direction: rtl;
}
</style>
