<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '300px' }"
    @close="close()"
  >
    <div class="lj-u-flex lj-u-h-full">
      <ModuleFormatDrawer v-model="show_format" :module-id="'stopwatch'" :manifest="manifest" />
      <div class="sw-layout">
        <!-- Prévia: segue a Formatação, igual ao que vai para o telão. -->
        <div
          ref="container"
          class="sw-body"
          :style="rootStyle"
          data-testid="stopwatch-stage"
          :data-alert="alert || 'none'"
        >
          <ModuleBackgroundMedia
            v-if="bgImage"
            :src="bgImage"
            class="sw-bg-img"
            :style="imageStyle"
          />

          <div class="sw-hud">
            <span v-if="onAir" class="sw-onair" data-testid="stopwatch-on-air">
              <span class="sw-onair-dot" />
              {{ tm("screen.on_air") }}
            </span>
            <span class="sw-hud-info">
              {{ tm(`mode.${mode}`) }}
              <template v-if="mode === 'down'">
                · {{ tm("screen.goal") }}
                <b>{{ targetLabel }}</b>
              </template>
            </span>
          </div>

          <div class="sw-center">
            <div
              class="sw-display"
              :class="{
                'sw-warning': alert === 'warning',
                'sw-done': alert === 'danger',
                'sw-done--stopped': alert === 'danger' && !overtime,
              }"
              :style="[textStyle, alert === 'danger' ? alertStyle : null]"
              data-testid="stopwatch-display"
            >
              {{ display }}
            </div>

            <div v-if="endsAt" class="sw-sub" data-testid="stopwatch-ends-at">
              {{ tm("screen.ends_at") }}
              <b>{{ endsAt }}</b>
            </div>
            <LjChip
              v-else-if="alert === 'danger'"
              variant="danger"
              :icon="ICONS.TIMER.ALARM"
              class="sw-alarm"
            >
              {{ overtime ? tm("screen.overtime") : tm("alarm.done") }}
            </LjChip>
          </div>

          <div v-if="mode === 'down'" class="sw-progress" aria-hidden="true">
            <div
              class="sw-progress-bar"
              :class="alert ? `sw-progress-bar--${alert}` : null"
              :style="{ width: `${progress * 100}%` }"
            />
          </div>

          <ModuleAlertFrame :level="flashBorders ? alert : ''" data-testid="stopwatch-frame" />
        </div>

        <!-- Controles do dia a dia, sem depender da ribbon. -->
        <div class="sw-dock">
          <div class="sw-segmented" role="group" :aria-label="tm('ribbon.mode')">
            <button
              v-for="m in MODES"
              :key="m"
              type="button"
              class="sw-seg"
              :class="{ 'sw-seg--on': mode === m }"
              :aria-pressed="mode === m"
              :data-testid="`stopwatch-mode-${m}`"
              @click="setMode(m)"
            >
              {{ tm(`mode.${m}`) }}
            </button>
          </div>

          <div
            v-if="mode === 'down'"
            class="sw-presets"
            role="group"
            :aria-label="tm('screen.presets')"
          >
            <LjButton
              v-for="min in PRESETS"
              :key="min"
              size="sm"
              :variant="targetSeconds === min * 60 ? 'primary' : 'subtle'"
              :data-testid="`stopwatch-preset-${min}`"
              @click="setTarget(min * 60)"
            >
              {{ tm("screen.minutes", { n: min }) }}
            </LjButton>
            <LjButton
              size="sm"
              variant="subtle"
              :icon="ICONS.ACTIONS.ADD"
              data-testid="stopwatch-add-minute"
              @click="addMinute()"
            >
              {{ tm("screen.minutes", { n: 1 }) }}
            </LjButton>
          </div>

          <div class="sw-dock-spacer" />

          <LjButton
            :icon="ICONS.ACTIONS.RESTART"
            variant="default"
            data-testid="stopwatch-reset"
            @click="reset()"
          >
            {{ tm("actions.reset") }}
          </LjButton>
          <button
            type="button"
            class="sw-play"
            :class="{ 'sw-play--running': running }"
            :title="running ? tm('actions.pause') : tm('actions.start')"
            :aria-label="running ? tm('actions.pause') : tm('actions.start')"
            data-testid="stopwatch-toggle"
            @click="toggle()"
          >
            <LjIcon :icon="running ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY" :size="22" />
          </button>
        </div>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup>
