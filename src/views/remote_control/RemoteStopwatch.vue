<template>
  <div class="rsw-root">
    <div class="rsw-display" :data-alert="state.alert || 'none'">
      <LjIcon :icon="ICONS.MODULES.STOPWATCH" :size="22" class="rsw-display__icon" />
      <span class="rsw-display__time">{{ display }}</span>
      <span class="rsw-display__state">
        {{
          state.running
            ? t("remote_control.stopwatch.running")
            : t("remote_control.stopwatch.stopped")
        }}
      </span>
      <span v-if="state.mode === 'countdown'" class="rsw-display__target">
        {{ t("remote_control.stopwatch.goal") }} {{ formatTime(state.target || 0) }}
      </span>
    </div>

    <div class="rsw-section">
      <LjTabs
        :model-value="state.mode"
        :tabs="modeTabs"
        :aria-label="t('remote_control.stopwatch.mode')"
        @update:model-value="changeMode"
      />

      <div v-if="state.mode === 'countdown'" class="rsw-target">
        <LjInput
          v-model="targetDraft"
          :placeholder="t('remote_control.stopwatch.target_hint')"
          :aria-label="t('remote_control.stopwatch.target')"
          inputmode="numeric"
        />
        <LjButton size="sm" variant="primary" :disabled="busy" @click="applyTarget">
          {{ t("remote_control.stopwatch.apply") }}
        </LjButton>
      </div>

      <div v-if="state.mode === 'countdown'" class="rsw-extend">
        <LjButton
          size="sm"
          variant="subtle"
          :icon="ICONS.ACTIONS.ADD"
          :disabled="busy"
          @click="extendTarget"
        >
          {{ t("remote_control.stopwatch.add_minute") }}
        </LjButton>
      </div>

      <div class="rsw-presets">
        <LjButton
          v-for="min in PRESETS"
          :key="min"
          size="sm"
          :variant="isPreset(min) ? 'primary' : 'subtle'"
          :disabled="busy"
          @click="applyPreset(min)"
        >
          {{ t("remote_control.stopwatch.minutes", { n: min }) }}
        </LjButton>
      </div>
    </div>

    <div class="rsw-actions">
      <LjButton
        variant="primary"
        size="touch"
        :icon="state.running ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
        :disabled="busy"
        @click="toggle"
      >
        {{
          state.running ? t("remote_control.stopwatch.pause") : t("remote_control.stopwatch.start")
        }}
      </LjButton>
      <LjButton
        size="touch"
        :icon="ICONS.CATEGORY.FLAG"
        :disabled="busy || (!state.running && state.elapsed <= 0)"
        @click="lap"
      >
        {{ t("remote_control.stopwatch.lap") }}
      </LjButton>
      <LjButton
        variant="danger"
        size="touch"
        :icon="ICONS.ACTIONS.RESTART"
        :disabled="busy"
        @click="showReset = true"
      >
        {{ t("remote_control.stopwatch.reset") }}
      </LjButton>
    </div>

    <LjButton
      :variant="state.projecting ? 'danger' : 'default'"
      :icon="state.projecting ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.SCREEN"
      :disabled="busy"
      @click="toggleProjection"
    >
      {{
        state.projecting
          ? t("remote_control.stopwatch.unproject")
          : t("remote_control.stopwatch.project")
      }}
    </LjButton>

    <div class="rsw-laps">
      <span class="rsw-laps__title">{{ t("remote_control.stopwatch.laps") }}</span>
      <ol v-if="lapsNewestFirst.length" class="rsw-laps__list">
        <li v-for="item in lapsNewestFirst" :key="item.index" class="rsw-laps__row">
          <span class="rsw-laps__index">#{{ item.index }}</span>
          <span class="rsw-laps__time">{{ formatTime(item.shown) }}</span>
        </li>
      </ol>
      <p v-else class="rsw-laps__empty">{{ t("remote_control.stopwatch.no_laps") }}</p>
    </div>

    <LjDialog
      v-model="showReset"
      :title="t('remote_control.stopwatch.reset_title')"
      :description="t('remote_control.stopwatch.reset_text')"
      :icon="ICONS.ACTIONS.RESTART"
      icon-variant="danger"
      size="sm"
    >
      <template #footer>
        <LjButton size="sm" variant="subtle" @click="showReset = false">
          {{ t("actions.cancel") }}
        </LjButton>
        <LjButton size="sm" variant="danger" :icon="ICONS.ACTIONS.RESTART" @click="reset">
          {{ t("remote_control.stopwatch.reset") }}
        </LjButton>
      </template>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjDialog, LjIcon, LjInput, LjTabs } from "@/components/ui";
