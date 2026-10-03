import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  closeProjectionWindows,
  controlPresentationScreens,
  openMediaWindow,
} from "@/helpers/ProjectionWindows";
import { close as closeProjection } from "@/helpers/Projection";
import { closingOnPurpose } from "@/composables/useProjectionShutdown";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { isWebWindowOpen } from "@/helpers/projection/webWindow";
import { PROJECTION_TYPE } from "@/constants/Projection";
import { KEYS } from "@/constants/UserDataKeys";
import $appdata from "@/helpers/AppData";
import { useDisplays } from "@/composables/useDisplays";
import { useReturnPlayer } from "./useReturnPlayer";
import { useLiveContent } from "./useLiveContent";

/**
 * As duas saídas do Modo apresentação: a tela principal e o retorno de palco.
 *
 * "Tela principal" não é uma janela só: música, Bíblia, arquivo e vídeo
 * on-line abrem cada um a sua no mesmo monitor — e o retorno também tem uma
 * por conteúdo. Cada saída está no ar se qualquer janela dela estiver aberta.
 * Projeção de fundo e anúncios têm botão próprio nos seus módulos.
 *
 * A tela limpa é estado da janela principal, anunciado às janelas de
 * projeção. Quem responde às janelas recém-abertas é um ouvinte fixo, e não o
 * componente: o módulo fica em KeepAlive e os ouvintes do componente pausam
 * quando o operador troca de aba — justo quando uma janela pode abrir.
 */

const MAIN_SCREEN_FEATURES = [
  PROJECTION_TYPE.MUSIC,
  PROJECTION_TYPE.BIBLE,
  PROJECTION_TYPE.FILE,
  PROJECTION_TYPE.ONLINE_VIDEO,
];
const RETURN_FEATURES = [
  PROJECTION_TYPE.RETURN,
  PROJECTION_TYPE.FILE_RETURN,
  PROJECTION_TYPE.ONLINE_VIDEO_RETURN,
  PROJECTION_TYPE.BACKGROUND_RETURN,
  PROJECTION_TYPE.BIBLE_RETURN,
];

/** Janelas abertas não avisam quando fecham sozinhas; o botão Projetar também pergunta a cada 2 s. */
const POLL_MS = 2000;

const _cleared = ref(false);
export { _cleared as cleared };

/** Imagem ou vídeo só no retorno de palco (letra, recado). */
export interface ReturnOverride {
  type: "image" | "video";
  url: string;
  title: string;
  /** Caminho no disco, para a biblioteca marcar o arquivo. */
  path: string;
  /** Identidade desta exibição: o relógio do vídeo só vale para ela. */
  id: string;
}
/** O que se pede para levar ao retorno; a identidade é dada ao mostrar. */
export type ReturnTarget = Omit<ReturnOverride, "id">;
const _returnOverride = ref<ReturnOverride | null>(null);
export { _returnOverride as returnOverride };
const _mainOpen = ref(false);
const _returnOpen = ref(false);
/**
 * Quais telas o operador ligou: estado dele, mudado por Iniciar/Parar e pelo
 * liga/desliga de cada tela. As janelas são o efeito — trocar a música por um
 * vídeo fecha uma e abre outra, e isso não pode parecer que a tela desligou.
 */
export type Screen = "main" | "stage";
const _on = ref<Record<Screen, boolean>>({ main: false, stage: false });
const _presenting = computed(() => _on.value.main || _on.value.stage);
const _showing = _presenting;

// Com a aba do módulo à vista, as janelas automáticas seguem as telas ligadas:
// desligada, nada abre sozinho nela. Nas outras abas, valem as opções de sempre.
controlPresentationScreens(() =>
  $appdata.get<string>(KEYS.SHELL.ACTIVE_MODULE, "") === ModuleEnum.PRESENTATION_MODE ? { ..._on.value } : null
);
/** Janela que sumiu com a apresentação iniciada (Esc no telão, monitor desligado). */
const _mainMissing = ref(false);
const _stageMissing = ref(false);
/** Leituras seguidas sem a janela: uma só é a troca de conteúdo no meio. */
let _missingStreak = { main: 0, stage: 0 };
const _busy = ref(false);
let _responderInstalled = false;

function _installResponder(): void {
  if (_responderInstalled) return;
  _responderInstalled = true;
  Broadcast.listen(
    (msg) => {
      if (msg.type === BROADCAST_TYPE.REQUEST_PROJECTION_CLEAR) {
        Broadcast.send(BROADCAST_TYPE.PROJECTION_CLEAR, { active: _cleared.value });
      } else if (msg.type === BROADCAST_TYPE.REQUEST_RETURN_OVERRIDE) {
        Broadcast.send(BROADCAST_TYPE.RETURN_OVERRIDE, _overridePayload());
      } else if (
        msg.type === BROADCAST_TYPE.RETURN_OVERRIDE &&
        (msg.payload as { active?: boolean } | null)?.active === false
      ) {
        // O Esc limpa o retorno pelo Broadcast: o estado daqui acompanha.
        if (_returnOverride.value) {
          _returnOverride.value = null;
          useReturnPlayer().stop();
        }
      }
    },
    { replay: false }
  );
}

