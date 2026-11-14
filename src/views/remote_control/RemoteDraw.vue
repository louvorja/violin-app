<template>
  <div class="rd-root">
    <div class="rd-toolbar">
      <LjTabs
        :model-value="state.mode"
        :tabs="modeTabs"
        :aria-label="tm('ribbon.mode')"
        :disabled="busy || state.animating"
        @update:model-value="onModeChange"
      />
      <span class="lj-u-spacer" />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        :icon="ICONS.ACTIONS.REFRESH"
        :title="t('remote_control.sync.refresh')"
        :disabled="busy"
        @click="refresh"
      />
      <LjButton
        size="sm"
        variant="ghost"
        icon-only
        :icon="ICONS.ACTIONS.RESTART"
        :title="tm('actions.reset')"
        :disabled="busy || state.animating"
        @click="showReset = true"
      />
    </div>

    <div class="rd-result">
      <span class="rd-result__label">{{ tm("data.result") }}</span>
      <strong
        class="rd-result__value"
        :class="{ 'rd-result__value--name': state.mode === 'names' }"
      >
        {{ state.animating ? tm("actions.drawing") : state.current || "—" }}
      </strong>
      <span class="rd-result__meta">
        {{ tm("data.remaining_count", { left: state.remaining, total: state.total }) }}
      </span>
    </div>

    <!-- Números: o intervalo é a configuração do sorteio. -->
    <div v-if="state.mode === 'number'" class="rd-section">
      <span class="rd-section__label">{{ tm("data.range") }}</span>
      <div class="rd-range">
        <LjField :label="tm('inputs.min')">
          <LjInput
            v-model="rangeMinDraft"
            type="number"
            inputmode="numeric"
            :disabled="busy || state.animating"
          />
        </LjField>
        <LjField :label="tm('inputs.max')">
          <LjInput
            v-model="rangeMaxDraft"
            type="number"
            inputmode="numeric"
            :disabled="busy || state.animating"
          />
        </LjField>
        <LjButton
          size="sm"
          variant="subtle"
          :icon="ICONS.UI.CHECK"
          :disabled="busy || state.animating || !rangeDirty"
          @click="applyRange"
        >
          {{ tm("actions.apply") }}
        </LjButton>
      </div>
    </div>

    <!-- Nomes: adiciona, remove e mostra quem já saiu. -->
    <div v-else class="rd-section rd-section--names">
      <span class="rd-section__label">{{ tm("data.names") }}</span>
      <div class="rd-add">
        <LjInput
          v-model="nameDraft"
          :placeholder="tm('inputs.name_placeholder')"
          :disabled="busy || state.animating"
          @keydown.enter.prevent="addName"
        />
        <LjButton
          size="sm"
          variant="primary"
          :icon="ICONS.ACTIONS.ADD"
          :disabled="busy || state.animating || !nameDraft.trim()"
          @click="addName"
        >
          {{ tm("actions.add") }}
        </LjButton>
      </div>

      <div class="rd-names" role="list">
        <div
          v-for="name in state.names"
          :key="name"
          class="rd-name"
          :class="{ 'rd-name--drawn': isDrawn(name) }"
          role="listitem"
        >
          <LjIcon
            :icon="isDrawn(name) ? ICONS.UI.CHECK_CIRCLE : ICONS.UI.CIRCLE_OUTLINE"
            :size="16"
            class="rd-name__check"
          />
          <span class="rd-name__text">{{ name }}</span>
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.CLOSE"
            :title="tm('actions.remove')"
            :disabled="busy || state.animating"
            @click="removeName(name)"
          />
        </div>
        <p v-if="!state.names.length" class="rd-empty">{{ tm("data.no_options") }}</p>
      </div>
    </div>

    <div v-if="state.drawn.length" class="rd-drawn">
      <span class="rd-section__label">{{ tm("data.drawn") }}</span>
      <div class="rd-chips">
        <span
          v-for="(value, index) in state.drawn.slice(-16)"
          :key="`${value}-${index}`"
          class="rd-chip"
        >
          {{ value }}
        </span>
      </div>
    </div>

    <div class="rd-footer">
      <LjButton
        variant="primary"
        size="touch"
        block
        :icon="ICONS.SORT.DICE"
        :loading="busy || state.animating"
        :disabled="!state.canDraw || state.animating || busy"
        @click="drawNow"
      >
        {{ state.animating ? tm("actions.drawing") : tm("actions.draw") }}
      </LjButton>
      <LjButton
        size="touch"
        variant="subtle"
        block
        :icon="state.projecting ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.SCREEN"
        :disabled="busy"
        @click="showProjectionConfirm = true"
      >
        {{ state.projecting ? tm("projection.stop") : tm("projection.project") }}
      </LjButton>
    </div>

    <LjDialog
      v-model="showReset"
      :title="tm('confirm.reset_title')"
      :description="tm('confirm.reset_text')"
      :icon="ICONS.ACTIONS.RESTART"
      icon-variant="warning"
      size="sm"
    >
      <template #footer>
        <LjButton size="sm" variant="subtle" @click="showReset = false">
          {{ t("actions.cancel") }}
        </LjButton>
        <LjButton size="sm" variant="danger" :icon="ICONS.ACTIONS.RESTART" @click="resetDraw">
          {{ tm("actions.reset") }}
        </LjButton>
      </template>
    </LjDialog>

    <LjDialog
      v-model="showProjectionConfirm"
      :title="state.projecting ? tm('projection.stop_title') : tm('projection.project_title')"
      :description="state.projecting ? tm('projection.stop_text') : tm('projection.project_text')"
      :icon="state.projecting ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.SCREEN"
      :icon-variant="state.projecting ? 'danger' : 'info'"
      size="sm"
    >
      <template #footer>
        <LjButton size="sm" variant="subtle" @click="showProjectionConfirm = false">
          {{ t("actions.cancel") }}
        </LjButton>
        <LjButton
          size="sm"
          :variant="state.projecting ? 'danger' : 'primary'"
          :icon="state.projecting ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.SCREEN"
          @click="changeProjection()"
        >
          {{ state.projecting ? tm("projection.stop") : tm("projection.project") }}
        </LjButton>
      </template>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { LjButton, LjDialog, LjField, LjIcon, LjInput, LjTabs } from "@/components/ui";
