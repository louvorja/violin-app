<template>
  <LjDialog v-model="open" :title="tm('sync.conflict_title')" :icon="ICONS.UI.ALERT" size="md">
    <p class="pm-conflict__lead">{{ tm("sync.conflict_text") }}</p>
    <p v-if="loading" class="pm-conflict__lead">{{ tm("library.loading") }}</p>
    <ul v-else class="pm-conflict" data-testid="pm-conflict-list">
      <li v-for="v in versions" :key="v.key" class="pm-conflict__row">
        <div class="pm-conflict__text">
          <span class="pm-conflict__title">{{ titleOf(v.key) }}</span>
          <span class="pm-conflict__meta">{{ metaOf(v) }}</span>
        </div>
        <LjButton
          size="sm"
          :variant="v.key === 'main' ? 'primary' : 'default'"
          :disabled="busy"
          :data-testid="`pm-conflict-keep-${v.key}`"
          @click="keep(v.key)"
        >
          {{ tm("sync.keep") }}
        </LjButton>
      </li>
    </ul>
    <template #footer>
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { pendingItems } from "../program/models";
import {
  conflictVersions,
  resolveConflict,
  type ProgramVersion,
} from "../composables/programStore";
import { useProgram } from "../composables/useProgram";

/**
 * Duas versões do mesmo programa: este computador editou enquanto outro
 * salvou, ou o OneDrive criou cópias em conflito. O operador escolhe a que
 * vale; as outras somem.
 */

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const program = useProgram();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const versions = ref<ProgramVersion[]>([]);
const loading = ref(false);
const busy = ref(false);

watch(
  () => props.modelValue,
  async (value) => {
    if (!value) return;
    loading.value = true;
    versions.value = await conflictVersions(program.program.value);
    loading.value = false;
  }
);

function titleOf(key: string): string {
  if (key === "local") return tm("sync.version_local");
  if (key === "main") return tm("sync.version_main");
  return tm("sync.version_copy", { file: key });
}

function metaOf(v: ProgramVersion): string {
  const items = v.program.sessions.reduce((n, s) => n + s.items.length, 0);
  const when = v.savedAt
    ? new Date(v.savedAt).toLocaleString(locale.value, { dateStyle: "short", timeStyle: "short" })
    : "";
  return [v.savedBy, when, tm("sync.items", { n: items, pending: pendingItems(v.program).length })]
    .filter(Boolean)
    .join(" · ");
}

async function keep(key: string): Promise<void> {
  busy.value = true;
  const chosen = await resolveConflict(key, program.program.value);
  busy.value = false;
  if (!chosen) {
    $snackbar.error(tm("sync.resolve_failed"));
    return;
  }
  program.replaceProgram(chosen);
  Telemetry.track("presentation_church_conflict_resolved", {
    kept: key === "local" || key === "main" ? key : "copy",
  });
  open.value = false;
}
</script>

<style scoped>
.pm-conflict__lead {
  margin: 0 0 var(--lj-space-5);
  color: var(--lj-text-muted);
}

.pm-conflict {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pm-conflict__row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-3) var(--lj-space-4);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
}

.pm-conflict__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.pm-conflict__title {
  font-weight: var(--lj-weight-semibold);
}

.pm-conflict__meta {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
