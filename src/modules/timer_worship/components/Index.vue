<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '320px' }"
    @close="close()"
  >
    <div class="mod-shell">
      <ModuleFormatDrawer v-model="show_format" :module-id="'timer_worship'" :manifest="manifest" />
      <div class="timer-layout">
        <div
          ref="container"
          class="tw-root"
          :style="rootStyle"
          data-testid="timer-worship-stage"
          :data-alert="alertLevel || 'none'"
        >
          <ModuleBackgroundMedia
            v-if="bgImage"
            :src="bgImage"
            class="tw-bg-img"
            :style="imageStyle"
          />

          <!-- Display -->
          <div
            class="tw-display"
            :class="{
              'tw-warning': mode === 'down' && alertActive && seconds > 0,
              'tw-critical': mode === 'down' && alertActive && seconds <= 10 && seconds > 0,
              'tw-done': mode === 'down' && seconds <= 0 && alarmed && !overtime,
            }"
            :style="[textStyle, displayColorStyle]"
            data-testid="timer-worship-display"
          >
            {{ projecao }}
          </div>
          <ModuleAlertFrame :level="flashBorders ? alertLevel : ''" />
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
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
import TimerEndActionDialogs from "@/components/TimerEndActionDialogs.vue";
import $userdata from "@/helpers/UserData";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { useTimerEndAction } from "@/composables/useTimerEndAction";
import Media from "@/composables/useMedia";
import { SABBATH_SCHOOL_SOUNDS } from "@/config/SabbathSchool";
import { MediaEnum } from "@/enums/MediaEnum";
import { ModuleEnum } from "@/enums/ModuleEnum";

type TimerMode = "up" | "down";

const { show_format } = useModuleFormat(ModuleEnum.TIMER_WORSHIP, manifest);
const { rootStyle, textStyle, alertStyle, bgImage, imageStyle, container } = useModuleBodyStyle(
  ModuleEnum.TIMER_WORSHIP
);
const endAction = useTimerEndAction(ModuleEnum.TIMER_WORSHIP, KEYS.MODULES.TIMER_WORSHIP);

const moduleContainer = ref<{ tm(key: string): string } | null>(null);
const tm = (key: string): string => moduleContainer.value?.tm(key) || key;

const mode = computed<TimerMode>({
  get: () => $userdata.get<TimerMode>(KEYS.MODULES.TIMER_WORSHIP.MODE, "down") ?? "down",
  set: (v: TimerMode) => $userdata.set(KEYS.MODULES.TIMER_WORSHIP.MODE, v),
});

const running = ref<boolean>(false);
const seconds = ref<number>(0);
const targetTime = computed<string>({
  get: () => {
    const v = $userdata.get<string>(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, "");
    return typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : getCurrentTimeValue();
  },
  set: (v: string) => $userdata.set(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, v),
});
const durationSeconds = ref<number>(0);
const startedAt = ref<number | null>(null);
const alarmed = ref<boolean>(false);

const showTargetTime = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SHOW_TARGET_TIME, true) ?? true
);

const showAlert = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SHOW_ALERT, true) ?? true
);

const alertSeconds = computed<number>(() =>
  Math.max(0, Number($userdata.get<number>(KEYS.MODULES.TIMER_WORSHIP.ALERT_SECONDS, 60)) || 60)
);

const alertActive = computed<boolean>(
  () =>
    mode.value === "down" &&
    showAlert.value &&
    seconds.value <= alertSeconds.value &&
    (seconds.value > 0 || alarmed.value)
);

let timer: ReturnType<typeof setInterval> | null = null;
let fiveMinFired = false;
let oneMinFired = false;

/** Amarelo do aviso — o mesmo da moldura e do Cronômetro. */
const WARNING_COLOR = "#F59E0B";

/*
 * Cor do número: amarelo nos segundos de destaque, a cor de alerta da
 * Formatação só depois do horário. Antes, o destaque já pintava de vermelho
 * enquanto a moldura ficava amarela.
 */
const displayColor = computed<string | undefined>(() => {
  if (!alertActive.value) return undefined;
  return seconds.value <= 0 ? alertStyle.value.color : WARNING_COLOR;
});
const displayColorStyle = computed(() =>
  displayColor.value ? { color: displayColor.value } : null
);

