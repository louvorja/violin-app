<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '300px' }"
    @close="close()"
    @show="onModuleShow"
  >
    <div class="lj-u-flex lj-u-h-full">
      <ModuleFormatDrawer v-model="show_format" :module-id="'stopwatch'" :manifest="manifest" />
      <div class="sw-layout">
        <!-- Prévia: segue a Formatação, igual ao que vai para o telão. -->
        <div
          ref="container"
          class="sw-body"
          :style="[rootStyle, { '--sw-hud-color': textStyle.color || '#fff' }]"
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
                'sw-done': alert === 'danger',
                'sw-done--stopped': alert === 'danger' && !overtime,
              }"
              :style="[textStyle, alertColor ? { color: alertColor } : null]"
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
              :style="[
                { width: `${progress * 100}%` },
                alertColor ? { background: alertColor } : null,
              ]"
            />
          </div>

          <ModuleAlertFrame
            :level="flashBorders ? alert : ''"
            :color="alertColor"
            data-testid="stopwatch-frame"
          />
        </div>

        <!-- Modo, tempos rápidos e aviso: o que se mexe durante o culto. -->
        <ModuleTimerDock
          :mode="mode"
          :warning-seconds="warningSeconds"
          :labels="dockLabels"
          @update:mode="setMode"
          @update:warning-seconds="setWarning"
        >
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
        </ModuleTimerDock>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup>
import { ICONS } from "@/config/Icons";
import { LjButton, LjChip } from "@/components/ui";
import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
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

const PRESETS = [5, 10, 15, 30];
/** Quatro pinturas por segundo bastam para o segundo virar na hora certa. */
const TICK_MS = 250;

const { show_format } = useModuleFormat("stopwatch", manifest);
const { rootStyle, textStyle, alertStyle, warningStyle, bgImage, imageStyle, container } =
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
const display = computed(() =>
  formatStopwatch(seconds.value, showSeconds.value, mode.value === "down")
);
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

/*
 * Cor do estado: "Cor do aviso" e "Cor do alerta" da Formatação. O número, a
 * barra e a moldura (na tela e no telão) usam a mesma, para nunca ficarem
 * com cores diferentes entre si.
 */
const alertColor = computed(() =>
  alert.value === "danger"
    ? alertStyle.value?.color
    : alert.value === "warning"
      ? warningStyle.value?.color
      : undefined
);

const projectionActive = ref(true);

function emitProjection() {
  projection.emit({
    text: projectionActive.value ? display.value : "",
    active: projectionActive.value,
    color: projectionActive.value ? alertColor.value : undefined,
    alert: projectionActive.value && flashBorders.value && alert.value ? alert.value : undefined,
  });
}

watch([display, alert, flashBorders, alertColor, projectionActive], emitProjection, {
  immediate: true,
});

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

/*
 * Desligar o excedido com a contagem já passada do zero precisa parar o
 * relógio: `tick` não pausa mais depois de `reachedEnd`, e o botão ficaria em
 * "Pausar" com o display congelado em 00:00.
 */
watch(overtime, (on) => {
  if (!on && reachedEnd.value && running.value) pause();
});

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

function setWarning(seconds) {
  $userdata.set(KEYS.MODULES.STOPWATCH.WARNING_SECONDS, String(seconds));
}

const dockLabels = computed(() => ({
  mode: tm("ribbon.mode"),
  up: tm("mode.up"),
  down: tm("mode.down"),
  warning: tm("ribbon.warning"),
  warnings: ["off", "m1", "m2", "m5", "m10"].map((k) => tm(`warning.${k}`)),
}));

/** Marca a próxima mudança de meta como extensão, não como recomeço. */
let extendTo = null;

function clampTarget(total) {
  return Math.max(0, Math.min(Number(total) || 0, 99 * 3600));
}

function setTarget(total) {
  const next = clampTarget(total);
  extendTo = null;
  if (next === targetSeconds.value) {
    reset();
    return;
  }
  $userdata.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, next);
}

function extendTarget(seconds) {
  const next = clampTarget(targetSeconds.value + seconds);
  if (next === targetSeconds.value) return;
  extendTo = next;
  $userdata.set(KEYS.MODULES.STOPWATCH.TARGET_SECONDS, next);
}

/*
 * +1 min durante a contagem dá mais tempo a quem está falando sem recomeçar:
 * a meta cresce e a contagem continua de onde está, pausada ou correndo.
 */
function addMinute() {
  extendTarget(60);
}

// Trocar o modo ou a meta (ribbon, presets, controle remoto) zera — exceto o
// +1 min, que só estende.
watch(mode, () => reset());
watch(targetSeconds, (next) => {
  const isExtension = extendTo !== null && next === extendTo;
  extendTo = null;

  if (isExtension) {
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
  if (!projectionActive.value && !running.value) return;
  projectionActive.value = false;
  reset();
  emitProjection();
}

/*
 * O X da aba fecha por Modules.close(); o ModuleContainer traduz a mudança de
 * visibilidade no evento `show`, sem o módulo precisar ler AppData.
 */
function onModuleShow(visible) {
  if (!visible) {
    close();
    return;
  }
  projectionActive.value = true;
  emitProjection();
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
  projection.emit({ active: false, text: "" });
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
  color: color-mix(in srgb, var(--sw-hud-color, #fff) 62%, transparent);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.sw-hud-info {
  margin-left: auto;
  white-space: nowrap;
}
.sw-hud-info b {
  color: var(--sw-hud-color, #fff);
  font-weight: var(--lj-weight-semibold, 600);
}

.sw-onair {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: 2px var(--lj-space-4);
  border-radius: 999px;
  border: 1px solid #ef4444;
  background: #ef4444;
  color: #fff;
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
  background: #fff;
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
.sw-done--stopped {
  animation: sw-pulse 0.8s ease-in-out infinite alternate;
}

.sw-sub {
  font-size: var(--lj-text-base);
  color: color-mix(in srgb, var(--sw-hud-color, #fff) 62%, transparent);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}
.sw-sub b {
  color: var(--sw-hud-color, #fff);
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

.sw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.sw-presets {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
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