import type { LjTab } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";

interface DrawState {
  status: string;
  mode: "number" | "names";
  names: string[];
  range: { min: number; max: number };
  current: string | null;
  drawn: string[];
  total: number;
  remaining: number;
  animating: boolean;
  running: boolean;
  canDraw: boolean;
  projecting: boolean;
}

const props = defineProps<{ token?: string }>();
const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t, tm } = useModuleI18n("draw");

const emptyState = (): DrawState => ({
  status: "ok",
  mode: "number",
  names: [],
  range: { min: 1, max: 100 },
  current: null,
  drawn: [],
  total: 100,
  remaining: 100,
  animating: false,
  running: false,
  canDraw: false,
  projecting: false,
});

const state = ref<DrawState>(emptyState());
// `true` até o primeiro `GET /api/draw`: sem isto o botão "Sortear" nasce
// habilitado e um toque no primeiro frame sorteia com o intervalo padrão.
const busy = ref(true);
const nameDraft = ref("");
const rangeMinDraft = ref("1");
const rangeMaxDraft = ref("100");
const showReset = ref(false);
const showProjectionConfirm = ref(false);

const modeTabs = computed<LjTab[]>(() => [
  { value: "number", label: tm("modes.numbers") },
  { value: "names", label: tm("modes.names") },
]);

const rangeDirty = computed(
  () =>
    Number(rangeMinDraft.value) !== state.value.range.min ||
    Number(rangeMaxDraft.value) !== state.value.range.max
);

const isDrawn = (name: string): boolean => state.value.drawn.includes(name);

function syncRangeDrafts(): void {
  rangeMinDraft.value = String(state.value.range.min);
  rangeMaxDraft.value = String(state.value.range.max);
}

function isDrawState(value: unknown): value is { status: "ok"; state: DrawState } {
  if (!value || typeof value !== "object") return false;
  const payload = value as { status?: unknown; state?: Partial<DrawState> };
  const next = payload.state;
  return (
    payload.status === "ok" &&
    !!next &&
    (next.mode === "number" || next.mode === "names") &&
    Array.isArray(next.names) &&
    Array.isArray(next.drawn) &&
    !!next.range &&
    typeof next.range.min === "number" &&
    typeof next.range.max === "number" &&
    typeof next.total === "number" &&
    typeof next.remaining === "number" &&
    typeof next.animating === "boolean" &&
    typeof next.canDraw === "boolean" &&
    typeof next.projecting === "boolean"
  );
}

async function request(action: string, body: Record<string, unknown> = {}): Promise<boolean> {
  busy.value = true;
  try {
    const res = await postApi("/api/draw", { action, ...body }, props.token);
    if (!res.ok) {
      emit(
        "show-snackbar",
        await httpErrorMessage(res, t("remote_control.errors.generic")),
        "error"
      );
      return false;
    }
    const data = await res.json();
    if (!isDrawState(data)) {
      emit("show-snackbar", t("remote_control.errors.generic"), "error");
      return false;
    }
    state.value = data.state;
    syncRangeDrafts();
    return true;
  } catch {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
    return false;
  } finally {
    busy.value = false;
  }
}

let projectionPoll: ReturnType<typeof setInterval> | null = null;

/** Atualiza só `projecting` para refletir um fechamento feito no desktop. */
async function refreshProjectionOnly(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  try {
    const url = `/api/draw${props.token ? `?token=${props.token}` : ""}`;
    const res = await apiFetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!isDrawState(data)) return;
    if (data.state.projecting !== state.value.projecting) {
      state.value = { ...state.value, projecting: data.state.projecting };
    }
  } catch {
    /* silencioso: é só sincronização do botão */
  }
}

