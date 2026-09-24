/**
 * @category deve-virar-composable — Usa UserData (Pinia) e o bridge do Electron.
 *
 * Vídeos do YouTube baixados para o disco: o yt-dlp busca o arquivo cru, sem
 * anúncio, e ele passa a tocar como qualquer vídeo local — o mesmo caminho que
 * já alimenta projeção, retorno e operador. O player embutido do YouTube fica só
 * como reserva, para quando o download não é possível.
 */
import Platform from "@/helpers/Platform";
import { i18nAtual } from "@/i18n";
import $userdata from "@/helpers/UserData";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";

export type OnlineVideoErrorKind =
  | "invalid"
  | "unsupported"
  | "tools"
  | "busy"
  | "tool"
  | "network"
  | "cancelled"
  | "age"
  | "private"
  | "geo"
  | "live"
  | "bot"
  | "unavailable"
  | "disk"
  | "format"
  | "forbidden"
  | "unknown";

export type OnlineVideoPhase = "queued" | "tools" | "downloading" | "finalizing" | "done" | "error";

export interface OnlineVideoProgress {
  id: string;
  phase: OnlineVideoPhase;
  /** Barra geral (0–100), que só sobe ao longo das fases. */
  percent: number;
  /** Andamento da fase atual (o download do vídeo, ou de cada ferramenta), 0–100. */
  phasePercent?: number;
  tool?: string;
  downloaded?: number | null;
  total?: number | null;
  speed?: number | null;
  eta?: number | null;
  kind?: string;
}

export type OnlineVideoResult =
  | {
      ok: true;
      id: string;
      url: string;
      size: number;
      cached: boolean;
      meta?: { height?: number | null; vcodec?: string | null } | null;
      durationMs?: number;
      installedTools?: boolean;
    }
  | { ok: false; error: { kind: OnlineVideoErrorKind; message: string } };

/** Vídeo que está no disco. `kept`: baixado de propósito, o despejo por espaço não o leva. */
export interface OnlineVideoFile {
  id: string;
  size: number;
  usedAt: number;
  kept: boolean;
}

/**
 * Endereços do próprio app de onde as janelas leem o vídeo enquanto ele ainda baixa
 * (`stream`). São a mesma cópia para todas: quem baixa é o main.
 */
export interface OnlineVideoStreams {
  video: {
    url: string;
    height?: number | null;
    width?: number | null;
    vcodec?: string | null;
    ext?: string | null;
    size?: number | null;
  };
  /** Igual ao do vídeo quando o arquivo já traz o som junto (`muxed`). */
  audio: { url: string; acodec?: string | null; ext?: string | null; size?: number | null };
  muxed: boolean;
  duration: number | null;
  /** O vídeo já estava no disco: os dois endereços são o arquivo. */
  cached?: boolean;
}

export type OnlineVideoStreamResult =
  | ({ ok: true; id: string } & OnlineVideoStreams)
  | { ok: false; error: { kind: OnlineVideoErrorKind; message: string } };

export interface EnsureOptions {
  /** Pré-download: espera na sua própria fila e não atrasa o que o operador projeta agora. */
  background?: boolean;
  /** Guarda o vídeo: ele só sai quando o operador o remover. */
  keep?: boolean;
}

export const MAX_HEIGHTS = [480, 720, 1080] as const;
export const DEFAULT_MAX_HEIGHT = 1080;

const YT_URL_RE =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/;

/** ID de 11 caracteres a partir de qualquer forma de link do YouTube; null se não for. */
export function videoIdFromUrl(url: string | null | undefined): string | null {
  const m = typeof url === "string" ? url.match(YT_URL_RE) : null;
  return m ? m[1] : null;
}

/**
 * Quando o download falha, cair no player do YouTube só ajuda se o problema for
 * nosso (ferramenta, rede até o GitHub, formato). Se o próprio vídeo é o problema
 * — privado, removido, com restrição de idade ou de país — o embed mostraria o
 * erro do YouTube dentro do telão, diante da igreja; melhor avisar só o operador.
 */
