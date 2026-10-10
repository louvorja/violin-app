<template>
  <div
    v-if="conflicts.length"
    class="pm-series pm-series--conflict"
    data-testid="pm-series-conflict"
  >
    <LjIcon :icon="ICONS.UI.ALERT" :size="15" class="pm-series__icon" />
    <span class="pm-series__next">
      {{ tm("series.conflict_bar", { count: conflicts.length }) }}
    </span>
    <LjButton
      size="sm"
      variant="primary"
      data-testid="pm-series-conflict-open"
      @click="conflictOpen = true"
    >
      {{ tm("series.conflict_review") }}
    </LjButton>
  </div>
  <div
    v-else-if="doc && progress"
    class="pm-series"
    :class="{ 'pm-series--done': progress.completed }"
    data-testid="pm-series-bar"
  >
    <LjIcon :icon="ICONS.MEDIA.PLAYLIST" :size="15" class="pm-series__icon" />
    <span class="pm-series__name">{{ doc.name }}</span>
    <span class="pm-series__count" data-testid="pm-series-count">
      {{ tm("series.count", { played: progress.played, total: progress.total }) }}
    </span>
    <template v-if="progress.completed">
      <span class="pm-series__done" data-testid="pm-series-done">{{ tm("series.done") }}</span>
      <LjButton
        size="sm"
        :icon="ICONS.ACTIONS.RESTART"
        data-testid="pm-series-restart"
        @click="series.restart(dir)"
      >
        {{ tm("series.restart") }}
      </LjButton>
    </template>
    <template v-else-if="progress.next">
      <span class="pm-series__next" :title="progress.next">
        {{ tm("series.next") }}
        <strong data-testid="pm-series-next">{{ progress.next }}</strong>
      </span>
      <LjButton
        size="sm"
        variant="ghost"
        :icon="ICONS.UI.EYE"
        @click="emit('preview', progress.next)"
      >
        {{ tm("series.show") }}
      </LjButton>
      <LjButton
        size="sm"
        variant="primary"
        :icon="ICONS.PLAYER.PLAY"
        data-testid="pm-series-send"
        @click="emit('play', progress.next)"
      >
        {{ tm("series.send") }}
      </LjButton>
    </template>
    <LjMenu :items="menu" align="end">
      <template #trigger>
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.DOTS_VERTICAL"
          :title="tm('series.options')"
        />
      </template>
    </LjMenu>
  </div>

  <SeriesConflictDialog
    v-if="conflicts.length"
    v-model="conflictOpen"
    :dir="dir"
    :versions="conflicts"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton, LjIcon, LjMenu, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { SeriesDoc } from "@/types/Series";
import type { SeriesProgress } from "../program/series";
import { useSeries } from "../composables/useSeries";
import SeriesConflictDialog from "./SeriesConflictDialog.vue";

/**
 * A pasta aberta como série: quantos já passaram, qual é o próximo e o botão
 * de mandá-lo ao ar. Recomeçar sozinho no fim é regra do main, aplicada ao
 * registrar o último vídeo — esta barra só mostra e pede.
 */

const props = defineProps<{
  dir: string;
  doc: SeriesDoc | null;
  progress: SeriesProgress | null;
}>();
const emit = defineEmits<{ preview: [file: string]; play: [file: string] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const alertKey = (key: string) => `modules.${ModuleEnum.PRESENTATION_MODE}.${key}`;
const series = useSeries();

const conflicts = computed(() => series.conflictsOf(props.dir));
const conflictOpen = ref(false);

const menu = computed<LjMenuItem[]>(() => [
  {
    label: tm("series.edit"),
    icon: ICONS.ACTIONS.EDIT,
    action: () => series.openDialog(props.dir),
  },
  {
    label: tm("series.restart"),
    icon: ICONS.ACTIONS.RESTART,
    action: () =>
      $alert.yesno(
        { title: alertKey("series.restart"), text: alertKey("series.restart_confirm") },
        (resp?: string) => {
          if (resp === "yes") void series.restart(props.dir);
        }
      ),
  },
  { separator: true },
  {
    label: tm("series.disable"),
    icon: ICONS.ACTIONS.CLOSE,
    action: () => void series.disable(props.dir),
  },
]);
</script>

<style scoped>
.pm-series {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
  background: var(--lj-live-active-bg);
  font-size: 12px;
}

.pm-series--conflict {
  background: color-mix(in srgb, var(--lj-warning) 18%, var(--lj-surface-bg));
}

.pm-series--conflict .pm-series__icon {
  color: var(--lj-warning);
}

.pm-series--done {
  background: var(--lj-surface-bg-soft);
}

.pm-series__icon {
  flex-shrink: 0;
  color: var(--lj-orange);
}

.pm-series__name {
  flex-shrink: 0;
  font-weight: var(--lj-weight-semibold);
}

.pm-series__count {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 11px;
  color: var(--lj-text-subtle);
}

.pm-series__next,
.pm-series__done {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-series__done {
  color: var(--lj-text-muted);
}
</style>
