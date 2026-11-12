/** @category deve-virar-composable — Integra os controles do sistema ao player (Pinia). */
import { watch, type WatchStopHandle } from "vue";
import AppData from "@/helpers/AppData";
import Media from "@/composables/useMedia";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import { KEYS } from "@/constants/UserDataKeys";

const CONFIG = KEYS.MODULES.MEDIA.CONFIG;
const ACTIONS = ["play", "pause"] as const;
let stopWatching: WatchStopHandle | null = null;
let session: MediaSession | null = null;
const registered = new Set<(typeof ACTIONS)[number]>();

function hasPlayback(): boolean {
  const source = AppData.get(CONFIG.AUDIO);
  return (
    (typeof source === "string" && source.length > 0) ||
    AppData.get(CONFIG.IS_YOUTUBE) === true ||
    AppData.get(CONFIG.VIDEO_FILE) === true
  );
}

function isPaused(): boolean {
  return AppData.get<boolean>(CONFIG.IS_PAUSED, true) !== false;
}

function control(action: (typeof ACTIONS)[number]): void {
  if (!hasPlayback() || AppData.get(KEYS.MODULES.MEDIA.LOADING)) return;

  // No fade-out o elemento ainda toca. O sistema pode interpretar o segundo
  // Play/Pause como outro "pause", mesmo com playbackState="paused".
  // Durante a transição, o próximo toque inverte o pedido, como o Space.
  const pause = useAudioPlayback().isFading.value ? !isPaused() : action === "pause";
  if (pause === isPaused()) return;
  if (pause) Media.pause();
  else Media.play();
}

function release(): void {
  for (const action of registered) {
    try {
      session?.setActionHandler(action, null);
    } catch {
      // A API pode existir sem suporte a todos os controles.
    }
  }
  registered.clear();
}

/** Só a janela principal instala os handlers; a projeção não controla o áudio. */
function init(): void {
  if (stopWatching || typeof navigator === "undefined" || !navigator.mediaSession) return;
  session = navigator.mediaSession;
  if (typeof session.setActionHandler !== "function") {
    session = null;
    return;
  }

  stopWatching = watch(
    () => [hasPlayback(), isPaused()] as const,
    ([available, paused]) => {
      if (available) {
        for (const action of ACTIONS) {
          if (registered.has(action)) continue;
          try {
            session?.setActionHandler(action, () => control(action));
            registered.add(action);
          } catch {
            // Sem suporte, preserva o controle nativo do navegador.
          }
        }
      } else {
        release();
      }
      if (session) session.playbackState = available ? (paused ? "paused" : "playing") : "none";
    },
    { immediate: true, flush: "sync" }
  );
}

function destroy(): void {
  stopWatching?.();
  stopWatching = null;
  release();
  if (session) session.playbackState = "none";
  session = null;
}

export default { init, destroy };