import { ICONS } from "@/config/Icons";
import { LjButton, LjChip, LjIcon } from "@/components/ui";
import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import { playBeep } from "@helpers/AudioBeep";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { useScreenProjection } from "@/composables/useScreenProjection";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import {
  elapsedMs,
  endsAtLabel,
  formatStopwatch,
  shownSeconds,
  stopwatchAlert,
  stopwatchProgress,
} from "../stopwatchClock";

const MODES = ["up", "down"];
const PRESETS = [5, 10, 15, 30];
/** Cor do aviso amarelo — a mesma da moldura no telão. */
const WARNING_COLOR = "#F59E0B";
/** Quatro pinturas por segundo bastam para o segundo virar na hora certa. */
const TICK_MS = 250;

const { show_format } = useModuleFormat("stopwatch", manifest);
const { rootStyle, textStyle, alertStyle, bgImage, imageStyle, container } =
  useModuleBodyStyle("stopwatch");

const projection = useModuleProjection("stopwatch", {
  onAction(action, payload) {
    if (action === "toggle") toggle();
    else if (action === "reset") reset();
    else if (action === "set_time") setTimeFromPayload(payload);
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

/* "No telão" na prévia: o mesmo estado que acende o botão Projetar da ribbon. */
const screen = useScreenProjection({
  feature: () => "stopwatch",
  route: () => "/projection/module?module=stopwatch",
  monitorId: () => null,
  fullscreen: () => true,
  alwaysOnTop: () => false,
});
const onAir = computed(() => screen.aberto.value);

function playAlarm() {
  try {
    playBeep(880, 0.25, 0.5, 0);
    playBeep(880, 0.25, 0.5, 0.3);
    playBeep(1100, 0.4, 0.5, 0.6);
  } catch {
    /* noop */
  }
}

const moduleContainer = ref(null);
const tm = (key, named) => moduleContainer.value?.tm(key, named) || key;

/*
 * O modo é lido direto do UserData: quem troca pode ser a ribbon (que grava a
 * chave sem passar por aqui) ou o seletor da própria tela. O `watch` abaixo
 * zera nos dois casos — antes só o setter zerava, e pela ribbon o Regressivo
 * ficava mostrando 00:00 até alguém apertar Iniciar.
 */
const mode = computed(() =>
  $userdata.get(KEYS.MODULES.STOPWATCH.MODE, "up") === "down" ? "down" : "up"
);
const targetSeconds = computed(() =>
  Math.max(0, Number($userdata.get(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, 600)) || 0)
);
const showSeconds = computed(
  () => $userdata.get(KEYS.MODULES.STOPWATCH.SHOW_SECONDS, true) !== false
);
const overtime = computed(
  () => $userdata.get(KEYS.MODULES.STOPWATCH.COUNT_OVERTIME, true) !== false
);
const warningSeconds = computed(() =>
  Math.max(0, Number($userdata.get(KEYS.MODULES.STOPWATCH.WARNING_SECONDS, 60)) || 0)
);
const flashBorders = computed(
  () => $userdata.get(KEYS.MODULES.STOPWATCH.FLASH_BORDERS, true) !== false
);

const running = ref(false);
const run = ref({ baseMs: 0, startedAt: null });
const now = ref(Date.now());
/** A contagem regressiva já bateu no zero nesta rodada (bipe dado). */
const reachedEnd = ref(false);
let timer = null;

const elapsed = computed(() => elapsedMs(run.value, now.value));
const seconds = computed(() =>
  shownSeconds(mode.value, targetSeconds.value, elapsed.value, overtime.value)
);
const display = computed(() => formatStopwatch(seconds.value, showSeconds.value));
const alert = computed(() =>
  stopwatchAlert(
    mode.value,
    seconds.value,
    warningSeconds.value,
    reachedEnd.value,
    // Começou = está contando ou já contou algo (pausado no meio ainda avisa).
    running.value || elapsed.value > 0
  )
);
const progress = computed(() => stopwatchProgress(targetSeconds.value, elapsed.value));
const targetLabel = computed(() => formatStopwatch(targetSeconds.value, true));
const endsAt = computed(() =>
  running.value && mode.value === "down" && seconds.value > 0
    ? endsAtLabel(now.value, seconds.value)
    : ""
);

watch(
  [display, alert, flashBorders, () => alertStyle.value?.color],
  () => {
    projection.emit({
      text: display.value,
      active: true,
      color:
        alert.value === "danger"
          ? alertStyle.value?.color
          : alert.value === "warning"
            ? WARNING_COLOR
            : undefined,
      alert: flashBorders.value && alert.value ? alert.value : undefined,
    });
  },
  { immediate: true }
);

function tick() {
  now.value = Date.now();
  if (mode.value !== "down" || reachedEnd.value) return;
  const done = Math.floor(elapsed.value / 1000);
  if (done < targetSeconds.value) return;
  reachedEnd.value = true;
  playAlarm();
  // Sem tempo excedido a contagem termina aqui, como sempre foi.
  if (!overtime.value) pause();
}

function toggle() {
  if (running.value) pause();
  else start();
}

function start() {
  if (running.value) return;
  // Regressivo que já terminou recomeça do início, não do zero parado.
  if (mode.value === "down" && reachedEnd.value && !overtime.value) resetCount();
  run.value = { baseMs: run.value.baseMs, startedAt: Date.now() };
  running.value = true;
  $userdata.set(KEYS.MODULES.STOPWATCH.RUNNING, true);
  clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  tick();
}

function pause() {
  if (run.value.startedAt !== null) {
    run.value = { baseMs: elapsedMs(run.value, Date.now()), startedAt: null };
  }
  running.value = false;
  $userdata.set(KEYS.MODULES.STOPWATCH.RUNNING, false);
  clearInterval(timer);
  timer = null;
  now.value = Date.now();
}

function resetCount() {
  run.value = { baseMs: 0, startedAt: running.value ? Date.now() : null };
  reachedEnd.value = false;
  now.value = Date.now();
}

function reset() {
  pause();
  resetCount();
}

function setMode(value) {
  if (value === mode.value) return;
  $userdata.set(KEYS.MODULES.STOPWATCH.MODE, value);
}

function setTarget(total) {
  $userdata.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, Math.max(0, Math.min(total, 99 * 3600)));
}

/*
 * +1 min durante a contagem dá mais tempo a quem está falando sem recomeçar:
 * a meta cresce e a contagem continua de onde está. Parado, só ajusta a meta.
 */
function addMinute() {
  setTarget(targetSeconds.value + 60);
}

// Trocar o modo ou a meta (ribbon, presets, controle remoto) zera — exceto o
// +1 min com o cronômetro rodando, que só estende.
watch(mode, () => reset());
watch(targetSeconds, (next, prev) => {
  if (running.value && next > prev) {
    // `seconds` já reflete a meta nova: se voltou a sobrar tempo, sai do vermelho.
    if (seconds.value > 0) reachedEnd.value = false;
    return;
  }
  reset();
});

function setTimeFromPayload(payload) {
  const value = payload?.url;
  if (!value) return;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p))) return;
  const [h, m, s] = parts;
  if (h < 0 || h > 99 || m < 0 || m > 59 || s < 0 || s > 59) return;
  const total = h * 3600 + m * 60 + s;
  if (total === targetSeconds.value) reset();
  else setTarget(total);
}

