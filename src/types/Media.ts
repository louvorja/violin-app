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
  /**
   * Identidade da reprodução que as janelas de projeção já receberam (vídeo).
   * O player adota a mesma: as telas só obedecem a VIDEO_STATE com o id delas,
   * e um segundo id criado aqui deixava a tela presa ao primeiro, rodando sozinha.
   */
  playback_id?: string;
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
  /** Quem publicou o estado do YouTube. Ausente: a janela de projeção, que manda no relógio. */
  role?: "main" | "return" | "operator";
}

export interface FileProjectionState {
  active: boolean;
  type: string;
  url: string;
  title: string;
  playback_id?: string;
  /**
   * `"player"`: o vídeo segue o player da janela principal (é de lá que sai o
   * som) — a tela não toca sozinha. Sem isso (o timer projetando um vídeo,
   * por exemplo), a tela toca por conta própria.
   */
  clock?: "player";
  stage_epoch?: number;
  page?: number;
  totalPages?: number;
  /**
   * Tamanho declarado pelo DONO do arquivo (o `page_count` do Canva, por
   * exemplo). A janela de projeção compara com o que o pdf.js abriu de fato —
   * é como se descobre que um export saiu incompleto, em vez de achar na
   * hora de virar a página.
   */
  pageCount?: number;
  /** Navegação veio do "anterior" — inverte o modo automático de direção. */
  backward?: boolean;
  /** Referência para re-resolver URLs blob via IndexedDB na janela alvo. */
  libRef?: { table?: string; id: string };
  /** HEIC/HEIF validado pelo emissor; cada janela converte seus próprios bytes. */
  heic?: boolean;
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
  playback_id: string;
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
  mute?(): void;
  setOption?(module: string, option: string, value: object): void;
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
    disablekb?: number;
    playsinline?: number;
    fs?: number;
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
