import { MusicActionEnum } from "@/enums/MusicActionEnum";

export interface MediaOpenParams {
  id_music?: string | number;
  id_album?: string | number | null;
  mode?: MusicActionEnum;
  minimized?: boolean;
  url?: string;
  title?: string;
  /** Fonte direta da liturgia/biblioteca. Vídeos usam HTMLVideoElement para
   * preservar a faixa de áudio e o relógio de reprodução. */
  mediaType?: "audio" | "video";
  /**
   * Fonte da imagem quando ela vem de um arquivo diferente do som (vídeo que ainda
   * baixa: trilha de vídeo e trilha de áudio). O player do app a mostra, muda.
   */
  videoUrl?: string;
}

export interface MediaConfig {
  audio?: unknown;
  video_src?: string;
  slide_index?: number;
  last_slide?: number;
  mode?: MusicActionEnum;
  is_youtube?: boolean;
}

export interface VideoMediaState {
  currentTime: number;
  isPaused: boolean;
  duration: number;
  /** Coherent playback clock; optional while older senders still exist. */
  sampledAt?: number;
  position?: number;
  playing?: boolean;
  rate?: number;
  clockAnchor?: number | null;
  /** YouTube PlayerState, quando a origem é a projeção online. */
  state?: number;
  playback_id?: string;
  /** Sequência monotônica dentro de um playback; começa em 1. */
  revision?: number;
  /** `Date.now()` de quando o estado foi lido; quem recebe compensa a idade da mensagem. */
  sentAt?: number;
}

export interface FileProjectionState {
  active: boolean;
  type: string;
  url: string;
  title: string;
  playback_id?: string;
  page?: number;
  totalPages?: number;
  /** Referência para re-resolver URLs blob via IndexedDB na janela alvo. */
  libRef?: { table?: string; id: string };
}

export interface MediaFile {
  id: string;
  name: string;
  fileName: string;
  path: string;
  data?: ArrayBuffer;
  mime?: string;
}

export interface YouTubeControlPayload {
  action: string;
  value?: number;
}


// Interfaces para o YouTube Player API
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  unMute?(): void;
  destroy(): void;
}

export interface YTPlayerOptions {
  height: string;
  width: string;
  videoId: string;
  origin?: string;
  playerVars: {
    autoplay: number;
    mute: number;
    rel: number;
    controls: number;
    modestbranding: number;
    cc_load_policy?: number;
  };
  events: {
    onReady: () => void;
    onStateChange: (e: { data: number }) => void;
    onError?: (e: { data: number }) => void;
    onApiChange?: () => void;
  };
}

export interface YTAPI {
  Player: {
    new (element: HTMLElement | null, options: YTPlayerOptions): YTPlayer;
  };
  PlayerState: {
    PLAYING: number;
    ENDED: number;
  };
}
