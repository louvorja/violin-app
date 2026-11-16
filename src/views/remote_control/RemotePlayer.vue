<template>
  <div class="rp-root">
    <div v-if="!state.active" class="rp-empty">
      <LjIcon :icon="ICONS.PLAYER.PLAY" :size="48" class="lj-u-faded" />
      <p class="rp-empty__text">{{ t("remote_control.player.nothing") }}</p>
    </div>

    <template v-else>
      <div class="rp-now">
        <div class="rp-now__text">
          <div class="rp-now__title-row">
            <span class="rp-now__title">{{ title }}</span>
            <span v-if="labelOnTitle" class="rp-now__source">· {{ sourceLabel }}</span>
          </div>
          <span v-if="state.subtitle" class="rp-now__subtitle">{{ state.subtitle }}</span>
          <span class="rp-now__meta">
            <template v-if="state.source === 'youtube'">{{ sourceLabel }} ·</template>
            {{
              state.loading
                ? t("components.ui.loading")
                : t(
                    state.playing ? "remote_control.player.playing" : "remote_control.player.paused"
                  )
            }}
          </span>
        </div>
        <span
          v-if="state.source === 'file' && state.fileName && state.fileName !== title"
          class="rp-now__file"
          :title="state.fileName"
        >
          {{ state.fileName }} · {{ sourceLabel }}
        </span>
      </div>

      <div class="rp-progress" @pointerup="commitSeek" @pointercancel="commitSeek">
        <LjSlider
          :model-value="sliderPosition"
          :min="0"
          :max="sliderMax"
          :step="0.1"
          :disabled="!state.canSeek || busy"
          :aria-label="t('remote_control.player.position')"
          @update:model-value="onSliderInput"
        />
        <div class="rp-times">
          <span>{{ formatTime(sliderPosition) }}</span>
          <span>{{ formatTime(state.duration) }}</span>
        </div>
      </div>

      <div class="rp-steps">
        <LjButton
          variant="subtle"
          size="touch"
          icon-only
          :icon="ICONS.PLAYER.PREV"
          :aria-label="t('remote_control.player.previous')"
          :disabled="busy || !state.canPrevious"
          @click="previous"
        />
        <LjButton
          variant="subtle"
          size="touch"
          icon-only
          :icon="ICONS.PLAYER.REWIND_10"
          :aria-label="t('remote_control.player.rewind')"
          :disabled="busy || !state.active"
          @click="seekRelative(-10)"
        />
        <LjButton
          variant="subtle"
          size="touch"
          icon-only
          :icon="ICONS.PLAYER.FORWARD_10"
          :aria-label="t('remote_control.player.forward')"
          :disabled="busy || !state.active"
          @click="seekRelative(10)"
        />
        <LjButton
          variant="subtle"
          size="touch"
          icon-only
          :icon="ICONS.PLAYER.NEXT"
          :aria-label="t('remote_control.player.next')"
          :disabled="busy || !state.canNext"
          @click="next"
        />
      </div>

      <div class="rp-actions">
        <LjButton
          variant="primary"
          size="touch"
          :icon="state.playing ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
          :disabled="busy || state.loading || (!state.canPlay && !state.canPause)"
          @click="togglePlay"
        >
          {{ state.playing ? t("remote_control.player.pause") : t("remote_control.player.play") }}
        </LjButton>
        <LjButton
          variant="danger"
          size="touch"
          :icon="ICONS.PROJECTION.STOP"
          :disabled="busy"
          @click="showClose = true"
        >
          {{ t("remote_control.player.close") }}
        </LjButton>
      </div>
    </template>

    <LjDialog
      v-model="showClose"
      :title="t('remote_control.player.close_title')"
      :description="t('remote_control.player.close_text')"
      :icon="ICONS.PROJECTION.STOP"
      icon-variant="danger"
      size="sm"
    >
      <template #footer>
        <LjButton size="sm" variant="subtle" @click="showClose = false">
          {{ t("actions.cancel") }}
        </LjButton>
        <LjButton size="sm" variant="danger" :icon="ICONS.PROJECTION.STOP" @click="closeMedia">
          {{ t("remote_control.player.close") }}
        </LjButton>
      </template>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjDialog, LjIcon, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

/**
 * Player de mídia no controle remoto: mostra e controla o painel de mídia do
 * desktop (arquivo local, Biblioteca, música ou YouTube). O estado chega por
 * SSE (`media_state`) e o GET inicial/polling cobre o replay perdido.
 */
