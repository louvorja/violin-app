<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '320px' }"
    @close="close()"
    @show="onModuleShow"
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
            <span class="tw-display__time">{{ display }}</span>
            <span
              v-if="extraLines"
              class="tw-display__clock"
              :style="[clockColorStyle, displayColorStyle]"
              data-testid="timer-worship-extra"
            >
              {{ extraLines }}
            </span>
          </div>
          <ModuleAlertFrame :level="flashBorders ? alertLevel : ''" :color="displayColor" />
        </div>
        <ModuleTimerDock
          :mode="mode"
          :warning-seconds="showAlert ? alertSeconds : 0"
          :warnings="DOCK_WARNINGS"
          custom-warning
          :labels="dockLabels"
          @update:mode="mode = $event"
          @update:warning-seconds="setWarning"
        >
          <!-- ±1/5/10 min ao vivo, sem parar nem zerar a contagem. -->
          <div class="tw-adjust" role="group" :aria-label="tm('screen.adjust')">
            <LjButton
              v-for="step in ADJUST_STEPS"
              :key="step"
              size="sm"
              variant="subtle"
              :data-testid="`timer-worship-adjust-${step > 0 ? 'plus' : 'minus'}-${Math.abs(step)}`"
              @click="adjustMinutes(step)"
            >
              {{ step > 0 ? "+" : "−" }}{{ Math.abs(step) }} min
            </LjButton>
          </div>
        </ModuleTimerDock>
      </div>
    </div>

    <TimerEndActionDialogs :end-action="endAction" />
    <SoundsDialog v-model="showSounds" @preview="playCue" />
  </ModuleContainer>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import ModuleAlertFrame from "@/components/ModuleAlertFrame.vue";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
import TimerEndActionDialogs from "@/components/TimerEndActionDialogs.vue";
import SoundsDialog from "./SoundsDialog.vue";
import { LjButton } from "@/components/ui";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { useTimerEndAction } from "@/composables/useTimerEndAction";
import Media from "@/composables/useMedia";
import { MediaEnum } from "@/enums/MediaEnum";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { formatTimerSeconds, timerProjectionText } from "@/helpers/TimerText";
import {
  adjust,
  createCountdownState,
  endTimeText,
  overtimeTurnedOff,
  pause as pauseCountdown,
  refreshIdle,
  reset as resetCountdown,
  start as startCountdown,
  tick,
  type CountdownConfig,
  type CountdownEvent,
  type CountdownMode,
} from "../countdown";
import {
  DEFAULT_DURATION_MINUTES,
  worshipDefineBy,
  worshipDurationMinutes,
  worshipExtraLines,
  worshipSecondLine,
  worshipTargetTime,
} from "../projectionText";
import { ENABLED_KEYS, resolveCueSound, type WorshipCue } from "../sounds";

const { show_format, fmt } = useModuleFormat(ModuleEnum.TIMER_WORSHIP, manifest);
const { rootStyle, textStyle, alertStyle, warningStyle, bgImage, imageStyle, container } =
  useModuleBodyStyle(ModuleEnum.TIMER_WORSHIP);
const endAction = useTimerEndAction(ModuleEnum.TIMER_WORSHIP, KEYS.MODULES.TIMER_WORSHIP);

const moduleContainer = ref<{ tm(key: string): string } | null>(null);
const tm = (key: string): string => moduleContainer.value?.tm(key) || key;

const mode = computed<CountdownMode>({
  get: () => $userdata.get<CountdownMode>(KEYS.MODULES.TIMER_WORSHIP.MODE, "down") ?? "down",
  set: (v: CountdownMode) => $userdata.set(KEYS.MODULES.TIMER_WORSHIP.MODE, v),
});

const targetTime = computed<string>({
  get: () => worshipTargetTime(),
  set: (v: string) => $userdata.set(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, v),
});
const defineBy = computed(() => worshipDefineBy());
const durationMinutes = computed(() => worshipDurationMinutes());
const overtime = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.COUNT_OVERTIME, true) !== false
);
const flashBorders = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.FLASH_BORDERS, true) !== false
);

const config = computed<CountdownConfig>(() => ({
  mode: mode.value,
  defineBy: defineBy.value,
  target: targetTime.value,
  durationMinutes: durationMinutes.value,
  overtime: overtime.value,
}));

/*
 * A contagem mora em `countdown.ts` (contas puras, testadas com relógio
 * falso); aqui ficam só a tela, o telão e os sons.
 */
const state = reactive(createCountdownState());
const seconds = computed(() => state.seconds);
const alarmed = computed(() => state.alarmed);

