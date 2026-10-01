/**
 * @category deve-virar-composable — Usa UserData (Pinia) e o bridge do Electron.
 *
 * Vídeos do YouTube baixados para o disco: o yt-dlp busca o arquivo cru, sem
 * anúncio, e ele passa a tocar como qualquer vídeo local — o mesmo caminho que
 * já alimenta projeção, retorno e operador. O player embutido do YouTube fica só
 * como reserva, para quando o download não é possível.
 */
import Platform from "@/helpers/Platform";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
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
  /** Tempos deste pedido no main; join mede espera, sem repetir trabalho do dono. */
  timings?: Partial<Record<"resolve_ms" | "session_open_ms" | "join_wait_ms" | "total_ms", number>>;
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

/** Canal ou playlist do YouTube, como o main aceita listar. */
export interface YouTubeCollectionSource {
  kind: "channel" | "playlist";
  /** Canal: "UC…" ou "@nome". Playlist: o `list=` do link. */
  id: string;
}

/** Um link do YouTube colado pelo operador: um vídeo, uma playlist ou um canal. */
export type YouTubeSource = { kind: "video"; id: string } | YouTubeCollectionSource;

export interface YouTubeCollectionEntry {
  id: string;
  title: string;
  /** Segundos; null quando o YouTube não informa. */
  duration: number | null;
}

export interface YouTubeCollectionPage {
  title: string;
  channel: string;
  thumbnail: string | null;
  entries: YouTubeCollectionEntry[];
  hasMore: boolean;
}

const PLAYLIST_RE = /[?&]list=([A-Za-z0-9_-]{12,64})/;
const CHANNEL_RE = /youtube\.com\/(?:channel\/(UC[A-Za-z0-9_-]{22})|(@[\p{L}\p{N}._-]{3,100}))/u;

/**
 * O que um link do YouTube aponta. Link de vídeo dentro de uma playlist
 * (`watch?v=…&list=…`) conta como o vídeo: é ele que o operador estava vendo.
 */
export function youtubeSourceFromUrl(url: string | null | undefined): YouTubeSource | null {
  if (typeof url !== "string" || !/(?:youtube\.com|youtu\.be)/i.test(url)) return null;
  const video = videoIdFromUrl(url);
  if (video) return { kind: "video", id: video };
  const playlist = url.match(PLAYLIST_RE);
  if (playlist) return { kind: "playlist", id: playlist[1] };
  const channel = url.match(CHANNEL_RE);
  if (channel) return { kind: "channel", id: channel[1] ?? decodeURIComponent(channel[2]) };
  return null;
}

/** Só no desktop: o yt-dlp lista o canal ou a playlist no processo principal. */
export function collectionsAvailable(): boolean {
  return typeof Platform.onlineVideo?.collection === "function";
}

/**
 * Uma página de vídeos de um canal (do mais recente ao mais antigo) ou de uma
 * playlist. Lança com `kind` quando o main devolve falha.
 */
export async function listCollection(
  source: YouTubeCollectionSource,
  range: { start: number; count: number; lang?: string }
): Promise<YouTubeCollectionPage> {
  const api = Platform.onlineVideo;
  if (!api?.collection) throw Object.assign(new Error("unsupported"), { kind: "unsupported" });
  const res = await api.collection({ kind: source.kind, id: source.id }, range);
  if (!res.ok) throw Object.assign(new Error(res.error.message), { kind: res.error.kind });
  return { title: res.title, channel: res.channel, thumbnail: res.thumbnail, entries: res.entries, hasMore: res.hasMore };
}

/** Título e canal de um vídeo pelo oEmbed do YouTube (público, sem chave); null se não achar. */
export async function youtubeOembed(id: string): Promise<{ title: string; channel: string } | null> {
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
      { timeout: NET_TIMEOUT.QUICK, source: "youtube-oembed", thirdParty: true }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: unknown; author_name?: unknown };
    return {
      title: typeof json.title === "string" ? json.title : "",
      channel: typeof json.author_name === "string" ? json.author_name : "",
    };
  } catch {
    return null;
  }
}