import type { LjTab } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  formatStopwatchTarget as formatTarget,
  parseStopwatchTarget as parseTarget,
} from "./stopwatchTarget";

/**
 * Cronômetro no controle remoto: mesmo estado do módulo do desktop (o tempo é
 * do desktop, não local). SSE mantém a tela viva; o GET inicial/polling cobre
 * um replay perdido.
 */
const props = withDefaults(defineProps<{ token?: string; active?: boolean }>(), { active: true });

const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t } = useI18n();

interface StopwatchLap {
  index: number;
  elapsed: number;
  shown: number;
}

interface StopwatchState {
  running: boolean;
  mode: "countup" | "countdown";
  elapsed: number;
  target: number | null;
  remaining: number | null;
  alert: "" | "warning" | "danger";
  overtime: boolean;
  showSeconds: boolean;
  warningSeconds: number;
  laps: StopwatchLap[];
  projecting: boolean;
  seq: number;
}

const EMPTY: StopwatchState = {
  running: false,
  mode: "countup",
  elapsed: 0,
  target: null,
  remaining: null,
  alert: "",
  overtime: true,
  showSeconds: true,
  warningSeconds: 60,
  laps: [],
  projecting: false,
  seq: 0,
};

const PRESETS = [5, 10, 15, 30];

const state = ref<StopwatchState>({ ...EMPTY });
const busy = ref(false);
const showReset = ref(false);
const targetDraft = ref("00:05:00");
let lastSeq = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const modeTabs = computed<LjTab[]>(() => [
  { value: "countup", label: t("remote_control.stopwatch.countup") },
  { value: "countdown", label: t("remote_control.stopwatch.countdown") },
]);

const lapsNewestFirst = computed(() => [...state.value.laps].reverse());

const displaySeconds = computed(() =>
  state.value.mode === "countdown" ? (state.value.remaining ?? 0) : state.value.elapsed
);

const display = computed(() => formatTime(displaySeconds.value));

function formatTime(seconds: number): string {
  const value = Number(seconds) || 0;
  const sign = value < 0 ? "-" : "";
  const total = Math.abs(Math.trunc(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${sign}${h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`}`;
}

function applyState(next: StopwatchState | null | undefined): void {
  if (!next || typeof next !== "object") return;
  const seq = Number(next.seq) || 0;
  if (seq && lastSeq && seq < lastSeq) return;
  if (seq) lastSeq = seq;
  state.value = { ...EMPTY, ...next, laps: Array.isArray(next.laps) ? next.laps : [] };
}

async function load(): Promise<void> {
  try {
    const url = `/api/stopwatch${props.token ? `?token=${props.token}` : ""}`;
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error(await httpErrorMessage(res, t("remote_control.errors.generic")));
    }
    const data = await res.json();
    if (data?.status === "ok") applyState(data.state);
  } catch (error) {
    void error;
  }
}

function reportError(message: unknown): void {
  emit("show-snackbar", String(message || t("remote_control.errors.generic")), "error");
}

async function command(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    const res = await postApi("/api/stopwatch", { action, ...extra }, props.token);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.status === "error") {
      reportError(
        data?.message ||
          data?.error ||
          (await httpErrorMessage(res, t("remote_control.errors.generic")))
      );
      return false;
    }
    applyState(data?.state);
    return true;
  } catch (error) {
    reportError(error instanceof Error ? error.message : t("remote_control.errors.generic"));
    return false;
  } finally {
    busy.value = false;
  }
}

