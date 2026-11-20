<template>
  <span v-if="church.supported" class="pm-sync__row">
    <!-- Sem pasta da igreja: o convite para usar uma, que é onde ela se configura. -->
    <button
      v-if="sync.state === 'local'"
      type="button"
      class="pm-sync"
      :title="tm('church.hint_off')"
      data-testid="pm-sync-status"
      data-state="local"
      @click="emit('configure')"
    >
      <LjIcon :icon="ICONS.UI.FOLDER_OFF" :size="12" />
      <span class="pm-sync__label">{{ tm("sync.local") }}</span>
      <span class="pm-sync__cta">{{ tm("sync.use_church") }}</span>
    </button>
    <button
      v-else
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
    <button
      v-if="sync.state !== 'local'"
      type="button"
      class="pm-sync pm-sync--icon"
      :title="tm('church.configure')"
      :aria-label="tm('church.configure')"
      data-testid="pm-church-configure"
      @click="emit('configure')"
    >
      <LjIcon :icon="ICONS.UI.FOLDER_COG" :size="13" />
    </button>
  </span>
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
import { useChurchFolder } from "../composables/useChurchFolder";
import Platform from "@/helpers/Platform";

/**
 * O programa está salvo na pasta da igreja? Foi atualizado por outro
 * computador? Há duas versões? Discreto no cabeçalho do programa. O clique
 * abre a pasta dos programas no Finder/Explorer (em conflito, a escolha da
 * versão), e o ícone ao lado leva à configuração da pasta da igreja. Sem
 * pasta, a linha convida a usar uma.
 *
 * Também é quem confere a pasta de tempos em tempos (e ao voltar para o app),
 * enquanto o programa está à vista.
 */

const CHECK_MS = 10_000;
const FRESH_MS = 15_000;

const emit = defineEmits<{ configure: [] }>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const program = useProgram();
const church = useChurchFolder();

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

const title = computed(() => {
  const where = sync.savedBy
    ? tm("sync.saved_by", { who: sync.savedBy, time: time.value })
    : tm("sync.folder_hint");
  return sync.state === "conflict" ? where : `${where} · ${tm("sync.open_folder")}`;
});

/** O arquivo do programa do dia na pasta da igreja (`LouvorJA/programas/AAAA-MM-DD.json`). */
function programFile(root: string): { file: string; dir: string } {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const dir = [root.replace(/[\\/]+$/, ""), "LouvorJA", "programas"].join(sep);
  return { file: `${dir}${sep}${program.date.value}.json`, dir };
}

/** Clique: em conflito, a escolha da versão; senão, a pasta dos programas, com o do dia selecionado. */
async function onClick(): Promise<void> {
  if (sync.state === "conflict") {
    conflictOpen.value = true;
    return;
  }
  check();
  const root = church.root.value;
  if (!root) return;
  const { file, dir } = programFile(root);
  for (const target of [file, dir, root]) {
    const res = (await Platform.revealFile(target).catch(() => null)) as { ok?: boolean } | null;
    if (res?.ok) return;
  }
}
</script>

<style scoped>
.pm-sync {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 1px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-subtle);
  font-size: 10.5px;
  cursor: pointer;
}

.pm-sync__row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.pm-sync:hover {
  border-color: var(--lj-surface-border);
  color: var(--lj-text);
}

.pm-sync--icon {
  padding: 1px 3px;
}

.pm-sync__cta {
  color: var(--lj-ui-accent-text, var(--lj-orange));
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
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
