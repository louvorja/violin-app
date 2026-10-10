<template>
  <div class="pm-row-wrap">
    <LjContextMenu v-bind="menu">
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
          v-if="expandable"
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
          <span v-if="item.subtitle || folderSummary" class="pm-row__subtitle">
            {{ item.subtitle || folderSummary }}
          </span>
        </div>
        <span
          v-if="askMode"
          class="pm-ask-badge"
          :title="tm('music_modes.ask_hint')"
          data-testid="pm-row-ask"
        >
          {{ tm("music_modes.ask_badge") }}
        </span>
        <span v-if="live" class="pm-live-badge">
          <span class="pm-live-badge__dot" />
          {{ tm("program.live") }}
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

    <draggable
      v-if="hasChildren && open"
      :model-value="item.children ?? []"
      item-key="id"
      tag="ol"
      class="pm-subitems"
      :disabled="item.kind !== 'moment'"
      :animation="150"
      ghost-class="pm-subitem--ghost"
      @update:model-value="(list: ProgramSubItem[]) => emit('children', list)"
    >
      <template #item="{ element: child, index: i }">
        <li
          class="pm-subitem"
          :class="{ 'pm-subitem--live': child.id === liveChildId }"
          role="button"
          tabindex="0"
          :title="child.title"
          :data-testid="`pm-child-${child.title}`"
          @click="emit('child-preview', child.id)"
          @dblclick="emit('child-play', child.id)"
          @keydown.enter.self="emit('child-play', child.id)"
        >
          <span class="pm-subitem__n">{{ i + 1 }}</span>
          <span class="pm-subitem__thumb">
            <img v-if="child.path && thumbOf(child.path)" :src="thumbOf(child.path)" alt="" />
            <LjIcon v-else :icon="KIND_ICONS[(child as ProgramSubItem).kind]" :size="11" />
          </span>
          <span class="pm-subitem__title">{{ child.title }}</span>
          <span v-if="child.seconds" class="pm-subitem__duration">
            {{ formatDuration(child.seconds / 60) }}
          </span>
          <button
            v-if="item.kind === 'moment'"
            type="button"
            class="pm-subitem__remove"
            :title="tm('moment.remove')"
            :aria-label="tm('moment.remove')"
            @click.stop="
              emit(
                'children',
                (item.children ?? []).filter((c) => c.id !== child.id)
              )
            "
            @dblclick.stop
          >
            <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="10" />
          </button>
        </li>
      </template>
    </draggable>
    <p v-else-if="open && item.kind === 'moment'" class="pm-subitems pm-subitems--empty">
      {{ tm("moment.empty") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjContextMenu, LjIcon, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import draggable from "vuedraggable";
import type { ProgramItem, ProgramSubItem } from "@/types/Presentation";
import { useMediaMeta } from "../composables/useMediaMeta";
import { useFolderItems } from "../composables/useFolderItems";
import { needsModeChoice } from "../program/musicModes";
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
  /** Ações rápidas em cima e o resto embaixo (ver LjContextMenu). */
  menu: { quick: LjMenuItem[]; items: LjMenuItem[] };
  /** O filho deste item que está no ar (momento). */
  liveChildId?: string | null;
}>();

const emit = defineEmits<{
  select: [];
  activate: [];
  toggle: [];
  edit: [];
  "child-preview": [childId: string];
  "child-play": [childId: string];
  /** Momento: nova lista de filhos (reordenada ou com um removido). */
  children: [list: ProgramSubItem[]];
}>();

const { thumbOf } = useMediaMeta();

/** Música com a versão em aberto: o operador escolhe ao mandar ao ar. */
const askMode = computed(() => needsModeChoice(props.item));

/** Pasta: quantos arquivos, ou o próximo da série — lido da pasta na hora. */
const folders = useFolderItems();
const folderSummary = computed(() => {
  if (props.item.kind !== "folder" || !props.item.folder) return "";
  const summary = folders.summaryOf(props.item.folder);
  if (!summary) return "";
  if (summary.isSeries) {
    return summary.next
      ? tm("folder.next", { name: summary.next.replace(/\.[^.]+$/, "") })
      : tm("folder.series_done");
  }
  return tm("folder.count", { n: summary.count });
});

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const hasChildren = computed(() => (props.item.children?.length ?? 0) > 0);
// Momento recém-criado (vazio) também abre: a linha explica como adicionar arquivos.
const expandable = computed(() => hasChildren.value || props.item.kind === "moment");
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
  border-left-color: var(--lj-live-select);
}

.pm-row--selected {
  box-shadow: inset 0 0 0 1px var(--lj-live-select);
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

.pm-ask-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--lj-ui-accent);
  border-radius: 2px;
  color: var(--lj-ui-accent);
  font-size: 9.5px;
  font-weight: 700;
  white-space: nowrap;
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
  border: 1px solid var(--lj-live-select);
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 2px;
  background: var(--lj-live-stage-bg);
  color: var(--lj-white-alpha-50);
}

.pm-subitem__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pm-subitem {
  cursor: pointer;
}

.pm-subitem:hover {
  background: var(--lj-live-active-bg);
}

.pm-subitem:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-subitem--live {
  box-shadow: inset 3px 0 0 var(--lj-orange);
  font-weight: var(--lj-weight-semibold);
}

.pm-subitem--ghost {
  opacity: 0.5;
}

.pm-subitem__remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-subitem:hover .pm-subitem__remove,
.pm-subitem__remove:focus-visible {
  display: flex;
}

.pm-subitems--empty {
  font-size: 11px;
  color: var(--lj-text-subtle);
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