async function _openFeatures(): Promise<string[]> {
  if (Platform.isDesktop && Platform.windows?.listOpen) {
    try {
      return (await Platform.windows.listOpen()) as string[];
    } catch {
      /* cai no caminho da web */
    }
  }
  return [...MAIN_SCREEN_FEATURES, ...RETURN_FEATURES].filter((f) => isWebWindowOpen(f));
}

/**
 * O ribbon habilita Iniciar, Parar e Limpar tela pelo que dá para fazer
 * agora — ele lê o AppData, não os refs daqui.
 */
function _publish(): void {
  const idle = !_busy.value;
  $appdata.set(KEYS.MODULES.PRESENTATION_MODE.CAN_START, idle && !(_on.value.main && _on.value.stage));
  $appdata.set(KEYS.MODULES.PRESENTATION_MODE.CAN_STOP, idle && _presenting.value);
  $appdata.set(KEYS.MODULES.PRESENTATION_MODE.CAN_CLEAR, _presenting.value && !_cleared.value);
}

/** Alguma tela de projeção (principal ou retorno) está aberta agora. */
export async function anyScreenOpen(): Promise<boolean> {
  const open = await _openFeatures();
  return [...MAIN_SCREEN_FEATURES, ...RETURN_FEATURES].some((f) => open.includes(f));
}

const MISSING_AFTER_READS = 2;

export async function refreshShowing(): Promise<void> {
  const open = await _openFeatures();
  _mainOpen.value = MAIN_SCREEN_FEATURES.some((f) => open.includes(f));
  _returnOpen.value = RETURN_FEATURES.some((f) => open.includes(f));
  if (!_busy.value) {
    // Tela aberta sem ter sido ligada aqui (o módulo recarregou, ou o operador
    // abriu pela liturgia): ela está, de fato, ligada.
    if (_mainOpen.value && !_on.value.main) _setOn("main", true);
    if (_returnOpen.value && !_on.value.stage) _setOn("stage", true);
    _missingStreak = {
      main: _on.value.main && !_mainOpen.value ? _missingStreak.main + 1 : 0,
      stage: _on.value.stage && !_returnOpen.value ? _missingStreak.stage + 1 : 0,
    };
    _mainMissing.value = _missingStreak.main >= MISSING_AFTER_READS;
    _stageMissing.value = _missingStreak.stage >= MISSING_AFTER_READS;
    // Todas as telas ligadas sumiram (Esc no telão): o operador encerrou por lá.
    const allGone =
      _presenting.value &&
      (!_on.value.main || _mainMissing.value) &&
      (!_on.value.stage || _stageMissing.value);
    if (allGone) {
      _setOn("main", false);
      _setOn("stage", false);
    }
  }
  _publish();
}

function _setOn(screen: Screen, on: boolean): void {
  _on.value = { ..._on.value, [screen]: on };
  _missingStreak = { ..._missingStreak, [screen]: 0 };
  if (screen === "main") _mainMissing.value = false;
  else _stageMissing.value = false;
}

/** As janelas do que está no ar: o vídeo reabre as do arquivo, não as da música. */
function _liveMedia(): "music" | "file" | "video" {
  const kind = useLiveContent().current.value;
  return kind === "file" || kind === "announcements" ? "file" : kind === "online_video" ? "video" : "music";
}

/** Abre as telas ligadas que não estão abertas, sem cobrir a que está no ar. */
async function _openMissing(): Promise<void> {
  await refreshShowing();
  const media = _liveMedia();
  if (_on.value.main && !_mainOpen.value) await openMediaWindow("projection", media, { explicit: true });
  if (_on.value.stage && !_returnOpen.value) await openMediaWindow("return", media, { explicit: true });
}

/** Fecha todas as janelas de uma tela (música, Bíblia, arquivo, vídeo). */
async function _closeScreen(screen: Screen): Promise<void> {
  const features = screen === "main" ? MAIN_SCREEN_FEATURES : RETURN_FEATURES;
  const open = await _openFeatures();
  // A outra tela segue com o mesmo conteúdo: o fechamento não pode desfazê-lo.
  await Promise.all(
    features
      .filter((f) => open.includes(f))
      .map((f) => {
        closingOnPurpose(f);
        return closeProjection(f);
      })
  );
}

/** O retorno esconde o que está no ar (o tipo foi ocultado no retorno): fica o fundo. */
const _returnBlank = ref(false);
export { _returnBlank as returnBlank };

/** O que o operador mandou só ao retorno vence; senão, o fundo, se o tipo no ar está oculto. */
function _overridePayload(): Record<string, unknown> {
  const o = _returnOverride.value;
  if (o) return { active: true, type: o.type, url: o.url, title: o.title, id: o.id };
  return _returnBlank.value ? { active: true, type: "blank" } : { active: false };
}

