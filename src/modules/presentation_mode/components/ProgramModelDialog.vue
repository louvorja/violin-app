<template>
  <LjDialog
    v-model="open"
    :title="mode === 'new' ? tm('models.new_title') : tm('models.save_title')"
    :icon="ICONS.LITURGY.SCRIPT"
    size="sm"
  >
    <form class="pm-model-form" data-testid="pm-model-dialog" @submit.prevent="submit">
      <template v-if="mode === 'new'">
        <LjField :label="tm('program.date')">
          <LjInput v-model="date" type="date" data-testid="pm-model-date" />
        </LjField>
        <LjField :label="tm('models.model')" :hint="summary">
          <LjSelect
            v-model="modelId"
            :items="options"
            item-value="value"
            item-label="label"
            data-testid="pm-model-select"
          />
        </LjField>
      </template>
      <template v-else>
        <LjField :label="tm('models.name')" :hint="overwriteHint">
          <LjInput v-model="name" autofocus data-testid="pm-model-name" />
        </LjField>
        <p class="pm-model-form__hint">{{ tm("models.save_hint", { n: fillCount }) }}</p>
      </template>
    </form>

    <template #footer>
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton variant="primary" :disabled="!valid" data-testid="pm-model-confirm" @click="submit">
        {{ mode === "new" ? tm("models.create") : t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { modelFromProgram, pendingItems, slugOf } from "../program/models";
import { useProgram } from "../composables/useProgram";
import { useProgramModels } from "../composables/useProgramModels";

/**
 * Modelos de culto. `new`: o programa de uma data nasce de um modelo, com os
 * itens da semana pendentes. `save`: o programa aberto vira modelo — os itens
 * marcados "muda toda semana" vão vazios.
 */

const props = defineProps<{ modelValue: boolean; mode: "new" | "save" }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const program = useProgram();
const { models, load, save } = useProgramModels();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const BLANK = "__blank__";
const date = ref("");
const modelId = ref(BLANK);
const name = ref("");

/** O próximo sábado (ou hoje, se for sábado): é o culto que se prepara. */
function nextSaturday(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

watch(
  () => props.modelValue,
  async (value) => {
    if (!value) return;
    await load();
    date.value = nextSaturday();
    modelId.value = models.value[0]?.id ?? BLANK;
    name.value = models.value[0]?.name ?? tm("models.default_name");
  },
  { immediate: true }
);

const options = computed(() => [
  ...models.value.map((m) => ({ value: m.id, label: m.name })),
  { value: BLANK, label: tm("models.blank") },
]);

const chosen = computed(() => models.value.find((m) => m.id === modelId.value) ?? null);

const summary = computed(() => {
  const m = chosen.value;
  if (!m) return tm("models.blank_hint");
  const items = m.sessions.reduce((n, s) => n + s.items.length, 0);
  return tm("models.summary", { items, pending: pendingItems(m).length });
});

const fillCount = computed(
  () => program.program.value.sessions.flatMap((s) => s.items).filter((i) => i.fill).length
);

const overwriteHint = computed(() => {
  const existing = models.value.find((m) => m.id === slugOf(name.value));
  return existing ? tm("models.overwrite", { name: existing.name }) : "";
});

const valid = computed(() =>
  props.mode === "new" ? /^\d{4}-\d{2}-\d{2}$/.test(date.value) : !!name.value.trim()
);

function askReplace(): Promise<boolean> {
  return new Promise((resolve) =>
    $alert.yesno(
      {
        title: `modules.${ModuleEnum.PRESENTATION_MODE}.models.replace_title`,
        text: `modules.${ModuleEnum.PRESENTATION_MODE}.models.replace_text`,
      },
      (resp?: string) => resolve(resp === "yes")
    )
  );
}

async function submit(): Promise<void> {
  if (!valid.value) return;
  if (props.mode === "save") {
    const model = modelFromProgram(program.program.value, name.value);
    if (await save(model)) {
      $snackbar.success(tm("models.saved", { name: model.name }));
      Telemetry.track("presentation_model_saved", { items: model.sessions.length });
      open.value = false;
    } else {
      $snackbar.error(tm("models.save_failed"));
    }
    return;
  }
  const model = chosen.value;
  open.value = false;
  await program.setDate(date.value);
  if (program.program.value.sessions.some((s) => s.items.length) && !(await askReplace())) return;
  if (model) program.applyModel(model);
  else program.setSessions([]);
  Telemetry.track("presentation_program_from_model", { blank: !model });
}
</script>

<style scoped>
.pm-model-form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}

.pm-model-form__hint {
  margin: 0;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