/** Miniatura do vídeo servida pelo YouTube, sem chamar API nenhuma. */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** O player embutido, como o resto do app abre os vídeos on-line. */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`;
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
  if (kind === "bot") return "online_video.errors.bot";
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.fallback";
}

/**
 * Na hora de baixar de antemão não há player do YouTube como reserva: o aviso não
 * pode prometer um. Se o problema é o próprio vídeo, a explicação é a mesma.
 */
export function messageKeyForDownloadFailure(kind: string): string {
  if (kind === "bot") return "online_video.errors.bot";
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.download";
}

/**
 * Falha ao abrir por links diretos ("tocar já"): nada foi baixado, então o aviso não
 * fala em download. O que é do próprio vídeo tem a mesma explicação de sempre.
 */
export function messageKeyForStreamFailure(kind: string): string {
  if (kind === "bot") return "online_video.errors.bot";
  return VIDEO_ITSELF_UNPLAYABLE.has(kind)
    ? `online_video.errors.${kind}`
    : "online_video.errors.stream";
}

/** Texto curto da fase do download, para a lista de processos. */
export function phaseText(p: OnlineVideoProgress): string {
  const t = i18nAtual()?.global?.t;
  if (!t) return "";
  if (p.phase === "tools") {
    const toolPhase =
      p.tool === "yt-dlp"
        ? "online_video.phase.tools_ytdlp"
        : p.tool === "ffmpeg"
          ? "online_video.phase.tools_ffmpeg"
          : null;
    return toolPhase
      ? String(t(toolPhase, { percent: Math.round(p.phasePercent ?? p.percent) }))
      : String(t("online_video.phase.tools"));
  }
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
  return normalizeMaxHeight(
    $userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.MAX_HEIGHT, DEFAULT_MAX_HEIGHT)
  );
}

export interface YouTubeAccountStatus {
  loggedIn: boolean;
}

/** Conta do YouTube do operador (só desktop). Os cookies ficam no main. */
export async function youtubeAccountStatus(): Promise<YouTubeAccountStatus> {
  return (await Platform.onlineVideo?.accountStatus?.().catch(() => null)) ?? { loggedIn: false };
}

/** Abre a janela de login do Google; resolve quando ela fecha. */
export async function youtubeAccountLogin(): Promise<YouTubeAccountStatus> {
  return (await Platform.onlineVideo?.accountLogin?.().catch(() => null)) ?? { loggedIn: false };
}

export async function youtubeAccountLogout(): Promise<YouTubeAccountStatus> {
  return (await Platform.onlineVideo?.accountLogout?.().catch(() => null)) ?? { loggedIn: false };
}

/**
 * Deixa os links do vídeo prontos antes do play (prévia, "a seguir"): o próximo
 * `stream` dele começa sem consultar o YouTube. Só vale quando o app toca o
 * vídeo por conta própria; com o player do YouTube não há o que adiantar.
 */
export function prefetch(id: string): void {
  if (!downloadEnabled() || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  void Platform.onlineVideo?.prefetch?.(id, { maxHeight: maxHeight() }).catch(() => {});
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

  const startedAt = Date.now();
  let lastWorkPhase: "queued" | "tools" | "downloading" | "finalizing" | null = null;
  let lastTool: "yt-dlp" | "ffmpeg" | null = null;
  let lastPhaseAt = startedAt;
  let toolsStartedAt: number | null = null;
  let firstDownloadingAt: number | null = null;
  const boundedMs = (value: number | null): number | null =>
    value === null || !Number.isFinite(value)
      ? null
      : Math.round(Math.max(0, Math.min(600_000, value)));
  const progressContext = () => ({
    last_phase: lastWorkPhase,
    last_tool: lastWorkPhase === "tools" ? lastTool : null,
    phase_elapsed_ms: lastWorkPhase ? boundedMs(Date.now() - lastPhaseAt) : null,
    initial_tools_ms:
      toolsStartedAt !== null && firstDownloadingAt !== null
        ? boundedMs(firstDownloadingAt - toolsStartedAt)
        : null,
  });
  const off = onProgress
    ? api.onProgress((p: OnlineVideoProgress) => {
        if (p?.id !== id) return;
        if (
          p.phase === "queued" ||
          p.phase === "tools" ||
          p.phase === "downloading" ||
          p.phase === "finalizing"
        ) {
          const tool =
            p.phase === "tools" && (p.tool === "yt-dlp" || p.tool === "ffmpeg") ? p.tool : null;
          if (p.phase !== lastWorkPhase || tool !== lastTool) {
            const at = Date.now();
            if (p.phase === "tools" && toolsStartedAt === null) toolsStartedAt = at;
            if (p.phase === "downloading" && firstDownloadingAt === null) firstDownloadingAt = at;
            lastWorkPhase = p.phase;
            lastTool = tool;
            lastPhaseAt = at;
          }
        }
        onProgress(p);
      })
    : null;
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
        initial_tools_ms: progressContext().initial_tools_ms,
      });
    } else if (res.error.kind !== "cancelled") {
      Telemetry.track("online_video_download_failed", {
        video_id: id,
        kind: res.error.kind,
        action: actionForFailure(res.error.kind),
        elapsed_ms: Date.now() - startedAt,
        ...progressContext(),
      });
    }
    return res;
  } catch (error) {
    // O IPC em si falhou (janela recarregando, main sem o handler): trate como falha nossa.
    const message = error instanceof Error ? error.message : String(error);
    Telemetry.track("online_video_download_failed", {
      video_id: id,
      kind: "unknown",
      ipc: true,
      ...progressContext(),
    });
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

const PLAYBACK_URL_RE = /^louvorja:\/\/online(?:video|stream)\/([A-Za-z0-9_-]{11})(?:[./]|$)/;

/**
 * O vídeo do YouTube por trás do que está tocando: o arquivo baixado, o que
 * ainda baixa ou o player embutido. null para qualquer outro arquivo.
 */
export function videoIdFromPlaybackUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  return url.match(PLAYBACK_URL_RE)?.[1] ?? videoIdFromUrl(url);
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
      const timings: Record<string, number> = {};
      const safeTimings: NonNullable<OnlineVideoStreams["timings"]> = {};
      // Resposta IPC é uma fronteira: somente durações finitas, nunca campos
      // arbitrários ou conteúdo, entram no evento que já existe.
      if (res.timings && typeof res.timings === "object" && !Array.isArray(res.timings)) {
        for (const key of ["resolve_ms", "session_open_ms", "join_wait_ms", "total_ms"] as const) {
          const value = res.timings[key];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            const bounded = Math.round(Math.min(value, 600_000));
            timings[`main_${key}`] = bounded;
            safeTimings[key] = bounded;
          }
        }
      }
      Telemetry.track("online_video_stream_resolved", {
        video_id: id,
        height: res.video.height ?? null,
        muxed: res.muxed,
        cached: res.cached ?? false,
        elapsed_ms: Date.now() - startedAt,
        ...timings,
      });
      return res.timings === undefined ? res : { ...res, timings: safeTimings };
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
export async function removeFile(id: string): Promise<boolean> {
  try {
    return (await Platform.onlineVideo?.remove(id)) === true;
  } catch {
    return false;
  }
}