function setWarning(value: number): void {
  // "Não" desliga o destaque; os outros botões ligam e definem os segundos.
  $userdata.set(KEYS.MODULES.TIMER_WORSHIP.SHOW_ALERT, value > 0);
  if (value > 0) $userdata.set(KEYS.MODULES.TIMER_WORSHIP.ALERT_SECONDS, value);
}

const dockLabels = computed(() => ({
  mode: tm("ribbon.mode"),
  up: tm("mode.up"),
  down: tm("mode.down"),
  warning: tm("ribbon.warning"),
  warnings: ["off", "m1", "m2", "m5", "m10"].map((k) => tm(`warning.${k}`)),
}));

const overtime = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.COUNT_OVERTIME, true) !== false
);
const flashBorders = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.FLASH_BORDERS, true) !== false
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

const display = computed<string>(() => {
  const abs = Math.abs(seconds.value);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  // Negativo é tempo excedido: "-00:02:10".
  const sign = seconds.value < 0 ? "-" : "";
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
});

const projecao = computed<string>(() => {
  return showTargetTime.value ? `${display.value}\n${targetTime.value}` : display.value;
});

// Defaults sonoros — setIfNull garante que existam antes do primeiro uso
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_START, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_FIVE_MIN, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_ONE_MIN, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.END_ACTION, MediaEnum.NONE);

const selectedSound = computed<string>(
  () => $userdata.get(KEYS.MODULES.TIMER_WORSHIP.SELECTED_SOUND) as string
);

const projection = useModuleProjection(ModuleEnum.TIMER_WORSHIP, {
  onAction(action: string, payload?: unknown) {
    switch (action) {
      case "toggle":
        toggle();
        break;
      case "reset":
        reset();
        break;
      case "set_time":
        setTimeFromPayload(payload);
        break;
      case "format":
        show_format.value = !show_format.value;
        break;
      case "play_sound":
        {
          const sound = Object.values(SABBATH_SCHOOL_SOUNDS).find(
            (s) => s.id === selectedSound.value
          );
          if (sound) {
            void playMp3(selectedSound.value);
            return;
          }
        }
        break;
      case "file_audio":
        endAction.handleFileAudio();
        break;
      case "file_video":
        endAction.handleFileVideo();
        break;
      case "online_video":
        endAction.handleOnlineVideo();
        break;
      case "music":
        endAction.handleMusic();
        break;
    }
  },
});

async function playMp3(id: string): Promise<void> {
  const sound = SABBATH_SCHOOL_SOUNDS[id.toUpperCase()];
  if (!sound) return;
  try {
    await Media.openAudio({
      url: sound.url,
      title: tm(sound.label.split(".").slice(2).join(".")),
    });
  } catch {
    /* noop */
  }
}

function playSoundStart(): void {
  playMp3(SABBATH_SCHOOL_SOUNDS.OPENING.id);
}

function playSoundFiveMin(): void {
  playMp3(SABBATH_SCHOOL_SOUNDS.FIVE_MINUTES.id);
}

function playSoundOneMin(): void {
  playMp3(SABBATH_SCHOOL_SOUNDS.ONE_MINUTE.id);
}

watch(mode, () => reset());

function setTimeFromPayload(payload: unknown): void {
  const value = (payload as { url?: string } | null)?.url;
  if (!value) return;
  if (!/^\d{1,2}:\d{2}$/.test(value)) return;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return;
  targetTime.value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  reset();
}

watch(
  [projecao, alertActive, alertLevel, flashBorders],
  () => {
    projection.emit({
      text: projecao.value,
      active: true,
      color: displayColor.value,
      alert: flashBorders.value && alertLevel.value ? alertLevel.value : undefined,
    });
  },
  { immediate: true }
);

function getCurrentTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getTargetDate(): Date {
  const [hours, minutes] = targetTime.value.split(":").map(Number);
  const target = new Date();
  target.setHours(hours || 0, minutes || 0, 0, 0);
  return target;
}

/*
 * Segundos até o horário. Já passou há até 12 h: é o horário de hoje que
 * passou (negativo). Passou há mais que isso: é o de amanhã (ex.: 01:00
 * definido às 23:00). Antes, qualquer horário já passado virava o de amanhã,
 * e Reiniciar depois do sermão mostrava 23:59:xx no telão.
 */