/*
 * Um único "despertador" alinhado à virada do segundo do relógio do sistema,
 * como o `escSBTempo` do Classic: cada tick lê a hora UMA vez e dela saem o
 * relógio e a contagem. Com dois setInterval independentes cada linha virava
 * o segundo num momento diferente, e um tick rente à virada pulava um segundo.
 */
const now = ref<Date>(new Date());
let tickHandle: ReturnType<typeof setTimeout> | null = null;
let disposed = false;
function scheduleTick(): void {
  if (disposed) return;
  // ~15 ms depois da virada, longe da fronteira do segundo.
  const delay = 1000 - (Date.now() % 1000) + 15;
  tickHandle = setTimeout(() => {
    const t = Date.now();
    now.value = new Date(t);
    handleEvents(tick(state, config.value, t));
    scheduleTick();
  }, delay);
}
refreshIdle(state, config.value, Date.now());
scheduleTick();

const showAlert = computed<boolean>(
  () => $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SHOW_ALERT, true) ?? true
);

const alertSeconds = computed<number>(() =>
  Math.max(0, Number($userdata.get<number>(KEYS.MODULES.TIMER_WORSHIP.ALERT_SECONDS, 60)) || 60)
);

const alertActive = computed<boolean>(
  () =>
    mode.value === "down" &&
    state.started &&
    showAlert.value &&
    seconds.value <= alertSeconds.value &&
    (seconds.value > 0 || state.alarmed)
);

/*
 * Cor do número (e da moldura): "Cor do aviso" nos segundos de destaque,
 * "Cor do alerta" só depois do horário — as duas da Formatação.
 */
const displayColor = computed<string | undefined>(() => {
  // Passou do horário: vermelho mesmo com o aviso em "Não".
  if (mode.value === "down" && seconds.value <= 0 && state.alarmed && state.started) {
    return alertStyle.value.color;
  }
  return alertActive.value ? warningStyle.value.color : undefined;
});
const displayColorStyle = computed(() =>
  displayColor.value ? { color: displayColor.value } : null
);

/** Cor própria do relógio; desligada, o texto continua com `font_color`. */
const clockColor = computed<string | undefined>(() => {
  if (!fmt.clock_color_enabled) return undefined;
  const value = typeof fmt.clock_color === "string" ? fmt.clock_color.trim() : "";
  return value || undefined;
});
const clockColorStyle = computed(() => (clockColor.value ? { color: clockColor.value } : null));

/** Aviso/alerta manda mais que a cor própria; sem eles, vale a do relógio. */
const clockLineColor = computed<string | undefined>(
  () => displayColor.value || clockColor.value || undefined
);

function setWarning(value: number): void {
  // "Não" desliga o destaque; os outros botões ligam e definem os segundos.
  $userdata.set(KEYS.MODULES.TIMER_WORSHIP.SHOW_ALERT, value > 0);
  if (value > 0) $userdata.set(KEYS.MODULES.TIMER_WORSHIP.ALERT_SECONDS, value);
}

/** Personalizado, 30 s e os minutos; "Não" fica no fim para desligar o aviso. */
const DOCK_WARNINGS = [30, 60, 120, 300, 600, 0] as const;

const dockLabels = computed(() => ({
  mode: tm("ribbon.mode"),
  up: tm("mode.up"),
  down: tm("mode.down"),
  warning: tm("ribbon.warning"),
  warnings: ["m30", "m1", "m2", "m5", "m10", "off"].map((k) => tm(`warning.${k}`)),
  custom: tm("warning.custom"),
  customPlaceholder: tm("warning.custom_placeholder"),
}));

/*
 * Aviso de tempo para a moldura (tela e telão): amarelo nos segundos de
 * destaque, vermelho depois do zero. Só com a contagem iniciada — parado,
 * mesmo perto do horário, nada pisca no telão.
 */
const alertLevel = computed<"" | "warning" | "danger">(() => {
  if (mode.value !== "down" || !state.started) return "";
  if (seconds.value <= 0) return state.alarmed ? "danger" : "";
  return alertActive.value ? "warning" : "";
});

const display = computed<string>(() => formatTimerSeconds(seconds.value));

/** Linha(s) abaixo da contagem: término, relógio atual ou os dois. */
const extraLines = computed<string>(() =>
  worshipExtraLines(endTimeText(state, config.value, now.value.getTime()), now.value)
);

const projecao = computed<string>(() =>
  timerProjectionText(display.value, extraLines.value !== "", extraLines.value)
);

// Defaults — setIfNull garante que existam antes do primeiro uso.
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_START, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_FIVE_MIN, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SOUND_ONE_MIN, true);
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.END_ACTION, MediaEnum.NONE);
// As opções novas nascem como era antes: hora de término, sem relógio.
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.DEFINE_BY, "end");
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.DURATION_MINUTES, DEFAULT_DURATION_MINUTES);
// O seletor "Exibir" nasce do que a antiga caixinha "Exibir hora" dizia.
$userdata.setIfNull(KEYS.MODULES.TIMER_WORSHIP.SECOND_LINE, worshipSecondLine());

