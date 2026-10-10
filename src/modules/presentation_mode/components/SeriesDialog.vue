<template>
  <LjDialog
    v-model="open"
    :title="tm('series.dialog_title')"
    :icon="ICONS.MEDIA.PLAYLIST"
    size="sm"
  >
    <form class="pm-series-form" data-testid="pm-series-dialog" @submit.prevent="save">
      <p class="pm-series-form__help">{{ tm("series.dialog_help") }}</p>
      <LjField :label="tm('series.name')">
        <LjInput v-model="name" autofocus data-testid="pm-series-name" />
      </LjField>
      <LjField :label="tm('series.on_end')">
        <LjSelect v-model="onEnd" :items="onEndItems" data-testid="pm-series-on-end" />
      </LjField>
    </form>
    <template #footer>
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton
        variant="primary"
        :disabled="!name.trim()"
        data-testid="pm-series-save"
        @click="save"
      >
        {{ t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { SeriesDoc } from "@/types/Series";
import { useSeries } from "../composables/useSeries";
import { splitPath } from "../program/series";

/** Criar ou editar a série de uma pasta. Aberto por `useSeries().openDialog(dir)`. */

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const series = useSeries();

const open = computed({
  get: () => series.dialogDir.value !== null,
  set: (value) => {
    if (!value) series.dialogDir.value = null;
  },
});

const name = ref("");
const onEnd = ref<SeriesDoc["onEnd"]>("restart");
const onEndItems = computed(() => [
  { value: "restart", label: tm("series.on_end_restart") },
  { value: "suggest_new", label: tm("series.on_end_new") },
]);

watch(series.dialogDir, (dir) => {
  if (!dir) return;
  const doc = series.of(dir);
  name.value = doc?.name ?? dir.split(/[\\/]/).pop() ?? "";
  onEnd.value = doc?.onEnd ?? "restart";
});

async function save(): Promise<void> {
  const dir = series.dialogDir.value;
  if (!dir || !name.value.trim()) return;
  const ok = series.of(dir)
    ? await series.configure(dir, { name: name.value.trim(), onEnd: onEnd.value })
    : await series.create(dir, name.value.trim(), onEnd.value);
  if (ok) open.value = false;
}
</script>

<style scoped>
.pm-series-form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}

.pm-series-form__help {
  margin: 0;
  font-size: 12px;
  color: var(--lj-text-muted);
}
</style>
