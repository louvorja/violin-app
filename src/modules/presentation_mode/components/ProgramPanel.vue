<template>
  <aside class="pm-program" data-testid="pm-program">
    <header class="pm-program__head">
      <LjIcon :icon="ICONS.LITURGY.SCRIPT" :size="14" class="pm-program__accent" />
      <span class="pm-program__title">{{ tm("panels.program") }}</span>
      <LjPopover :title="tm('program.date')" align="end">
        <template #trigger>
          <button
            type="button"
            class="pm-program__date"
            :title="tm('program.change_date')"
            data-testid="pm-program-date"
          >
            {{ dateLabel }}
          </button>
        </template>
        <div class="pm-program__date-form">
          <LjInput
            type="date"
            size="sm"
            :model-value="date"
            :aria-label="tm('program.date')"
            @update:model-value="onDate"
          />
          <LjButton size="sm" :disabled="isToday" @click="onDate(todayIso())">
            {{ tm("program.today") }}
          </LjButton>
        </div>
      </LjPopover>
      <button
        type="button"
        class="pm-program__icon-btn"
        :title="tm('program.settings')"
        :aria-label="tm('program.settings')"
        data-testid="pm-program-settings"
        @click="emit('settings')"
      >
        <LjIcon :icon="ICONS.ACTIONS.EDIT_OUTLINE" :size="13" />
      </button>
    </header>

    <section class="pm-clock">
      <div class="pm-clock__row">
        <div class="pm-clock__col">
          <span class="pm-clock__label">{{ tm("program.now") }}</span>
          <span class="pm-clock__now">{{ nowLabel }}</span>
        </div>
        <div class="pm-clock__col pm-clock__col--end">
          <span class="pm-clock__label">{{ tm("program.forecast_end") }}</span>
          <span class="pm-clock__end">
            <span :class="{ 'pm-clock__end--late': fc.status === 'late' }">
              {{ formatHHMM(fc.forecastEnd) }}
            </span>
            <span class="pm-clock__planned"> / {{ formatHHMM(fc.plannedEnd) }}</span>
          </span>
        </div>
      </div>
      <div class="pm-clock__row pm-clock__row--center">
        <span class="pm-delta" :class="`pm-delta--${fc.status}`" data-testid="pm-delta">
          <LjIcon
            v-if="fc.status !== 'on_time'"
            :icon="fc.status === 'late' ? ICONS.UI.TRENDING_DOWN : ICONS.UI.TRENDING_UP"
            :size="12"
          />
          {{ deltaLabel }}
        </span>
        <span v-if="liveStartedLabel" class="pm-clock__hint">
          {{ tm("program.live_started", { time: liveStartedLabel }) }}
        </span>
      </div>
      <div class="pm-progress" role="presentation">
        <span class="pm-progress__done" :style="{ width: `${progress.done}%` }" />
        <span class="pm-progress__live" :style="{ width: `${progress.live}%` }" />
      </div>
    </section>

    <div class="pm-program__list" data-testid="pm-program-list">
      <div v-if="!program.sessions.length" class="pm-program__empty">
        <LjEmpty :icon="ICONS.LITURGY.SCRIPT" :title="tm('empty.program')">
          <LjButton size="sm" :icon="ICONS.ACTIONS.IMPORT" @click="emit('import')">
            {{ tm("ribbon.btn.import_liturgy") }}
          </LjButton>
          <LjButton size="sm" :icon="ICONS.ACTIONS.ADD" @click="emit('new-item')">
            {{ tm("ribbon.btn.new_item") }}
          </LjButton>
        </LjEmpty>
      </div>

      <section v-for="session in program.sessions" :key="session.id" class="pm-session">
        <header class="pm-session__head" @dblclick="emit('edit-session', session.id)">
          <span class="pm-session__label">{{ session.label }}</span>
          <button
            type="button"
            class="pm-program__icon-btn pm-session__edit"
            :title="tm('program.edit_session')"
            :aria-label="tm('program.edit_session')"
            @click="emit('edit-session', session.id)"
          >
            <LjIcon :icon="ICONS.ACTIONS.EDIT_OUTLINE" :size="11" />
          </button>
          <span class="pm-session__meta">
            {{ formatHHMM(sessionStartMap.get(session.id) ?? 0) }} ·
            {{ formatDuration(sessionMinutes(program, session.id)) }}
          </span>
        </header>
        <draggable
          :model-value="session.items"
          item-key="id"
          group="pm-program-items"
          tag="div"
          class="pm-session__items"
          :animation="150"
          ghost-class="pm-drag-ghost"
          @update:model-value="(list: ProgramItem[]) => onSessionItems(session.id, list)"
        >
          <template #item="{ element }">
            <ProgramItemRow
              :item="element"
              :start="formatHHMM(itemStartMap.get(element.id) ?? 0)"
              :live="element.id === liveItemId"
              :next="element.id === nextItemId"
              :done="doneIds.has(element.id)"
              :prepared="element.id === preparedItemId"
              :selected="element.id === selectedItemId"
              :open="!!openItems[element.id]"
              :menu="itemMenu(element)"
              @select="onSelect(element.id)"
              @activate="emit('activate', element.id)"
              @toggle="toggleOpen(element.id)"
              @edit="emit('edit-item', element.id)"
            />
          </template>
        </draggable>
      </section>

      <!-- O resto da lista é "parte vazia": o botão direito ali cria itens. -->
      <LjContextMenu :items="addMenu">
        <div class="pm-program__filler" data-testid="pm-program-filler" />
      </LjContextMenu>
    </div>

    <LjMenu :items="addMenu" side="top" align="end">
      <template #trigger>
        <button
          type="button"
          class="pm-program__fab"
          :aria-label="tm('program.add')"
          :title="tm('program.add')"
          data-testid="pm-program-fab"
        >
          <LjIcon :icon="ICONS.ACTIONS.ADD" :size="20" />
        </button>
      </template>
    </LjMenu>

    <footer class="pm-program__foot">
      <span>{{ countsLabel }}</span>
      <span class="pm-program__total">{{ formatDuration(totalMinutes(program)) }}</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import draggable from "vuedraggable";