const showSounds = ref(false);

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
      case "sounds":
        showSounds.value = true;
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
      default: {
        // adjust_plus_5, adjust_minus_1… — ajuste ao vivo, sem zerar.
        const match = /^adjust_(plus|minus)_(\d+)$/.exec(action);
        if (match) adjustMinutes((match[1] === "plus" ? 1 : -1) * Number(match[2]));
      }
    }
  },
});

const CUE_TITLES: Record<WorshipCue, string> = {
  start: "sound.start",
  five: "sound.five_min",
  one: "sound.one_min",
};

/** Toca o áudio do aviso: o escolhido na Biblioteca de Mídia ou o que vem com o programa. */
async function playCue(cue: WorshipCue): Promise<void> {
  try {
    const sound = await resolveCueSound(cue, tm(CUE_TITLES[cue]));
    await Media.openAudio({ url: sound.url, title: sound.title });
  } catch {
    /* noop */
  }
}

function cueEnabled(cue: WorshipCue): boolean {
  return $userdata.get<boolean>(ENABLED_KEYS[cue]) === true;
}

function handleEvents(events: CountdownEvent[]): void {
  for (const event of events) {
    if (event === "end") {
      endAction.triggerTimerEndAction();
    } else if (cueEnabled(event)) {
      void playCue(event);
    }
  }
}

/*
 * Trocar o modo ou o "Definir por" recomeça; mudar o horário ou a duração com
 * a contagem parada só atualiza a prévia.
 */
watch(mode, () => reset());
watch(defineBy, () => reset());
watch([targetTime, durationMinutes], () => {
  if (!state.started) refreshIdle(state, config.value, Date.now());
});

/*
 * Desligar o excedido no meio dele precisa parar a contagem em 00:00:00; sem
 * isto o botão ficava em "Pausar" com o display congelado.
 */
watch(overtime, (on) => {
  if (!on) overtimeTurnedOff(state, config.value, Date.now());
});

watch(
  () => state.running,
  (value) => $userdata.set(KEYS.MODULES.TIMER_WORSHIP.RUNNING, value)
);

function setTimeFromPayload(payload: unknown): void {
  const value = (payload as { url?: string } | null)?.url;
  if (!value) return;
  if (!/^\d{1,2}:\d{2}$/.test(value)) return;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return;
  targetTime.value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  reset();
}

/** Na barra de baixo, em ordem: −10 −5 −1 +1 +5 +10. */
const ADJUST_STEPS = [-10, -5, -1, 1, 5, 10] as const;

/** Botões ±1/5/10 min: somam ou tiram tempo sem parar nem zerar. */
function adjustMinutes(delta: number): void {
  const result = adjust(state, config.value, delta, Date.now());
  if (result.target) targetTime.value = result.target;
  if (result.durationMinutes) {
    $userdata.set(KEYS.MODULES.TIMER_WORSHIP.DURATION_MINUTES, result.durationMinutes);
  }
}

const projectionActive = ref(true);

function emitProjection(): void {
  projection.emit({
    text: projectionActive.value ? projecao.value : "",
    active: projectionActive.value,
    color: projectionActive.value ? displayColor.value : undefined,
    clockColor: projectionActive.value ? clockLineColor.value : undefined,
    alert:
      projectionActive.value && flashBorders.value && alertLevel.value
        ? alertLevel.value
        : undefined,
  });
}

watch(
  [projecao, alertActive, alertLevel, flashBorders, clockLineColor, projectionActive],
  emitProjection,
  { immediate: true }
);

function toggle(): void {
  if (state.running) pause();
  else start();
}

function start(): void {
  // Retomar não toca a abertura de novo: o "start" só vem ao começar do zero.
  handleEvents(startCountdown(state, config.value, Date.now()));
}

function pause(): void {
  pauseCountdown(state, config.value, Date.now());
}

function reset(): void {
  resetCountdown(state, config.value, Date.now());
}

// Fechar zera a contagem e tira o módulo do telão. O horário continua salvo,
// então reabrir e iniciar retoma do ponto certo.
function close(): void {
  if (!projectionActive.value && !state.running) return;
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
$userdata.set(KEYS.MODULES.TIMER_WORSHIP.RUNNING, false);

onBeforeUnmount(() => {
  projection.emit({ active: false, text: "" });
  disposed = true;
  if (tickHandle !== null) clearTimeout(tickHandle);
  tickHandle = null;
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
.tw-display__time,
.tw-display__clock {
  display: block;
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
.tw-adjust {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
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
