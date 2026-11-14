<template>
  <ModuleContainer
    :manifest="manifest"
    :style="{ minWidth: '300px' }"
    @close="close()"
    @show="onModuleShow"
  >
    <div class="mod-shell">
      <ModuleFormatDrawer v-model="show_format" :module-id="'timer'" :manifest="manifest" />
      <div class="timer-layout">
        <div
          ref="container"
          class="timer-stage"
          style="gap: 16px"
          :style="rootStyle"
          data-testid="timer-stage"
          :data-alert="alertLevel || 'none'"
        >
          <ModuleBackgroundMedia
            v-if="bgImage"
            :src="bgImage"
            class="sw-bg-img"
            :style="imageStyle"
          />
          <!-- Display -->
          <div
            class="sw-display"
            :class="{
              'sw-warning': mode === 'down' && alertActive && seconds > 0,
              'sw-done': mode === 'down' && seconds <= 0 && alarmed && !overtime,
            }"
            :style="[textStyle, displayColorStyle]"
            data-testid="timer-display"
          >
            {{ projecao }}
          </div>
          <ModuleAlertFrame :level="flashBorders ? alertLevel : ''" :color="displayColor" />
        </div>
        <ModuleTimerDock
          :mode="mode"
          :warning-seconds="showAlert ? alertSeconds : 0"
          :labels="dockLabels"
          @update:mode="mode = $event"
          @update:warning-seconds="setWarning"
        />
      </div>
    </div>

    <TimerEndActionDialogs :end-action="endAction" />
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
import TimerEndActionDialogs from "@/components/TimerEndActionDialogs.vue";
import { playBeep } from "@/helpers/AudioBeep";
import $userdata from "@/helpers/UserData";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { useTimerEndAction } from "@/composables/useTimerEndAction";
import { KEYS } from "@/constants/UserDataKeys";
import { MediaEnum } from "@/enums/MediaEnum";
import { formatTimerSeconds, timerProjectionText } from "@/helpers/TimerText";
import { secondsUntilTarget } from "@/helpers/TimerTarget";
import { timerShowsTarget, timerTargetTime } from "../projectionText";

$userdata.setIfNull(KEYS.MODULES.TIMER.END_ACTION, MediaEnum.NONE);

const { show_format } = useModuleFormat("timer", manifest);
const { rootStyle, textStyle, alertStyle, warningStyle, bgImage, imageStyle, container } =
  useModuleBodyStyle("timer");
const endAction = useTimerEndAction("timer", KEYS.MODULES.TIMER);

const projection = useModuleProjection("timer", {
  onAction(action: string, payload?: unknown) {
    if (action === "toggle") toggle();
    else if (action === "reset") reset();
    else if (action === "set_time") setTimeFromPayload(payload);
    else if (action === "toggle_format") show_format.value = !show_format.value;
    else if (action === "file_audio") endAction.handleFileAudio();
    else if (action === "file_video") endAction.handleFileVideo();
    else if (action === "online_video") endAction.handleOnlineVideo();
    else if (action === "music") endAction.handleMusic();
  },
});

function playAlarm(): void {
  try {
    playBeep(880, 0.25, 0.5, 0);
    playBeep(880, 0.25, 0.5, 0.3);
    playBeep(1100, 0.4, 0.5, 0.6);
  } catch {
    /* noop */
  }
}

type TimerMode = "up" | "down";

const running = ref<boolean>(false);
const seconds = ref<number>(0);
const durationSeconds = ref<number>(0);
const startedAt = ref<number | null>(null);
const alarmed = ref<boolean>(false);
let timer: ReturnType<typeof setInterval> | null = null;

const mode = computed<TimerMode>({
  /*
   * Padrão "down", o mesmo da ribbon (manifest) e do Temporizador de Culto. Com
   * "up" aqui, quem nunca mexeu no seletor via "Regressivo" na ribbon enquanto
   * o módulo contava progressivo: 00:00:00 parado ao definir a hora, subindo
   * ao iniciar.
   */
  get: () => $userdata.get<TimerMode>(KEYS.MODULES.TIMER.MODE, "down") ?? "down",
  set: (v: TimerMode) => $userdata.set(KEYS.MODULES.TIMER.MODE, v),
});

