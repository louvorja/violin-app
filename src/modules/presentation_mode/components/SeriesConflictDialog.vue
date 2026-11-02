<template>
  <LjDialog
    v-model="open"
    :title="tm('series.conflict_title')"
    :icon="ICONS.UI.ALERT"
    icon-variant="warning"
    size="md"
  >
    <p class="pm-conflict__help">{{ tm("series.conflict_help") }}</p>
    <ul class="pm-conflict__list" data-testid="pm-series-conflicts">
      <li v-for="v in versions" :key="v.name" class="pm-conflict__item">
        <div class="pm-conflict__info">
          <strong class="pm-conflict__source">{{ sourceLabel(v) }}</strong>
          <span>{{ tm("series.conflict_modified", { date: dateTime(v.modifiedAt) }) }}</span>
          <span>{{ tm("series.conflict_plays", { count: v.plays }) }}</span>
          <span v-if="v.lastPlay" class="pm-conflict__last">
            {{
              tm("series.conflict_last", { file: v.lastPlay.file, date: dateTime(v.lastPlay.at) })
            }}
          </span>
        </div>
        <LjButton
          size="sm"
          :disabled="busy"
          :data-testid="`pm-series-use-${v.name}`"
          @click="choose(v.name)"
        >
          {{ tm("series.conflict_use") }}
        </LjButton>
      </li>
    </ul>
    <template #footer>
      <LjButton :disabled="busy" @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton
        variant="primary"
        :loading="busy"
        data-testid="pm-series-merge"
        @click="choose('merge')"
      >
        {{ tm("series.conflict_merge") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { LjButton, LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { SeriesVersion } from "@/types/Series";
import { useSeries } from "../composables/useSeries";

/**
 * Dois computadores gravaram o histórico antes de a pasta na nuvem sincronizar,
 * e o sincronizador guardou as duas versões. Como os saves da Steam: cada versão com a data e o
 * que tem, para o operador escolher — ou juntar todas, que não perde nada.
 */

const props = defineProps<{ dir: string; versions: SeriesVersion[] }>();
const open = defineModel<boolean>({ required: true });

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const series = useSeries();
const busy = ref(false);

/** O sincronizador costuma pôr o nome do computador na cópia: ".louvorja-serie-IGREJA-PC.json" → "IGREJA-PC". */
function sourceLabel(v: SeriesVersion): string {
  const name = v.name;
  if (v.main) return tm("series.conflict_main");
  return name.replace(/^\.louvorja-serie[-\s]*/i, "").replace(/\.json$/i, "") || name;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function choose(choice: string): Promise<void> {
  busy.value = true;
  try {
    if (await series.resolve(props.dir, choice)) open.value = false;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pm-conflict__help {
  margin: 0 0 var(--lj-space-5);
  font-size: 12px;
  color: var(--lj-text-muted);
}

.pm-conflict__list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pm-conflict__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-4) var(--lj-space-5);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.pm-conflict__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--lj-text-muted);
}

.pm-conflict__source {
  font-size: 13px;
  color: var(--lj-text);
}

.pm-conflict__last {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