const props = withDefaults(defineProps<{ token?: string; active?: boolean }>(), { active: true });

const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t } = useI18n();

interface MediaState {
  active: boolean;
  playing: boolean;
  loading: boolean;
  minimized: boolean;
  source: "file" | "youtube";
  title: string;
  subtitle: string;
  fileName: string;
  position: number;
  duration: number;
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  canPrevious: boolean;
  canNext: boolean;
  seq: number;
}

const EMPTY: MediaState = {
  active: false,
  playing: false,
  loading: false,
  minimized: false,
  source: "file",
  title: "",
  subtitle: "",
  fileName: "",
  position: 0,
  duration: 0,
  canPlay: false,
  canPause: false,
  canSeek: false,
  canPrevious: false,
  canNext: false,
  seq: 0,
};

const state = ref<MediaState>({ ...EMPTY });
const busy = ref(false);
const showClose = ref(false);
const dragPosition = ref<number | null>(null);
let lastSeq = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;

const title = computed(
  () => state.value.title || state.value.fileName || t("remote_control.player.nothing")
);
const sourceLabel = computed(() =>
  state.value.source === "youtube"
    ? t("remote_control.player.source_youtube")
    : t("remote_control.player.source_file")
);
const labelOnTitle = computed(
  () =>
    state.value.source === "file" &&
    state.value.fileName !== "" &&
    state.value.fileName === title.value
);
const sliderMax = computed(() => Math.max(state.value.duration, 1));
const sliderPosition = computed(() => {
  const value = dragPosition.value ?? state.value.position;
  return Math.min(sliderMax.value, Math.max(0, value));
});

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function applyState(next: MediaState | null | undefined): void {
  if (!next || typeof next !== "object") return;
  const seq = Number(next.seq) || 0;
  if (seq && lastSeq && seq < lastSeq) return;
  if (seq) lastSeq = seq;
  state.value = { ...EMPTY, ...next };
}

async function load(): Promise<void> {
  try {
    const url = `/api/media${props.token ? `?token=${props.token}` : ""}`;
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error(await httpErrorMessage(res, t("remote_control.errors.generic")));
    }
    const data = await res.json();
    if (data?.status === "ok") applyState(data.state);
  } catch (error) {
    // Sem mídia/sem rede não vira toast a cada poll; o comando mostra o erro.
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
    const res = await postApi("/api/media", { action, ...extra }, props.token);
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

function togglePlay(): void {
  void command(state.value.playing ? "pause" : "play");
}

function seekRelative(seconds: number): void {
  void command("seek-relative", { seconds });
}

function previous(): void {
  void command("previous");
}

function next(): void {
  void command("next");
}

function onSliderInput(value: number): void {
  dragPosition.value = value;
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    seekTimer = null;
    commitSeek();
  }, 250);
}

async function commitSeek(): Promise<void> {
  if (seekTimer) {
    clearTimeout(seekTimer);
    seekTimer = null;
  }
  const value = dragPosition.value;
  if (value == null) return;
  if (!state.value.canSeek || busy.value) {
    dragPosition.value = null;
    return;
  }
  if (Math.abs(value - state.value.position) < 0.25) {
    dragPosition.value = null;
    return;
  }
  await command("seek", { position: value });
  dragPosition.value = null;
}

async function closeMedia(): Promise<void> {
  showClose.value = false;
  await command("close");
}

useBroadcastListener(BROADCAST_TYPE.MEDIA_STATE, (payload: unknown) => {
  applyState(payload as MediaState);
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
  }, 2000);
});

// O botão de sincronizar do controle remoto chama isto na aba Player.
defineExpose({ refresh: load });

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = null;
});
</script>

<style scoped>
.rp-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

.rp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-6);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-surface-bg);
}

.rp-empty__text {
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.rp-now {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  padding: var(--lj-space-4);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
}

.rp-now__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rp-now__title-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.rp-now__title {
  color: var(--lj-text-primary);
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-semibold, 600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rp-now__source {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  flex-shrink: 0;
}

.rp-now__subtitle {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rp-now__meta {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}

.rp-now__file {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rp-progress {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  touch-action: none;
}

.rp-times {
  display: flex;
  justify-content: space-between;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-variant-numeric: tabular-nums;
}

.rp-steps {
  display: flex;
  gap: var(--lj-space-2);
}

.rp-steps > * {
  flex: 1;
}

.rp-actions {
  display: flex;
  gap: var(--lj-space-3);
}

.rp-actions > * {
  flex: 1;
}
</style>
