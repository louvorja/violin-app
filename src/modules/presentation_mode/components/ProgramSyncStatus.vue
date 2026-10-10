<template>
  <button
    v-if="sync.state !== 'local'"
    type="button"
    class="pm-sync"
    :class="`pm-sync--${tone}`"
    :title="title"
    data-testid="pm-sync-status"
    :data-state="sync.state"
    @click="onClick"
  >
    <LjIcon :icon="icon" :size="12" />
    <span class="pm-sync__label">{{ label }}</span>
  </button>
  <ProgramConflictDialog v-model="conflictOpen" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import ProgramConflictDialog from "./ProgramConflictDialog.vue";
import { sync } from "../composables/programStore";
import { useProgram } from "../composables/useProgram";

/**
 * O programa está salvo na pasta da igreja? Foi atualizado por outro
 * computador? Há duas versões? Discreto no cabeçalho do programa; em conflito,
 * abre a escolha da versão. Sem pasta da igreja, não aparece.
 *
 * Também é quem confere a pasta de tempos em tempos (e ao voltar para o app),
 * enquanto o programa está à vista.
 */

const CHECK_MS = 10_000;
const FRESH_MS = 15_000;

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const program = useProgram();

const now = ref(Date.now());
const conflictOpen = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;
const check = () => {
  now.value = Date.now();
  void program.syncFromChurch();
};
onMounted(() => {
  timer = setInterval(check, CHECK_MS);
  window.addEventListener("focus", check);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("focus", check);
});

const fresh = computed(() => sync.externalAt > 0 && now.value - sync.externalAt < FRESH_MS);

const time = computed(() =>
  sync.savedAt
    ? new Date(sync.savedAt).toLocaleTimeString(locale.value, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""
);

const tone = computed(() => {
  if (sync.state === "conflict" || sync.state === "error") return "danger";
  if (sync.state === "unavailable") return "warn";
  return fresh.value ? "fresh" : "ok";
});

const icon = computed(() => {
  if (sync.state === "conflict" || sync.state === "error") return ICONS.UI.ALERT;
  if (sync.state === "unavailable") return ICONS.UI.FOLDER_OFF;
  if (sync.state === "saving") return ICONS.UI.SYNC;
  return ICONS.UI.SYNC_CLOUD;
});

const label = computed(() => {
  switch (sync.state) {
    case "saving":
      return tm("sync.saving");
    case "conflict":
      return tm("sync.conflict");
    case "unavailable":
      return tm("sync.unavailable");
    case "error":
      return tm("sync.error");
    default:
      return fresh.value
        ? tm("sync.updated")
        : time.value
          ? tm("sync.saved_at", { time: time.value })
          : tm("sync.saved");
  }
});

const title = computed(() =>
  sync.savedBy
    ? tm("sync.saved_by", { who: sync.savedBy, time: time.value })
    : tm("sync.folder_hint")
);

function onClick(): void {
  if (sync.state === "conflict") conflictOpen.value = true;
  else check();
}
</script>

<style scoped>
.pm-sync {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 150px;
  padding: 1px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-subtle);
  font-size: 10.5px;
  cursor: pointer;
}

.pm-sync__label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pm-sync--fresh {
  color: var(--lj-text);
  border-color: var(--lj-live-select);
}

.pm-sync--warn {
  color: var(--lj-danger);
}

.pm-sync--danger {
  color: var(--lj-danger);
  border-color: var(--lj-danger);
}
</style>