const VIDEO_ITSELF_UNPLAYABLE: ReadonlySet<string> = new Set([
  "age",
  "private",
  "geo",
  "unavailable",
]);

export type FailureAction = "silent" | "error" | "embed";

export function actionForFailure(kind: string): FailureAction {
  if (kind === "cancelled") return "silent";
  if (VIDEO_ITSELF_UNPLAYABLE.has(kind)) return "error";
  return "embed";
}

/** Chave i18n (global) da explicação para o operador. */
export function messageKeyForFailure(kind: string): string {
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.fallback";
}

/**
 * Na hora de baixar de antemão não há player do YouTube como reserva: o aviso não
 * pode prometer um. Se o problema é o próprio vídeo, a explicação é a mesma.
 */
export function messageKeyForDownloadFailure(kind: string): string {
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.download";
}

/**
 * Falha ao abrir por links diretos ("tocar já"): nada foi baixado, então o aviso não
 * fala em download. O que é do próprio vídeo tem a mesma explicação de sempre.
 */
export function messageKeyForStreamFailure(kind: string): string {
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.stream";
}

/** Texto curto da fase do download, para a lista de processos. */
export function phaseText(p: OnlineVideoProgress): string {
  const t = i18nAtual()?.global?.t;
  if (!t) return "";
  if (p.phase === "tools") return String(t("online_video.phase.tools"));
  if (p.phase === "queued") return String(t("online_video.phase.queued"));
  if (p.phase === "finalizing") return String(t("online_video.phase.finalizing"));
  return `${t("online_video.phase.downloading")} ${Math.round(p.phasePercent ?? p.percent)}%`;
}

export function normalizeMaxHeight(value: unknown): number {
  const n = Number(value);
  return (MAX_HEIGHTS as readonly number[]).includes(n) ? n : DEFAULT_MAX_HEIGHT;
}

/** Só o desktop baixa: no navegador não há onde rodar o yt-dlp. */
export function downloadAvailable(): boolean {
  return Platform.isDesktop && !!Platform.onlineVideo;
}

/**
 * Tocar pelo app (sem anúncios), baixando o vídeo no computador: o operador pode preferir o
 * player do YouTube. Um vídeo que já está no disco toca dele mesmo com isto desligado.
 */
export function downloadEnabled(): boolean {
  if (!downloadAvailable()) return false;
  return $userdata.get<boolean>(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.DOWNLOAD, true) !== false;
}

export function maxHeight(): number {
  return normalizeMaxHeight($userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.MAX_HEIGHT, DEFAULT_MAX_HEIGHT));
}

/**
 * Baixa (ou acha em cache) o vídeo. Nunca rejeita: a resposta diz se deu certo e,
 * se não, por quê — quem chama decide entre avisar e cair no player do YouTube.
 */
export async function ensure(
  id: string,
  onProgress?: (p: OnlineVideoProgress) => void,
  options: EnsureOptions = {}
): Promise<OnlineVideoResult> {
  const api = Platform.onlineVideo;
  if (!api) return { ok: false, error: { kind: "unsupported", message: "sem desktop" } };

  const off = onProgress
    ? api.onProgress((p: OnlineVideoProgress) => {
        if (p?.id === id) onProgress(p);
      })
    : null;
  const startedAt = Date.now();
  const background = options.background === true;
  const keep = options.keep === true;
  Telemetry.track("online_video_download_requested", {
    video_id: id,
    max_height: maxHeight(),
    background,
    keep,
  });
  try {
    const res = (await api.ensure(id, {
      maxHeight: maxHeight(),
      priority: background ? "background" : "foreground",
      keep,
    })) as OnlineVideoResult;
    if (res.ok) {
      Telemetry.track("online_video_download_ready", {
        video_id: id,
        cached: res.cached,
        size: res.size,
        height: res.meta?.height ?? null,
        vcodec: res.meta?.vcodec ?? null,
        installed_tools: res.installedTools ?? false,
        elapsed_ms: res.durationMs ?? Date.now() - startedAt,
      });
    } else if (res.error.kind !== "cancelled") {
      Telemetry.track("online_video_download_failed", {
        video_id: id,
        kind: res.error.kind,
        action: actionForFailure(res.error.kind),
        elapsed_ms: Date.now() - startedAt,
      });
    }
    return res;
  } catch (error) {
    // O IPC em si falhou (janela recarregando, main sem o handler): trate como falha nossa.
    const message = error instanceof Error ? error.message : String(error);
    Telemetry.track("online_video_download_failed", { video_id: id, kind: "unknown", ipc: true });
    return { ok: false, error: { kind: "unknown", message } };
  } finally {
    off?.();
  }
}