const targetTime = computed<string>({
  get: () => timerTargetTime(),
  set: (v: string) => $userdata.set(KEYS.MODULES.TIMER.TARGET_TIME, v),
});

const showTargetTime = computed<boolean>(() => timerShowsTarget());

const showAlert = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER.SHOW_ALERT, true) ?? true
);

const alertSeconds = computed<number>(() =>
  Math.max(0, Number($userdata.get<number>(KEYS.MODULES.TIMER.ALERT_SECONDS, 60)) || 60)
);

const alertActive = computed<boolean>(
  () =>
    mode.value === "down" &&
    startedAt.value !== null &&
    showAlert.value &&
    seconds.value <= alertSeconds.value &&
    (seconds.value > 0 || alarmed.value)
);

const { tm } = useModuleI18n("timer");
/*
 * Cor do número (e da moldura): "Cor do aviso" nos segundos de destaque,
 * "Cor do alerta" só depois do horário — as duas da Formatação. Antes, o destaque já pintava de vermelho
 * enquanto a moldura ficava amarela.
 */
const displayColor = computed<string | undefined>(() => {
  // Passou do horário: vermelho mesmo com o aviso em "Não".
  if (mode.value === "down" && seconds.value <= 0 && alarmed.value && startedAt.value !== null) {
    return alertStyle.value.color;
  }
  return alertActive.value ? warningStyle.value.color : undefined;
});
const displayColorStyle = computed(() =>
  displayColor.value ? { color: displayColor.value } : null
);

function setWarning(value: number): void {
  // "Não" desliga o destaque; os outros botões ligam e definem os segundos.
  $userdata.set(KEYS.MODULES.TIMER.SHOW_ALERT, value > 0);
  if (value > 0) $userdata.set(KEYS.MODULES.TIMER.ALERT_SECONDS, value);
}

const dockLabels = computed(() => ({
  mode: tm("ribbon.mode"),
  up: tm("mode.up"),
  down: tm("mode.down"),
  warning: tm("ribbon.warning"),
  warnings: ["off", "m1", "m2", "m5", "m10"].map((k) => tm(`warning.${k}`)),
}));

const overtime = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER.COUNT_OVERTIME, true) !== false
);
const flashBorders = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER.FLASH_BORDERS, true) !== false
);

/*
 * Aviso de tempo para a moldura (tela e telão): amarelo nos segundos de
 * destaque, vermelho depois do zero. Só com a contagem iniciada — parado,
 * mesmo perto do horário, nada pisca no telão.
 */
const alertLevel = computed<"" | "warning" | "danger">(() => {
  if (mode.value !== "down" || startedAt.value === null) return "";
  if (seconds.value <= 0) return alarmed.value ? "danger" : "";
  return alertActive.value ? "warning" : "";
});

const display = computed<string>(() => formatTimerSeconds(seconds.value));

const projecao = computed<string>(() =>
  timerProjectionText(display.value, showTargetTime.value, targetTime.value)
);

const projectionActive = ref(true);

function emitProjection(): void {
  projection.emit({
    text: projectionActive.value ? projecao.value : "",
    active: projectionActive.value,
    color: projectionActive.value ? displayColor.value : undefined,
    alert:
      projectionActive.value && flashBorders.value && alertLevel.value
        ? alertLevel.value
        : undefined,
  });
}

watch(
  [projecao, alertActive, alertLevel, flashBorders, displayColor, projectionActive],
  emitProjection,
  { immediate: true }
);

watch(mode, () => reset());

function getDurationUntilTarget(): number {
  return Math.max(0, secondsUntilTarget(targetTime.value));
}

function updateFromTargetTime(): void {
  alarmed.value = false;
  durationSeconds.value = getDurationUntilTarget();
  seconds.value = mode.value === "down" ? durationSeconds.value : 0;
}