import {
  LjButton,
  LjContextMenu,
  LjEmpty,
  LjIcon,
  LjInput,
  LjMenu,
  LjPopover,
  type LjMenuItem,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import ProgramItemRow from "./ProgramItemRow.vue";
import { todayIso, useProgram } from "../composables/useProgram";
import {
  forecast,
  formatDuration,
  formatHHMM,
  minutesOfDate,
  plannedStarts,
  sessionMinutes,
  sessionStarts,
  totalMinutes,
} from "../program/time";

const emit = defineEmits<{
  activate: [itemId: string];
  /** Um clique: o item vai para a prévia do palco. */
  preview: [itemId: string];
  "edit-item": [itemId: string];
  "edit-session": [sessionId: string];
  "new-item": [];
  "new-session": [];
  "duplicate-item": [itemId: string];
  "remove-item": [itemId: string];
  import: [];
  settings: [];
}>();

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const {
  date,
  program,
  items,
  selectedItemId,
  liveItemId,
  liveStartedAt,
  doneIds,
  openItems,
  nextItemId,
  preparedItemId,
  setDate,
  setSessions,
  select,
  toggleOpen,
} = useProgram();

const now = ref(new Date());
let clock: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  clock = setInterval(() => (now.value = new Date()), 1000);
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
});

const isToday = computed(() => date.value === todayIso(now.value));

const dateLabel = computed(() => {
  const [y, m, d] = date.value.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const weekday = day.toLocaleDateString(locale.value, { weekday: "short" }).replace(".", "");
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
});

function onDate(value: string | number | null): void {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) void setDate(value);
}

const nowLabel = computed(() =>
  now.value.toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
);

const itemStartMap = computed(() => plannedStarts(program.value));
const sessionStartMap = computed(() => sessionStarts(program.value));

const fc = computed(() =>
  forecast(program.value, {
    // Só o programa de hoje corre contra o relógio.
    now: isToday.value ? minutesOfDate(now.value) : null,
    liveItemId: liveItemId.value,
    liveStartedAt: liveStartedAt.value,
    doneIds: doneIds.value,
  })
);

const deltaLabel = computed(() => {
  const minutes = Math.round(Math.abs(fc.value.deltaMinutes));
  if (fc.value.status === "late") return tm("program.late", { minutes });
  if (fc.value.status === "early") return tm("program.early", { minutes });
  return tm("program.on_time");
});

const liveStartedLabel = computed(() =>
  liveStartedAt.value === null ? "" : formatHHMM(liveStartedAt.value)
);

const progress = computed(() => {
  const total = totalMinutes(program.value);
  if (!total) return { done: 0, live: 0 };
  const done = items.value
    .filter((i) => doneIds.value.has(i.id))
    .reduce((sum, i) => sum + (i.plannedMinutes || 0), 0);
  const live = items.value.find((i) => i.id === liveItemId.value)?.plannedMinutes ?? 0;
  return { done: (done / total) * 100, live: (live / total) * 100 };
});

const countsLabel = computed(() => {
  const prefix = `modules.${ModuleEnum.PRESENTATION_MODE}.program`;
  return `${t(`${prefix}.sessions_count`, program.value.sessions.length)} · ${t(
    `${prefix}.items_count`,
    items.value.length
  )}`;
});

/** "+" flutuante e botão direito na parte vazia da lista. */
const addMenu = computed<LjMenuItem[]>(() => [
  { label: tm("ribbon.btn.new_item"), icon: ICONS.ACTIONS.ADD, action: () => emit("new-item") },
  { label: tm("ribbon.btn.new_session"), icon: ICONS.ACTIONS.ADD_BOX, action: () => emit("new-session") },
  { separator: true },
  { label: tm("ribbon.btn.import_liturgy"), icon: ICONS.ACTIONS.IMPORT, action: () => emit("import") },
]);