function toggle(): void {
  void command(state.value.running ? "pause" : "start");
}

function lap(): void {
  void command("lap");
}

function reset(): void {
  showReset.value = false;
  void command("reset");
}

function toggleProjection(): void {
  void command(state.value.projecting ? "unproject" : "project");
}

function isPreset(min: number): boolean {
  return state.value.mode === "countdown" && Math.round(state.value.target || 0) === min * 60;
}

function applyPreset(min: number): void {
  targetDraft.value = formatTarget(min * 60);
  void command("set-mode", { mode: "countdown", target: min * 60 });
}

function applyTarget(): void {
  const target = parseTarget(targetDraft.value);
  if (target == null) {
    reportError(t("remote_control.stopwatch.invalid_target"));
    return;
  }
  void command("set-target", { target });
}

function extendTarget(): void {
  void command("extend-target", { seconds: 60 });
}

function changeMode(value: string | number): void {
  const mode = value === "countdown" ? "countdown" : "countup";
  if (mode === state.value.mode) return;
  if (mode === "countup") {
    void command("set-mode", { mode: "countup" });
    return;
  }
  const target = parseTarget(targetDraft.value) || Math.round(state.value.target || 0) || 300;
  void command("set-mode", { mode: "countdown", target });
}

watch(
  () => [state.value.mode, state.value.target] as const,
  ([mode, target]) => {
    if (mode === "countdown" && target != null) {
      targetDraft.value = formatTarget(target);
    }
  },
  { immediate: true }
);

useBroadcastListener(BROADCAST_TYPE.STOPWATCH_STATE, (payload: unknown) => {
  applyState(payload as StopwatchState);
});

watch(
  () => props.active,
  (active) => {
    if (active && document.visibilityState === "visible") void load();
  }
);

onMounted(() => {
  void load();
  pollTimer = setInterval(() => {
    // A aba fica montada com `v-show`: sem o `active`, o polling continuaria
    // rodando em segundo plano mesmo com o operador em outra tela.
    if (props.active && document.visibilityState === "visible") void load();
  }, 1000);
});

// O botão de sincronizar do controle remoto chama isto na aba Cronômetro.
defineExpose({ refresh: load });

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
});
</script>

<style scoped>
.rsw-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

.rsw-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-1);
  padding: var(--lj-space-5) var(--lj-space-4);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
}

.rsw-display__icon {
  color: var(--lj-ui-accent);
}

.rsw-display__time {
  color: var(--lj-text-primary);
  font-size: 2.5rem;
  font-weight: var(--lj-weight-semibold, 600);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.rsw-display__state {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}

.rsw-display__target {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-variant-numeric: tabular-nums;
}

.rsw-display[data-alert="warning"] .rsw-display__time {
  color: #f59e0b;
}

.rsw-display[data-alert="danger"] .rsw-display__time {
  color: #ef4444;
}

.rsw-section {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
}

.rsw-target {
  display: flex;
  gap: var(--lj-space-2);
  align-items: center;
}

.rsw-presets,
.rsw-extend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.rsw-actions {
  display: flex;
  gap: var(--lj-space-3);
}

.rsw-actions > * {
  flex: 1;
}

.rsw-laps {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.rsw-laps__title {
  color: var(--lj-text-primary);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold, 600);
}

.rsw-laps__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
}

.rsw-laps__row {
  display: flex;
  justify-content: space-between;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-active);
}

.rsw-laps__index {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-variant-numeric: tabular-nums;
}

.rsw-laps__time {
  color: var(--lj-text-primary);
  font-size: var(--lj-text-sm);
  font-variant-numeric: tabular-nums;
}

.rsw-laps__empty {
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}
</style>
