<template>
  <LjDialog
    v-model="open"
    :title="tm('readiness.title')"
    :icon="ICONS.PLAYER.PLAYLIST_CHECK"
    size="md"
  >
    <div class="pm-ready" data-testid="pm-readiness">
      <p v-if="state.checking && !state.checkedAt" class="pm-ready__lead">
        {{ tm("readiness.checking") }}
      </p>
      <p v-else-if="!problems" class="pm-ready__ok" data-testid="pm-readiness-ok">
        <LjIcon :icon="ICONS.UI.CHECK_CIRCLE" :size="18" />
        {{ tm("readiness.all_ok") }}
      </p>

      <section
        v-for="group in groups"
        :key="group.key"
        class="pm-ready__group"
        :data-testid="`pm-readiness-${group.key}`"
      >
        <header class="pm-ready__head">
          <LjIcon :icon="group.icon" :size="14" />
          <span>{{ tm(`readiness.${group.key}`, { n: group.rows.length }) }}</span>
        </header>
        <p class="pm-ready__hint">{{ tm(`readiness.${group.key}_hint`) }}</p>
        <ul class="pm-ready__list">
          <li v-for="row in group.rows.slice(0, 8)" :key="row.key" class="pm-ready__row">
            <span class="pm-ready__name" :title="row.title">{{ row.label }}</span>
            <LjButton
              v-if="row.itemId"
              size="sm"
              variant="ghost"
              :data-testid="`pm-readiness-edit-${row.itemId}`"
              @click="edit(row.itemId)"
            >
              {{ tm("readiness.choose") }}
            </LjButton>
          </li>
          <li v-if="group.rows.length > 8" class="pm-ready__more">
            {{ tm("readiness.more", { n: group.rows.length - 8 }) }}
          </li>
        </ul>
      </section>

      <p v-if="state.noFolder" class="pm-ready__note">{{ tm("readiness.no_folder") }}</p>
    </div>

    <template #footer>
      <LjButton :icon="ICONS.ACTIONS.REFRESH" :disabled="state.checking" @click="recheck">
        {{ tm("readiness.recheck") }}
      </LjButton>
      <LjButton
        variant="primary"
        :icon="ICONS.ACTIONS.CLOUD_DOWNLOAD"
        :loading="state.preparing"
        :disabled="!downloadable || state.checking"
        data-testid="pm-readiness-prepare"
        @click="prepareAll"
      >
        {{ tm("readiness.prepare", { n: downloadable }) }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { LjButton, LjDialog, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useProgram } from "../composables/useProgram";
import { useReadiness } from "../composables/useReadiness";

/**
 * "Pronto para o culto": o operador entende em segundos se pode começar —
 * e "Preparar tudo" baixa hinos e arquivos da nuvem antes de precisar deles.
 */

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; edit: [itemId: string] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const program = useProgram();
const { state, problems, check, prepare } = useReadiness();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

watch(
  () => props.modelValue,
  (value) => {
    if (value) void check(program.program.value);
  }
);

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

interface Row {
  key: string;
  label: string;
  title: string;
  itemId?: string;
}

const groups = computed(() => {
  const all: { key: string; icon: string; rows: Row[] }[] = [
    {
      key: "pending",
      icon: ICONS.UI.ALERT,
      rows: state.pending.map((i) => ({ key: i.id, label: i.title, title: i.title, itemId: i.id })),
    },
    {
      key: "songs",
      icon: ICONS.MUSIC.MUSIC,
      rows: state.songs.map((s) => ({
        key: s.remote,
        label: s.item.source?.item || s.item.title,
        title: s.remote,
      })),
    },
    {
      key: "cloud",
      icon: ICONS.ACTIONS.CLOUD_DOWNLOAD,
      rows: state.cloud.map((p) => ({ key: p, label: baseName(p), title: p })),
    },
    {
      key: "missing",
      icon: ICONS.UI.FOLDER_OFF,
      rows: state.missing.map((p) => ({ key: p, label: baseName(p), title: p })),
    },
    {
      key: "empty",
      icon: ICONS.UI.FOLDER_OPEN,
      rows: state.empty.map((i) => ({ key: i.id, label: i.title, title: i.folder ?? "" })),
    },
    {
      key: "outside",
      icon: ICONS.UI.FOLDER_OFF,
      rows: state.outside.map((p) => ({ key: p, label: baseName(p), title: p })),
    },
  ];
  return all.filter((g) => g.rows.length);
});

const downloadable = computed(() => state.songs.length + state.cloud.length);

function recheck(): void {
  void check(program.program.value);
}

function prepareAll(): void {
  void prepare(program.program.value, tm("readiness.task"));
}

function edit(itemId: string): void {
  open.value = false;
  emit("edit", itemId);
}
</script>

<style scoped>
.pm-ready {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}

.pm-ready__lead,
.pm-ready__note,
.pm-ready__hint {
  margin: 0;
  color: var(--lj-text-muted);
}

.pm-ready__hint,
.pm-ready__note {
  font-size: var(--lj-text-sm);
}

.pm-ready__ok {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  margin: 0;
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-success);
}

.pm-ready__group {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.pm-ready__head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  font-weight: var(--lj-weight-semibold);
}

.pm-ready__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pm-ready__row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-height: 26px;
  padding-left: 22px;
}

.pm-ready__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pm-ready__more {
  padding-left: 22px;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-subtle);
}
</style>
