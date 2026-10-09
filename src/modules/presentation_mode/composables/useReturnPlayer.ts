import { reactive } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry from "@/helpers/Telemetry";
import { applyMediaCors } from "@/composables/useAudioPlayback";

/**
 * O vídeo que está só no retorno de palco, tocado com som aqui, na janela
 * principal, como o player do operador: o som sai pela mesma saída de áudio
 * do culto, e o operador pausa, volta e vê quanto falta. As janelas de
 * retorno tocam o mesmo arquivo mudo e acompanham o relógio que daqui sai.
 */

/** Com o vídeo tocando, o relógio vai ao retorno duas vezes por segundo. */
const TICK_MS = 500;

const state = reactive({
  /** Identidade do override no retorno; o relógio só vale para ele. */
  id: null as string | null,
  title: "",
  currentTime: 0,
  duration: 0,
  paused: true,
  volume: 1,
  muted: false,
});

let el: HTMLVideoElement | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function publish(): void {
  if (!el || !state.id) return;
  Broadcast.send(BROADCAST_TYPE.RETURN_OVERRIDE_STATE, {
    id: state.id,
    currentTime: el.currentTime,
    isPaused: el.paused,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    sentAt: Date.now(),
  });
}

function sync(): void {
  if (!el) return;
  state.currentTime = el.currentTime;
  state.duration = Number.isFinite(el.duration) ? el.duration : 0;
  state.paused = el.paused;
  publish();
}

function stop(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  el = null;
  Object.assign(state, { id: null, title: "", currentTime: 0, duration: 0, paused: true });
}

function start(video: { id: string; url: string; title: string }): void {
  stop();
  const media = document.createElement("video");
  media.preload = "auto";
  media.volume = state.volume;
  media.muted = state.muted;
  for (const event of ["loadedmetadata", "play", "pause", "seeked", "ended", "timeupdate"]) {
    media.addEventListener(event, sync);
  }
  applyMediaCors(media, video.url);
  media.src = video.url;
  el = media;
  Object.assign(state, { id: video.id, title: video.title, currentTime: 0, duration: 0, paused: false });
  ticker = setInterval(() => !el?.paused && publish(), TICK_MS);
  media.play().catch((e: unknown) => {
    Telemetry.captureException(e, { source: "presentation_mode.return_player.play" });
    sync();
  });
}

function toggle(): void {
  if (!el) return;
  if (el.paused) void el.play();
  else el.pause();
}

function seek(time: number): void {
  if (!el) return;
  el.currentTime = Math.max(0, Math.min(state.duration || 0, time));
  sync();
}

function advance(seconds: number): void {
  if (el) seek(el.currentTime + seconds);
}

function setVolume(volume: number): void {
  state.volume = Math.max(0, Math.min(1, volume));
  if (el) el.volume = state.volume;
}

function toggleMute(): void {
  state.muted = !state.muted;
  if (el) el.muted = state.muted;
}

export function useReturnPlayer() {
  return {
    state,
    start,
    stop,
    toggle,
    seek,
    advance,
    setVolume,
    toggleMute,
    /** O elemento que está tocando, para o medidor de nível do fader. */
    element: (): HTMLVideoElement | null => el,
  };
}