async function refresh(): Promise<void> {
  const url = `/api/draw${props.token ? `?token=${props.token}` : ""}`;
  busy.value = true;
  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      emit(
        "show-snackbar",
        await httpErrorMessage(res, t("remote_control.errors.generic")),
        "error"
      );
      return;
    }
    const data = await res.json();
    if (isDrawState(data)) {
      state.value = data.state;
      syncRangeDrafts();
    }
  } catch {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    busy.value = false;
  }
}

async function onModeChange(mode: string): Promise<void> {
  if (mode === state.value.mode) return;
  if (await request("set-mode", { mode })) {
    emit("show-snackbar", tm("status.mode_updated"));
  }
}

async function applyRange(): Promise<void> {
  const min = Number(rangeMinDraft.value);
  const max = Number(rangeMaxDraft.value);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    emit("show-snackbar", tm("data.invalid_range"), "error");
    return;
  }
  if (await request("set-range", { min, max })) {
    emit("show-snackbar", tm("status.range_updated"));
  }
}

async function addName(): Promise<void> {
  const name = nameDraft.value.trim();
  if (!name) return;
  if (await request("add-name", { name })) {
    nameDraft.value = "";
    emit("show-snackbar", tm("status.name_added"));
  }
}

async function removeName(name: string): Promise<void> {
  if (await request("remove-name", { name })) {
    emit("show-snackbar", tm("status.name_removed"));
  }
}

async function waitForDraw(): Promise<void> {
  // `draw` responde na hora com `animating: true`; o efeito pode durar até 60 s.
  for (let attempt = 0; attempt < 220; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const url = `/api/draw${props.token ? `?token=${props.token}` : ""}`;
    try {
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (!isDrawState(data)) return;
      state.value = data.state;
      if (!data.state.animating) {
        if (data.state.current) {
          emit("show-snackbar", tm("data.drawn_now", { value: data.state.current }));
        }
        return;
      }
    } catch {
      return;
    }
  }
}

async function drawNow(): Promise<void> {
  if (busy.value || state.value.animating || !state.value.canDraw) return;
  const started = await request("draw");
  if (!started) return;
  busy.value = true;
  try {
    await waitForDraw();
  } finally {
    busy.value = false;
  }
}

async function changeProjection(): Promise<void> {
  showProjectionConfirm.value = false;
  const active = !state.value.projecting;
  if (!(await request("set-projection", { active }))) return;
  if (state.value.projecting === active) {
    emit("show-snackbar", tm(active ? "projection.projected" : "projection.closed"));
  } else {
    emit("show-snackbar", tm("projection.failed"), "error");
  }
}

async function resetDraw(): Promise<void> {
  showReset.value = false;
  if (await request("reset")) {
    emit("show-snackbar", tm("confirm.reset_done"));
  }
}

// A aba fica montada (v-show): o estado precisa acompanhar mudanças feitas
// pelo desktop ou por outro controle remoto ao voltar para cá.
watch(() => state.value.range, syncRangeDrafts);

onMounted(() => {
  void refresh();
  projectionPoll = setInterval(() => void refreshProjectionOnly(), 2_000);
});

onUnmounted(() => {
  if (projectionPoll) clearInterval(projectionPoll);
  projectionPoll = null;
});

defineExpose({ refresh });
</script>

<style scoped>
.rd-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  height: 100%;
  padding: var(--lj-space-4);
  min-height: 0;
}

.rd-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}

.rd-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-1);
  min-height: 132px;
  padding: var(--lj-space-4);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg-soft);
  text-align: center;
}

.rd-result__label,
.rd-section__label {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.rd-result__value {
  font-size: clamp(2.5rem, 14vw, 5rem);
  font-weight: var(--lj-weight-medium);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.rd-result__value--name {
  font-size: clamp(1.6rem, 9vw, 3.5rem);
}

.rd-result__meta {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.rd-section {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}

.rd-section--names {
  min-height: 0;
  flex: 1;
}

.rd-range {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--lj-space-2);
}

.rd-add {
  display: flex;
  gap: var(--lj-space-2);
}

.rd-add :deep(.lj-input) {
  flex: 1;
  min-width: 0;
}

.rd-names {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  overflow-y: auto;
  min-height: 80px;
}

.rd-name {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-1) var(--lj-space-2);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
}

.rd-name--drawn {
  opacity: 0.6;
}

.rd-name--drawn .rd-name__text {
  text-decoration: line-through;
}

.rd-name__check {
  color: var(--lj-ui-accent);
  flex-shrink: 0;
}

.rd-name__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rd-empty {
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

.rd-drawn {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  flex-shrink: 0;
}

.rd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-1);
}

.rd-chip {
  padding: 2px var(--lj-space-2);
  border-radius: 999px;
  background: var(--lj-ui-accent-soft, var(--lj-surface-bg-active));
  color: var(--lj-text);
  font-size: var(--lj-text-sm);
}

.rd-footer {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  flex-shrink: 0;
  padding-top: var(--lj-space-2);
  border-top: 1px solid var(--lj-surface-border);
}
</style>
