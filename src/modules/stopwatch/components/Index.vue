<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" :style="{ minWidth: '300px' }">
    <!-- Voltas registradas: ficam à esquerda da prévia, com o botão de zerar no topo. -->
    <template #left>
      <aside class="sw-laps" :aria-label="tm('screen.laps')">
        <div class="sw-laps__header">
          <span class="sw-laps__title">{{ tm("screen.laps") }}</span>
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.DELETE"
            :title="tm('screen.clear_laps')"
            :aria-label="tm('screen.clear_laps')"
            :disabled="laps.length === 0"
            data-testid="stopwatch-clear-laps"
            @click="confirmClearLaps"
          />
        </div>

        <ol v-if="laps.length" class="sw-laps__list" data-testid="stopwatch-laps">
          <li v-for="item in lapsNewestFirst" :key="item.index" class="sw-laps__row">
            <span class="sw-laps__index">#{{ item.index }}</span>
            <span class="sw-laps__time">{{ formatLap(item) }}</span>
          </li>
        </ol>
        <p v-else class="sw-laps__empty" data-testid="stopwatch-no-laps">
          {{ tm("screen.no_laps") }}
        </p>
      </aside>
    </template>

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
          :warnings="DOCK_WARNINGS"
          custom-warning
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useModuleLaunch } from "@/composables/useModuleLaunch";
import { ICONS } from "@/config/Icons";
import { LjButton, LjChip } from "@/components/ui";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { useScreenProjection } from "@/composables/useScreenProjection";
import $alert from "@/helpers/Alert";
import { formatStopwatch } from "../stopwatchClock";
import {
  addMinute,
  alert,
  alertColor,
  clearLaps,
  display,
  endsAt,
  ensureStopwatchLoaded,
  flashBorders,
  lap,
  laps,
  mode,
  overtime,
  progress,
  resetAll,
  resetTime,
  setMode,
  setTarget,
  start,
  setWarning,
  targetLabel,
  targetSeconds,
  toggle,
  warningSeconds,
} from "../state";

const PRESETS = [5, 10, 15, 30];

const { show_format } = useModuleFormat("stopwatch", manifest);
const { rootStyle, textStyle, bgImage, imageStyle, container } = useModuleBodyStyle("stopwatch");

useModuleProjection("stopwatch", {
  onAction(action, payload) {
    if (action === "toggle") toggle();
    else if (action === "lap") lap();
    else if (action === "reset") confirmReset();
    else if (action === "set_time") setTimeFromPayload(payload);
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

/*
 * Item "Utilitário" da liturgia: modo e tempo (regressivo) já definidos e, se
 * o item pediu, começa a contar. As voltas ficam como estão.
 */
useModuleLaunch("stopwatch", async ({ config, autoStart }) => {
  if (config.mode) setMode(config.mode);
  if (config.minutes && (config.mode ?? mode.value) === "down") setTarget(config.minutes * 60);
  await nextTick();
  resetTime();
  if (autoStart) start();
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

const moduleContainer = ref(null);
const tm = (key, named) => moduleContainer.value?.tm(key, named) || key;

const lapsNewestFirst = computed(() => [...laps.value].reverse());

function formatLap(item) {
  return formatStopwatch(item.shown, true);
}

/** Reiniciar zera tempo e voltas — confirma antes, como o zerar das voltas. */
function confirmReset() {
  $alert.yesno(
    {
      title: "modules.stopwatch.alerts.reset_title",
      text: "modules.stopwatch.alerts.reset_text",
      destructive: true,
    },
    (resp) => {
      if (resp === "yes") resetAll();
    }
  );
}

function confirmClearLaps() {
  $alert.yesno(
    {
      title: "modules.stopwatch.alerts.clear_laps_title",
      text: "modules.stopwatch.alerts.clear_laps_text",
      destructive: true,
    },
    (resp) => {
      if (resp === "yes") clearLaps();
    }
  );
}

/** Ação da ribbon (Tempo): "hh:mm:ss" → segundos. */
function setTimeFromPayload(payload) {
  const value = payload?.url;
  if (!value) return;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p))) return;
  const [h, m, s] = parts;
  if (h < 0 || h > 99 || m < 0 || m > 59 || s < 0 || s > 59) return;
  const total = h * 3600 + m * 60 + s;
  setTarget(total);
}

/** Personalizado, 30 s e os minutos; "Não" fica no fim para desligar o aviso. */
const DOCK_WARNINGS = [30, 60, 120, 300, 600, 0];

const dockLabels = computed(() => ({
  mode: tm("ribbon.mode"),
  up: tm("mode.up"),
  down: tm("mode.down"),
  warning: tm("ribbon.warning"),
  warnings: ["m30", "m1", "m2", "m5", "m10", "off"].map((k) => tm(`warning.${k}`)),
  custom: tm("warning.custom"),
  customPlaceholder: tm("warning.custom_placeholder"),
}));

let screenPoll = null;
onMounted(() => {
  ensureStopwatchLoaded();
  void screen.refresh();
  screenPoll = setInterval(() => void screen.refresh(), 2000);
});

onBeforeUnmount(() => {
  // O cronômetro continua no estado compartilhado; só a prévia/consulta some.
  clearInterval(screenPoll);
  screenPoll = null;
});
</script>

<style scoped>
.sw-laps {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 100%;
  min-height: 0;
  padding: var(--lj-space-3);
  gap: var(--lj-space-2);
}

.sw-laps__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-height: var(--lj-ui-h-md);
}

.sw-laps__title {
  flex: 1;
  min-width: 0;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold, 600);
  color: var(--lj-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sw-laps__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  overflow: auto;
  min-height: 0;
}

.sw-laps__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-active);
}

.sw-laps__index {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
  font-variant-numeric: tabular-nums;
}

.sw-laps__time {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-primary);
  font-variant-numeric: tabular-nums;
}

.sw-laps__empty {
  margin: 0;
  padding: var(--lj-space-2);
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
}

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