function close() {
  reset();
}

let screenPoll = null;
onMounted(() => {
  // O app pode ter sido fechado com a contagem rodando: a chave ficava "true" e
  // o botão da ribbon abria em "Pausar" com nada contando.
  $userdata.set(KEYS.MODULES.STOPWATCH.RUNNING, false);
  void screen.refresh();
  screenPoll = setInterval(() => void screen.refresh(), 2000);
});

onBeforeUnmount(() => {
  clearInterval(timer);
  clearInterval(screenPoll);
  $userdata.set(KEYS.MODULES.STOPWATCH.RUNNING, false);
});
</script>

<style scoped>
.sw-layout {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
  min-height: 0;
}

/* Padding e alinhamento vêm de `rootStyle` (formatação do usuário) e vencem
   estes valores — que são só o ponto de partida. */
.sw-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-grow: 1;
  min-height: 0;
  gap: var(--lj-space-6);
  padding: var(--lj-space-6);
  overflow: hidden;
}

/* Sai da camada de fundo: a imagem é posicionada e cobriria um elemento
   em fluxo normal. */
.sw-hud,
.sw-center,
.sw-alarm {
  position: relative;
  z-index: 1;
}

.sw-hud {
  position: absolute;
  top: var(--lj-space-5);
  left: var(--lj-space-5);
  right: var(--lj-space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-sm);
  color: rgba(255, 255, 255, 0.62);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.sw-hud-info {
  margin-left: auto;
  white-space: nowrap;
}
.sw-hud-info b {
  color: #fff;
  font-weight: var(--lj-weight-semibold, 600);
}

.sw-onair {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: 2px var(--lj-space-4);
  border-radius: 999px;
  border: 1px solid rgba(239, 68, 68, 0.6);
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
  font-size: var(--lj-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: none;
}
.sw-onair-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  animation: sw-pulse 1s ease-in-out infinite alternate;
}

.sw-center {
  display: flex;
  flex-direction: column;
  align-items: inherit;
  gap: var(--lj-space-3);
}

.sw-display {
  font-size: 3.5rem;
  font-weight: 300;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  transition: color var(--lj-transition-slow);
}
.sw-warning {
  color: #f59e0b !important;
}
.sw-done--stopped {
  animation: sw-pulse 0.8s ease-in-out infinite alternate;
}

.sw-sub {
  font-size: var(--lj-text-base);
  color: rgba(255, 255, 255, 0.6);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.sw-sub b {
  color: #fbbf24;
  font-weight: 600;
}

.sw-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  z-index: 1;
  background: rgba(255, 255, 255, 0.1);
}
.sw-progress-bar {
  height: 100%;
  background: #22c55e;
  transition:
    width 0.25s linear,
    background-color var(--lj-transition-slow);
}
.sw-progress-bar--warning {
  background: #f59e0b;
}
.sw-progress-bar--danger {
  background: #ef4444;
}

.sw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* ── Dock de controles ─────────────────────────────────────────────── */
.sw-dock {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4) var(--lj-space-5);
  border-top: 1px solid var(--lj-body-divider);
  background: var(--lj-surface-bg);
}
.sw-dock-spacer {
  flex: 1 1 auto;
}

.sw-segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-sunken, rgba(127, 127, 127, 0.14));
  border: var(--lj-ui-border);
}
.sw-seg {
  height: calc(var(--lj-ui-h-md) - 6px);
  padding: 0 var(--lj-space-5);
  border: 0;
  border-radius: calc(var(--lj-ui-radius) - 2px);
  background: transparent;
  color: var(--lj-text-muted, inherit);
  font-size: var(--lj-text-sm);
  cursor: pointer;
}
.sw-seg:hover {
  color: var(--lj-text);
}
.sw-seg:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.sw-seg--on {
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

.sw-presets {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.sw-play {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: #27ae60;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transition:
    background var(--lj-transition-fast),
    transform var(--lj-transition-fast);
}
.sw-play:hover {
  filter: brightness(1.08);
}
.sw-play:active {
  transform: scale(0.96);
}
.sw-play:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.sw-play--running {
  background: #e67e22;
}

@keyframes sw-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sw-onair-dot,
  .sw-done--stopped {
    animation: none;
  }
}
</style>