function secondsUntilTarget(): number {
  const now = Date.now();
  const target = getTargetDate();
  if (now - target.getTime() > 12 * 3600 * 1000) target.setDate(target.getDate() + 1);
  return Math.ceil((target.getTime() - now) / 1000);
}

function getDurationUntilTarget(): number {
  return Math.max(0, secondsUntilTarget());
}

function updateFromTargetTime(): void {
  alarmed.value = false;
  durationSeconds.value = getDurationUntilTarget();
  seconds.value = mode.value === "down" ? durationSeconds.value : 0;
}

function updateRunningTime(): void {
  if (!startedAt.value) return;

  const elapsedSeconds = Math.floor((Date.now() - startedAt.value) / 1000);

  if (mode.value === "up") {
    seconds.value = Math.min(elapsedSeconds, durationSeconds.value);
    if (seconds.value >= durationSeconds.value && !alarmed.value) {
      alarmed.value = true;
      pause();
      endAction.triggerTimerEndAction();
    }
    return;
  }

  const left = durationSeconds.value - elapsedSeconds;
  seconds.value = overtime.value ? left : Math.max(left, 0);

  if (left <= 0) {
    if (!alarmed.value) {
      alarmed.value = true;
      // Com tempo excedido a contagem segue (-00:00:01…); sem ele, para no zero.
      if (!overtime.value) pause();
      endAction.triggerTimerEndAction();
    }
    return;
  }

  if (mode.value === "down" && !alarmed.value) {
    const remaining = seconds.value;

    if (
      $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SOUND_FIVE_MIN) &&
      !fiveMinFired &&
      remaining <= 300 &&
      remaining > 60
    ) {
      fiveMinFired = true;
      playSoundFiveMin();
    }

    if (
      $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SOUND_ONE_MIN) &&
      !oneMinFired &&
      remaining <= 60 &&
      remaining > 0
    ) {
      oneMinFired = true;
      playSoundOneMin();
    }
  }
}

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
  const resumingOvertime = alarmed.value && overtime.value && mode.value === "down";
  alarmed.value = resumingOvertime;
  fiveMinFired = resumingOvertime;
  oneMinFired = resumingOvertime;
  // Regressivo aceita horário já passado: começa direto no excedido (ou no zero).
  durationSeconds.value = mode.value === "down" ? secondsUntilTarget() : getDurationUntilTarget();
  startedAt.value = Date.now();
  seconds.value = mode.value === "down" ? durationSeconds.value : 0;
  running.value = true;
  $userdata.set(KEYS.MODULES.TIMER_WORSHIP.RUNNING, true);

  if (!resumingOvertime && $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SOUND_START))
    playSoundStart();

  timer = setInterval(updateRunningTime, 1000);
}

function pause(): void {
  running.value = false;
  $userdata.set(KEYS.MODULES.TIMER_WORSHIP.RUNNING, false);
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function reset(): void {
  pause();
  startedAt.value = null;
  alarmed.value = false;
  fiveMinFired = false;
  oneMinFired = false;
  updateFromTargetTime();
}

// Fechar zera: com a contagem só pausada, a borda de aviso ficava no telão.
// O horário continua salvo, então reabrir e iniciar retoma do ponto certo.
function close(): void {
  reset();
}

/*
 * O X da aba fecha o módulo por Modules.close(), sem passar pelo @close do
 * ModuleContainer — e o componente segue vivo no KeepAlive. Sem isto, a
 * contagem continuava escondida e a borda ficava pulsando no telão.
 */
watch(
  () => $appdata.get(`modules.timer_worship.show`),
  (shown) => {
    if (shown === false) close();
  }
);

// Fechar o app com a contagem rodando deixava a chave em "true", e o botão da
// ribbon abria em "Pausar" sem nada contando.
$userdata.set(KEYS.MODULES.TIMER_WORSHIP.RUNNING, false);

onBeforeUnmount(() => {
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
.tw-root {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  flex-grow: 1;
  gap: 16px;
}
.tw-display {
  position: relative;
  z-index: 1;
  font-size: 3.5rem;
  font-weight: 300;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  transition: color var(--lj-transition-slow);
  white-space: pre-line;
}
.tw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
.tw-warning {
  color: #f59e0b;
}
.tw-critical {
  color: #e67e22;
}
.tw-done {
  color: #ef4444;
  animation: tw-pulse 0.8s ease-in-out infinite alternate;
}
@keyframes tw-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
</style>