export function setReturnBlank(blank: boolean): void {
  if (_returnBlank.value === blank) return;
  _installResponder();
  _returnBlank.value = blank;
  Broadcast.send(BROADCAST_TYPE.RETURN_OVERRIDE, _overridePayload());
}

/**
 * Leva a imagem ou o vídeo só para o retorno. Abre a janela de retorno se
 * ela estiver fechada — o operador escolheu mostrar algo no palco.
 */
export async function showOnReturn(override: ReturnTarget | null): Promise<void> {
  _installResponder();
  const id = crypto.randomUUID();
  _returnOverride.value = override && { ...override, id };
  // Vídeo só no retorno toca pelo player daqui (com som); o retorno acompanha mudo.
  const player = useReturnPlayer();
  if (override?.type === "video") player.start({ id, url: override.url, title: override.title });
  else player.stop();
  Broadcast.send(BROADCAST_TYPE.RETURN_OVERRIDE, _overridePayload());
  if (!override) return;
  const open = await _openFeatures();
  if (!RETURN_FEATURES.some((f) => open.includes(f))) {
    try {
      await openMediaWindow("return", "music", { explicit: true });
    } catch (e) {
      Telemetry.captureException(e, { source: "presentation_mode.outputs.return_override" });
    }
  }
  Telemetry.track("presentation_return_override", { type: override.type });
}

export function setCleared(value: boolean): void {
  _installResponder();
  _cleared.value = value;
  Broadcast.send(BROADCAST_TYPE.PROJECTION_CLEAR, { active: value });
  _publish();
}

export async function startOutputs(): Promise<void> {
  if (_busy.value) return;
  _busy.value = true;
  _publish();
  try {
    _setOn("main", true);
    _setOn("stage", true);
    // Só abre a saída que falta: a janela da música por cima de um vídeo no ar
    // cobriria o vídeo com o fundo.
    await _openMissing();
    Telemetry.track("presentation_outputs_started", {});
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.outputs.start" });
  } finally {
    _busy.value = false;
    await refreshShowing();
  }
}

export async function stopOutputs(): Promise<void> {
  if (_busy.value) return;
  _busy.value = true;
  _publish();
  try {
    _setOn("main", false);
    _setOn("stage", false);
    await closeProjectionWindows();
    if (_cleared.value) setCleared(false);
    Telemetry.track("presentation_outputs_stopped", {});
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.outputs.stop" });
  } finally {
    _busy.value = false;
    await refreshShowing();
  }
}

/** Liga ou desliga uma tela só; a outra continua como está. */
export async function setScreen(screen: Screen, on: boolean): Promise<void> {
  if (_busy.value) return;
  _busy.value = true;
  _publish();
  try {
    _setOn(screen, on);
    if (on) await _openMissing();
    else await _closeScreen(screen);
    if (!_presenting.value && _cleared.value) setCleared(false);
    Telemetry.track("presentation_screen_toggled", { screen, on });
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.outputs.screen" });
  } finally {
    _busy.value = false;
    await refreshShowing();
  }
}

/** Reabre a tela que sumiu durante a apresentação. */
export async function reopenOutputs(): Promise<void> {
  if (_busy.value) return;
  _busy.value = true;
  try {
    await _openMissing();
    Telemetry.track("presentation_outputs_reopened", { main: _mainMissing.value, stage: _stageMissing.value });
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.outputs.reopen" });
  } finally {
    _busy.value = false;
    _missingStreak = { main: 0, stage: 0 };
    await refreshShowing();
  }
}

export function useOutputs() {
  _installResponder();
  const { displays, roles } = useDisplays();

  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    void refreshShowing();
    timer = setInterval(() => void refreshShowing(), POLL_MS);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
    // Fechar o módulo não pode deixar o telão preso no fundo nem o retorno
    // preso num conteúdo que ninguém mais controla.
    if (_cleared.value) setCleared(false);
    if (_returnOverride.value) void showOnReturn(null);
  });

  /** Número do monitor do papel ("projection" / "stage"), ou `null` sem monitor. */
  function monitorNumber(role: string): number | null {
    const displayId = roles.value.find((r) => r.role === role)?.displayId;
    if (displayId == null) return null;
    const display = displays.value.find((d) => String(d.id) === String(displayId));
    return display?.number ?? null;
  }

  const mainMonitor = computed(() => monitorNumber("projection"));
  const stageMonitor = computed(() => monitorNumber("stage"));

  return {
    cleared: _cleared,
    showing: _showing,
    busy: _busy,
    mainMonitor,
    stageMonitor,
    screenOn: _on,
    setScreen,
    mainMissing: _mainMissing,
    stageMissing: _stageMissing,
    start: startOutputs,
    stop: stopOutputs,
    reopen: reopenOutputs,
    toggleCleared: () => setCleared(!_cleared.value),
  };
}
