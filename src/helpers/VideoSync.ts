import type { VideoMediaState } from "@/types/Media";
import { playbackPositionAt } from "@/helpers/VideoPlaybackSnapshot";

/** Acima disso a imagem está tão fora que só uma busca resolve (troca de faixa, salto do operador). */
export const HARD_SEEK_S = 0.5;
/** Abaixo disso ninguém percebe; acima, a imagem é acelerada ou freada até alcançar o som. */
export const RATE_SYNC_S = 0.05;
/** ±8% de velocidade não se percebe, e fecha 0,25 s de diferença em ~3 s. */
export const CATCH_UP = 0.08;
/** Vídeo parado: a imagem é um quadro só, então só uma diferença grande vale uma busca. */
export const PAUSED_SEEK_S = 0.15;

/** Mensagem mais velha que isso não serve de referência (relógio ajustado, janela travada). */
const MAX_MESSAGE_AGE_S = 2;

/**
 * Onde o vídeo DEVERIA estar agora.
 *
 * A janela principal manda o estado a cada 500 ms, e ele chega alguns a
 * centenas de milissegundos depois de lido. Buscar o `currentTime` bruto deixava
 * a imagem sempre atrás do som pela idade da mensagem — cerca de 0,3 s medido no
 * Electron. `sentAt` é `Date.now()`, que as janelas do mesmo computador
 * compartilham.
 */
export function expectedVideoTime(
  state: VideoClockState,
  now: number = Date.now()
): number | null {
  if (
    state.sampledAt !== undefined || state.position !== undefined ||
    state.playing !== undefined || state.rate !== undefined
  ) {
    if (state.playing !== !state.isPaused) return null;
    return playbackPositionAt(state as Required<Pick<VideoMediaState, "sampledAt" | "position" | "playing" | "rate">>, now);
  }
  if (typeof state.currentTime !== "number" || !Number.isFinite(state.currentTime)) return null;
  if (state.isPaused === true || typeof state.sentAt !== "number") return state.currentTime;
  const age = (now - state.sentAt) / 1000;
  return state.currentTime + Math.min(Math.max(age, 0), MAX_MESSAGE_AGE_S);
}

export type SyncAction = "skip" | "ok" | "rate" | "seek";

type SyncableVideo = Pick<
  HTMLVideoElement,
  "readyState" | "seeking" | "currentTime" | "duration" | "playbackRate"
>;

type VideoClockState = Pick<VideoMediaState, "currentTime" | "isPaused" | "sentAt"> &
  Partial<Pick<VideoMediaState, "sampledAt" | "position" | "playing" | "rate">>;

/**
 * Alinha a imagem (que está sem som) ao áudio da janela principal.
 *
 * Só buscar não basta: depois de `currentTime = x` um vídeo 1080p leva de dezenas
 * a centenas de ms para decodificar até o quadro, e nesse tempo o som avança — a
 * imagem ficava 0,15–0,3 s atrás, abaixo de qualquer limite razoável de busca, e
 * assim ficava para sempre. Então: erro grande → busca; erro pequeno → acelera ou
 * freia a imagem um pouco até alcançar, sem salto visível.
 */
export function syncVideoElement(
  el: SyncableVideo,
  state: VideoClockState,
  now: number = Date.now()
): SyncAction {
  const expected = expectedVideoTime(state, now);
  if (expected == null || el.readyState < 1) return "skip";
  // Já buscando: o `currentTime` ainda não é o do quadro, e nova busca só atrasa.
  if (el.seeking) return "skip";

  const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
  const target = Math.max(0, Math.min(expected, duration));
  const delta = target - el.currentTime; // > 0: a imagem está atrás do som
  const gap = Math.abs(delta);
  const baseRate = typeof state.rate === "number" && Number.isFinite(state.rate) && state.rate > 0
    ? state.rate : 1;

  if (state.isPaused === true) {
    el.playbackRate = baseRate;
    if (gap > PAUSED_SEEK_S) {
      el.currentTime = target;
      return "seek";
    }
    return "ok";
  }

  if (gap > HARD_SEEK_S) {
    el.playbackRate = baseRate;
    el.currentTime = target;
    return "seek";
  }
  if (gap > RATE_SYNC_S) {
    el.playbackRate = delta > 0 ? baseRate * (1 + CATCH_UP) : baseRate * (1 - CATCH_UP);
    return "rate";
  }
  el.playbackRate = baseRate;
  return "ok";
}
