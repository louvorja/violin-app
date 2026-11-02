<template>
  <div class="pm-nohist" data-testid="pm-no-program">
    <div class="pm-nohist__card">
      <span class="pm-nohist__title">
        {{ isToday ? tm("history.no_program_today") : tm("history.no_program_day") }}
      </span>
      <span class="pm-nohist__hint">{{ tm("history.no_program_hint") }}</span>
      <div class="pm-nohist__actions">
        <LjButton
          size="sm"
          :icon="ICONS.ACTIONS.ADD"
          data-testid="pm-program-build"
          @click="emit('build')"
        >
          {{ tm("history.build") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="ghost"
          :icon="ICONS.LITURGY.SCRIPT"
          data-testid="pm-program-from-model"
          @click="emit('model')"
        >
          {{ tm("models.use") }}
        </LjButton>
      </div>
    </div>

    <template v-if="isToday">
      <header class="pm-nohist__head">
        <span class="pm-nohist__cap">{{ tm("history.title") }}</span>
        <span class="pm-nohist__count">{{ countLabel }}</span>
      </header>
      <p v-if="!entries.length" class="pm-nohist__empty">{{ tm("history.empty") }}</p>
      <ol v-else class="pm-nohist__list" data-testid="pm-history-list">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="pm-nohist__row"
          :class="{ 'pm-nohist__row--live': entry.id === liveId }"
          :data-testid="`pm-history-${entry.id}`"
        >
          <span class="pm-nohist__time">{{ timeOf(entry.at) }}</span>
          <LjIcon :icon="historyIcon(entry.playable)" :size="15" class="pm-nohist__icon" />
          <span class="pm-nohist__text">
            <span class="pm-nohist__name">{{ historyTitle(entry.playable) }}</span>
            <span v-if="historySubtitle(entry.playable)" class="pm-nohist__sub">
              {{ historySubtitle(entry.playable) }}
            </span>
          </span>
          <span v-if="entry.id === liveId" class="pm-nohist__live">
            <span class="pm-nohist__dot" />
            {{ tm("program.live") }}
          </span>
          <LjButton
            v-else
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.REFRESH"
            :title="tm('history.again')"
            :aria-label="tm('history.again')"
            :data-testid="`pm-history-again-${entry.id}`"
            @click="emit('replay', entry)"
          />
        </li>
      </ol>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { historyIcon, historySubtitle, historyTitle, type HistoryEntry } from "../program/history";

/**
 * A coluna do programa num dia sem programa: o convite para montar um (ou
 * usar um modelo) e "Já passou hoje" — o que foi ao ar direto da biblioteca,
 * para apresentar de novo. O módulo funciona igual com ou sem programa.
 */

const props = defineProps<{
  entries: readonly HistoryEntry[];
  /** A linha que está no ar agora. */
  liveId: string | null;
  /** O programa aberto é o de hoje: o histórico é só de hoje. */
  isToday: boolean;
}>();

const emit = defineEmits<{ build: []; model: []; replay: [entry: HistoryEntry] }>();

const { t, locale, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.program.items_count`, props.entries.length)
);

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
</script>

<style scoped>
.pm-nohist {
  display: flex;
  flex-direction: column;
}

.pm-nohist__card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px;
  padding: 10px;
  border: 1px dashed var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-md);
}

.pm-nohist__title {
  font-weight: var(--lj-weight-semibold);
}

.pm-nohist__hint {
  font-size: 11px;
  color: var(--lj-text-muted);
}

.pm-nohist__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pm-nohist__head {
  display: flex;
  align-items: center;
  padding: 6px 8px 4px;
  border-block: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}

.pm-nohist__cap {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--lj-text-subtle);
}

.pm-nohist__count {
  margin-left: auto;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}

.pm-nohist__empty {
  margin: 0;
  padding: 10px 8px;
  font-size: 11px;
  color: var(--lj-text-subtle);
}

.pm-nohist__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.pm-nohist__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 2px 6px 2px 8px;
  border-bottom: 1px solid var(--lj-surface-border);
  border-left: 3px solid transparent;
}

.pm-nohist__row--live {
  border-left-color: var(--lj-orange);
  background: var(--lj-live-active-bg);
}

.pm-nohist__time {
  width: 34px;
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-nohist__icon {
  flex-shrink: 0;
  color: var(--lj-text-muted);
}

.pm-nohist__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pm-nohist__name,
.pm-nohist__sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-nohist__sub {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-nohist__live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-nohist__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lj-white);
}
</style>