function setTimeFromPayload(payload: unknown): void {
  const value = (payload as { url?: string } | null)?.url;
  if (!value) return;
  if (!/^\d{1,2}:\d{2}$/.test(value)) return;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return;
  targetTime.value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  reset();
}

function updateRunningTime(): void {
  if (!startedAt.value) return;

  const elapsedSeconds = Math.floor((Date.now() - startedAt.value) / 1000);

  if (mode.value === "up") {
    seconds.value = Math.min(elapsedSeconds, durationSeconds.value);

    if (seconds.value >= durationSeconds.value && !alarmed.value) {
      alarmed.value = true;
      pause();
      playAlarm();
      endAction.triggerTimerEndAction();
    }

    return;
  }

  const left = durationSeconds.value - elapsedSeconds;
  seconds.value = overtime.value ? left : Math.max(left, 0);

  if (left <= 0 && !alarmed.value) {
    alarmed.value = true;
    // Com tempo excedido a contagem segue (-00:00:01…); sem ele, para no zero.
    if (!overtime.value) pause();
    playAlarm();
    endAction.triggerTimerEndAction();
  }
}

/*
 * Desligar o excedido no meio dele precisa parar a contagem: `alarmed` já é
 * true, então o tick não pausa sozinho e o botão ficaria em "Pausar" com o
 * display congelado em 00:00:00.
 */
watch(overtime, (on) => {
  if (on || mode.value !== "down" || !alarmed.value || seconds.value > 0) return;
  seconds.value = 0;
  if (running.value) pause();
});

function toggle(): void {
  if (running.value) {
    pause();
  } else {
    start();
  }
}

function start(): void {
  /*
   * Retomar depois de pausar no tempo excedido segue contando o excedido sem
   * disparar de novo o bipe e a ação "Ao terminar".
   */
  alarmed.value = alarmed.value && overtime.value && mode.value === "down";
  const until = secondsUntilTarget(targetTime.value);
  // Regressivo aceita horário já passado: começa direto no excedido (ou no zero).
  durationSeconds.value =
    mode.value === "down"
      ? overtime.value
        ? until
        : Math.max(0, until)
      : getDurationUntilTarget();
  startedAt.value = Date.now();
  seconds.value = mode.value === "down" ? durationSeconds.value : 0;
  running.value = true;
  $userdata.set(KEYS.MODULES.TIMER.RUNNING, true);

  timer = setInterval(updateRunningTime, 1000);
}

function pause(): void {
  running.value = false;
  $userdata.set(KEYS.MODULES.TIMER.RUNNING, false);
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function reset(): void {
  pause();
  startedAt.value = null;
  alarmed.value = false;
  updateFromTargetTime();
}

// Fechar zera a contagem e tira o módulo do telão. O horário continua salvo,
// então reabrir e iniciar retoma do ponto certo.
function close(): void {
  if (!projectionActive.value && !running.value) return;
  projectionActive.value = false;
  reset();
  emitProjection();
}

/*
 * O X da aba fecha por Modules.close(); o ModuleContainer traduz a mudança de
 * visibilidade no evento `show`, sem o módulo precisar ler AppData.
 */
function onModuleShow(visible: boolean): void {
  if (!visible) {
    close();
    return;
  }
  projectionActive.value = true;
  emitProjection();
}

// Fechar o app com a contagem rodando deixava a chave em "true", e o botão da
// ribbon abria em "Pausar" sem nada contando.
$userdata.set(KEYS.MODULES.TIMER.RUNNING, false);

onBeforeUnmount(() => {
  projection.emit({ active: false, text: "" });
  if (timer !== null) clearInterval(timer);
});
</script>

<style scoped>
.mod-shell {
  display: flex;
  height: 100%;
}

.timer-layout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.timer-stage {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-grow: 1;
}

.sw-display {
  position: relative;
  z-index: 1;
  font-size: 3.5rem;
  font-weight: 300;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  transition: color var(--lj-transition-slow);
  white-space: pre-line;
}
.sw-warning {
  color: #f59e0b;
}
.sw-done {
  color: #ef4444;
  animation: sw-pulse 0.8s ease-in-out infinite alternate;
}
.sw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
@keyframes sw-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
</style>