function itemMenu(item: ProgramItem): LjMenuItem[] {
  return [
    { label: tm("library.preview"), icon: ICONS.UI.EYE, action: () => onSelect(item.id) },
    { label: tm("library.play"), icon: ICONS.PLAYER.PLAY, action: () => emit("activate", item.id) },
    { separator: true },
    { label: tm("program.edit_item"), icon: ICONS.ACTIONS.EDIT_OUTLINE, action: () => emit("edit-item", item.id) },
    { label: tm("ribbon.btn.duplicate"), icon: ICONS.ACTIONS.DUPLICATE, action: () => emit("duplicate-item", item.id) },
    { label: tm("ribbon.btn.delete_item"), icon: ICONS.ACTIONS.DELETE, action: () => emit("remove-item", item.id) },
  ];
}

function onSelect(itemId: string): void {
  select(itemId);
  emit("preview", itemId);
}

function onSessionItems(sessionId: string, list: ProgramItem[]): void {
  setSessions(program.value.sessions.map((s) => (s.id === sessionId ? { ...s, items: list } : s)));
}
</script>

<style scoped>
.pm-program {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--lj-surface-bg);
  border-right: 1px solid var(--lj-surface-border);
}

.pm-program__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-program__accent {
  color: var(--lj-orange);
}

.pm-program__title {
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
}

.pm-program__date {
  margin-left: auto;
  padding: 1px 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  cursor: pointer;
}

.pm-program__date:hover {
  background: var(--lj-hover-bg);
  color: var(--lj-text);
}

.pm-program__date-form {
  display: flex;
  gap: var(--lj-space-3);
  align-items: center;
}

.pm-program__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-program__icon-btn:hover {
  background: var(--lj-hover-bg);
  color: var(--lj-text);
}

.pm-clock {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-clock__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.pm-clock__row--center {
  align-items: center;
  gap: 6px;
}

.pm-clock__col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pm-clock__col--end {
  margin-left: auto;
  text-align: right;
}

.pm-clock__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
}

.pm-clock__now {
  font-family: var(--lj-font-mono);
  font-size: 22px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text);
}

.pm-clock__end {
  font-family: var(--lj-font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text);
}

.pm-clock__end--late {
  color: var(--lj-live-late-text);
}

.pm-clock__planned {
  color: var(--lj-text-subtle);
}

.pm-clock__hint {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-delta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--lj-text-muted);
  transition:
    background 200ms var(--lj-ease),
    color 200ms var(--lj-ease);
}

.pm-delta--late {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger-border);
  color: var(--lj-live-late-text);
}

.pm-delta--early {
  background: var(--lj-success-soft);
  border-color: var(--lj-live-early-border);
  color: var(--lj-live-early-text);
}

.pm-progress {
  display: flex;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--lj-surface-border);
}

.pm-progress__done {
  background: var(--lj-navy-active);
  transition: width 200ms var(--lj-ease);
}

.pm-progress__live {
  background: var(--lj-orange);
  transition: width 200ms var(--lj-ease);
}

.pm-program__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Espaço para o "+" não cobrir o último item. */
.pm-program__filler {
  flex: 1;
  min-height: 64px;
}

.pm-program__fab {
  position: absolute;
  right: 12px;
  bottom: 36px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 2px solid var(--lj-orange);
  border-radius: 50%;
  background: var(--lj-surface-bg);
  color: var(--lj-orange);
  box-shadow: 0 2px 8px var(--lj-black-alpha-30);
  cursor: pointer;
  transition:
    background 120ms var(--lj-ease),
    color 120ms var(--lj-ease);
}

.pm-program__fab:hover,
.pm-program__fab[data-state="open"] {
  background: var(--lj-orange);
  color: var(--lj-white);
}

.pm-program__fab:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-program__empty {
  padding: var(--lj-space-4);
}

.pm-session__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 4px;
  background: var(--lj-surface-bg-soft);
  border-top: 1px solid var(--lj-surface-border);
  border-bottom: 1px solid var(--lj-surface-border);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--lj-text-subtle);
}

.pm-session__label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-session__edit {
  width: 16px;
  height: 16px;
  opacity: 0;
}

.pm-session__head:hover .pm-session__edit,
.pm-session__edit:focus-visible {
  opacity: 1;
}

.pm-session__meta {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

/* Sessão vazia continua recebendo item arrastado. */
.pm-session__items {
  min-height: 6px;
}

.pm-session__items :deep(.pm-drag-ghost) {
  opacity: 0.5;
}

.pm-program__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-top: 1px solid var(--lj-surface-border);
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-program__total {
  margin-left: auto;
  font-family: var(--lj-font-mono);
}
</style>