/**
 * Endereço de um vídeo que ainda baixa, servido pelo próprio app. O <video> lê por
 * pedaços direto do arquivo em crescimento: passá-lo pelo XHR/blob traria o arquivo
 * inteiro para a memória antes de tocar, que é justamente a espera que se quer evitar.
 */
export function isProgressiveUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("louvorja://onlinestream/");
}

/**
 * Começa o vídeo já: o main baixa uma vez, aos pedaços, e devolve os endereços de onde
 * as janelas leem — sem esperar o download acabar e sem o player do YouTube (logo, sem
 * anúncio). Uns 6 s até poder tocar. Nunca rejeita: se não der, a resposta diz por quê e
 * quem chama cai no player embutido.
 */
export async function stream(id: string): Promise<OnlineVideoStreamResult> {
  const api = Platform.onlineVideo;
  if (!api?.stream) return { ok: false, error: { kind: "unsupported", message: "sem desktop" } };
  const startedAt = Date.now();
  try {
    const res = (await api.stream(id, { maxHeight: maxHeight() })) as OnlineVideoStreamResult;
    if (res.ok) {
      Telemetry.track("online_video_stream_resolved", {
        video_id: id,
        height: res.video.height ?? null,
        muxed: res.muxed,
        cached: res.cached ?? false,
        elapsed_ms: Date.now() - startedAt,
      });
    } else if (res.error.kind !== "cancelled") {
      Telemetry.track("online_video_stream_failed", {
        video_id: id,
        kind: res.error.kind,
        message: String(res.error.message ?? "").slice(0, 200),
        elapsed_ms: Date.now() - startedAt,
      });
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Telemetry.track("online_video_stream_failed", {
      video_id: id,
      kind: "unknown",
      ipc: true,
      message: message.slice(0, 200),
    });
    return { ok: false, error: { kind: "unknown", message } };
  }
}

export function cancel(id: string): void {
  void Platform.onlineVideo?.cancel(id);
}

let _prepared = false;

/**
 * Deixa as ferramentas de vídeo instaladas antes de o operador pedir o primeiro
 * vídeo. Uma vez por sessão, sem barulho: se falhar, o download tenta de novo na hora.
 */
export function prepare(): void {
  if (_prepared || !downloadAvailable()) return;
  _prepared = true;
  void Platform.onlineVideo?.prepare?.().catch(() => {
    _prepared = false;
  });
}

/** Vídeos que estão no disco, com o tamanho e se o operador mandou mantê-los. */
export async function listFiles(): Promise<OnlineVideoFile[]> {
  try {
    const list = await Platform.onlineVideo?.list();
    return Array.isArray(list) ? (list as OnlineVideoFile[]) : [];
  } catch {
    return [];
  }
}

export async function isDownloaded(id: string): Promise<boolean> {
  if (!downloadAvailable()) return false;
  try {
    return (await Platform.onlineVideo?.has(id)) === true;
  } catch {
    return false;
  }
}

/** Manda manter um vídeo que já está no disco. */
export async function keepFile(id: string): Promise<boolean> {
  try {
    return (await Platform.onlineVideo?.keep(id)) === true;
  } catch {
    return false;
  }
}

/** Apaga o vídeo do disco (cancelando o download dele, se houver). */
export async function removeFile(id: string): Promise<void> {
  try {
    await Platform.onlineVideo?.remove(id);
  } catch {
    /* já não existe */
  }
}
