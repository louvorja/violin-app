<template>
  <div class="pm-row-wrap">
    <LjContextMenu :items="menu">
      <div
        class="pm-row"
        :class="{
          'pm-row--live': live,
          'pm-row--next': (next || prepared) && !live,
          'pm-row--selected': selected && !live,
        }"
        role="button"
        tabindex="0"
        :data-testid="`pm-item-${item.id}`"
        @click="emit('select')"
        @dblclick="emit('activate')"
        @keydown.enter.self.prevent="emit('activate')"
      >
        <span class="pm-row__time">{{ start }}</span>
        <button
          v-if="hasChildren"
          type="button"
          class="pm-row__chevron"
          :aria-expanded="open"
          :aria-label="tm(open ? 'program.collapse' : 'program.expand')"
          @click.stop="emit('toggle')"
          @dblclick.stop
        >
          <LjIcon :icon="open ? ICONS.UI.CHEVRON_DOWN : ICONS.UI.CHEVRON_RIGHT" :size="13" />
        </button>
        <LjIcon :icon="KIND_ICONS[item.kind]" :size="15" class="pm-row__icon" />
        <div class="pm-row__text">
          <span class="pm-row__title">{{ item.title || tm("program.untitled") }}</span>
          <span v-if="item.subtitle" class="pm-row__subtitle">{{ item.subtitle }}</span>
        </div>
        <span v-if="live" class="pm-live-badge">
          <span class="pm-live-badge__dot" />{{ tm("program.live") }}
        </span>
        <span v-else-if="prepared" class="pm-queued-badge">{{ tm("program.queued") }}</span>
        <LjIcon
          v-else-if="done"
          :icon="ICONS.UI.CHECK"
          :size="13"
          class="pm-row__done"
          :aria-label="tm('program.done')"
        />
        <span class="pm-row__duration">{{ formatDuration(item.plannedMinutes) }}</span>
        <button
          type="button"
          class="pm-row__edit"
          :title="tm('program.edit_item')"
          :aria-label="tm('program.edit_item')"
          @click.stop="emit('edit')"
          @dblclick.stop
        >
          <LjIcon :icon="ICONS.ACTIONS.EDIT_OUTLINE" :size="12" />
        </button>
      </div>
    </LjContextMenu>

    <ol v-if="hasChildren && open" class="pm-subitems">
      <li v-for="(child, i) in item.children" :key="child.id" class="pm-subitem">
        <span class="pm-subitem__n">{{ i + 1 }}</span>
        <span class="pm-subitem__thumb" />
        <span class="pm-subitem__title">{{ child.title }}</span>
        <span v-if="child.seconds" class="pm-subitem__duration">
          {{ formatDuration(child.seconds / 60) }}
        </span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjContextMenu, LjIcon, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { KIND_ICONS } from "../program/kinds";
import { formatDuration } from "../program/time";

const props = defineProps<{
  item: ProgramItem;
  start: string;
  live: boolean;
  next: boolean;
  done: boolean;
  /** Na fila: enviado com a saída travada, vai ao ar quando destravar. */
  prepared: boolean;
  selected: boolean;
  open: boolean;
  menu: LjMenuItem[];
}>();

const emit = defineEmits<{
  select: [];
  activate: [];
  toggle: [];
  edit: [];
}>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const hasChildren = computed(() => (props.item.children?.length ?? 0) > 0);
</script>

<style scoped>
.pm-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 9px;
  border-bottom: 1px solid var(--lj-surface-divider);
  border-left: 3px solid transparent;
  cursor: pointer;
  user-select: none;
  transition:
    background 120ms var(--lj-ease),
    box-shadow 200ms var(--lj-ease);
}

.pm-row:hover {
  background: var(--lj-hover-bg);
}

.pm-row:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-row--live {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-row--live:hover {
  background: var(--lj-live-active-bg);
}

.pm-row--next {
  border-left-color: var(--lj-navy-active);
}

.pm-row--selected {
  box-shadow: inset 0 0 0 1px var(--lj-navy-active);
}

.pm-row__time {
  width: 30px;
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  font-variant-numeric: tabular-nums;
}

.pm-row__chevron,
.pm-row__edit {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-row__chevron {
  width: 14px;
  height: 18px;
  margin: 0 -4px 0 -3px;
}

.pm-row__edit {
  width: 18px;
  height: 18px;
  opacity: 0;
  transition: opacity 120ms var(--lj-ease);
}

.pm-row:hover .pm-row__edit,
.pm-row__edit:focus-visible {
  opacity: 1;
}

.pm-row__chevron:hover,
.pm-row__edit:hover {
  background: var(--lj-hover-bg);
  color: var(--lj-text);
}

.pm-row__icon {
  flex-shrink: 0;
  color: var(--lj-text-muted);
}

.pm-row__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.pm-row__title {
  font-size: 12px;
  color: var(--lj-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-row__subtitle {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-row__done {
  flex-shrink: 0;
  color: var(--lj-success);
}

.pm-row__duration {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-queued-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border: 1px solid var(--lj-navy-active);
  border-radius: 3px;
  color: var(--lj-text);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-live-badge__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lj-white);
  animation: pm-live-pulse 1.6s infinite;
}

@keyframes pm-live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.pm-subitems {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 5px 8px 7px 39px;
  list-style: none;
  background: var(--lj-live-sunken-bg);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.pm-subitem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px;
  border-radius: 3px;
  background: var(--lj-hover-bg);
  font-size: 11px;
}

.pm-subitem__n {
  width: 12px;
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}

.pm-subitem__thumb {
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--lj-live-stage-bg);
}

.pm-subitem__title {
  flex: 1;
  min-width: 0;
  color: var(--lj-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-subitem__duration {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}
</style>
