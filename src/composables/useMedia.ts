import { shallowRef, watch } from "vue";
import $dev from "@/helpers/Dev";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { PROGRESS_UI_INTERVAL_MS } from "@/constants/Playback";
import { createRateGate } from "@/helpers/RateGate";
import $datetime from "@/helpers/DateTime";
import $path from "@/helpers/Path";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import { NET_TIMEOUT, fetchWithTimeout, ehRemota } from "@/helpers/Http";
import { reportNetworkResult } from "@/composables/useConnectivity";
import { i18nAtual } from "@/i18n";
import $modules from "@/helpers/Modules";
import $database from "@/helpers/Database";
import $history from "@/helpers/History";
import $broadcast from "@/helpers/Broadcast";
import { useAudioPlayback, type AudioTelemetryContext } from "@/composables/useAudioPlayback";
import { useSlides } from "@/composables/useSlides";
import type { Slide } from "@/composables/useSlides";
import { useLyric } from "@/composables/useLyric";
import { useAlbum } from "@/composables/useAlbum";
import {
  openProjectionWindows,
  openVideoProjectionWindows,
  openFileProjectionWindows,
  closeProjectionWindows,
  closeFileProjectionWindows,
  closeMusicProjectionWindows,
} from "@/helpers/ProjectionWindows";
import { Music } from "@/types/Music";
import type { Lyric } from "@/types/Lyric";
import { LyricOpenParams } from "@/types/Lyric";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { MediaOpenParams } from "@/types/Media";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import AudioLibrary from "@/helpers/AudioLibrary";
import Telemetry from "@/helpers/Telemetry";
import Platform from "@/helpers/Platform";
import * as OnlineVideo from "@/helpers/OnlineVideo";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";
import { VideoStateRevisionCounter } from "@/helpers/VideoStateVersion";
import { createVideoPlaybackSnapshot, shouldRespondToVideoStateRequest } from "@/helpers/VideoPlaybackSnapshot";

const _audio = useAudioPlayback();
const _slides = useSlides();
const _lyric = useLyric();
const _album = useAlbum();
let _loadingId: string | number | null = null;
let _playlistOnEnd: (() => boolean) | null = null;
// XHR atual de download de áudio — abortado ao trocar de música rapidamente
// para liberar conexão e evitar callbacks de respostas obsoletas (mesmo que
// o early-return pelo _loadingId já as ignore, a request continuava
// drenando bytes da rede e ocupando handlers).
let _audioXhr: XMLHttpRequest | null = null;
// Troca de modo em andamento: a faixa antiga segue tocando até a nova assumir,
// e chegar ao fim dela não é motivo para encerrar a música.
let _switchingMode = false;
let _activePlayback: AudioTelemetryContext | null = null;
let _mediaActivitySent = false;
const _videoStateRevisions = new VideoStateRevisionCounter();

// typeof null === "object": sem tratar null aqui, open(null) estourava lendo params.mode.
function _openParams(params: MediaOpenParams | string | number | null | undefined): MediaOpenParams {
  return params != null && typeof params === "object" ? params : { id_music: params ?? undefined };
}

function _newPlaybackId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      return crypto.randomUUID();
  } catch {
    /* ambientes antigos sem randomUUID */
  }
  return `playback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function _mediaClockMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function _mediaElapsedMs(startedAt: number): number {
  return Math.max(0, Math.min(180_000, Math.round(_mediaClockMs() - startedAt)));
}

function _audioTelemetry(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(_activePlayback || {}), ...extra };
}

function _telemetryFor(
  context: AudioTelemetryContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...context, ...extra };
}

function _sourceType(url: string): string {
  if (url.startsWith("louvorja://")) return "desktop_protocol";
  if (url.startsWith("blob:")) return "blob";
  if (url.startsWith("data:")) return "data";
  if (/^https?:/i.test(url)) return "http";
  return "local_or_unknown";
}

function _setPlaybackContext(context: AudioTelemetryContext | null): void {
  _activePlayback = context;
  const active = context !== null;
  if (active !== _mediaActivitySent) {
    _mediaActivitySent = active;
    try { Platform.presentation?.setMediaActive(active); } catch { /* diagnóstico não afeta projeção */ }
  }
  if (!context) _videoStateRevisions.reset();
  Telemetry.setRuntimeContext({
    playback_id: context?.playback_id ?? null,
    presentation_revision: null,
  });
  _audio.setTelemetryContext(context);
}

// YouTube mode
let _ytUnlisten: (() => void) | null = null;
let _ytWatchdog: ReturnType<typeof setTimeout> | null = null;
let _ytLastState: number | null = null;
let _ytStateReceived = false;
let _youtubePlaybackSample: { currentTime: number; duration: number; isPaused: boolean } | null = null;
let _ytLastSampledAt = 0;

function _broadcastYoutubeStateForRequest(): void {
  // The embedded player lives in an auxiliary window. After that window closes
  // its clock stops, so a reopened window resumes the last confirmed position.
  const sample = _youtubePlaybackSample;
  if (!sample) return;
  const version = _videoStateRevisions.next(_activePlayback?.playback_id);
  if (!version) return;
  const sampledAt = Date.now();
  const snapshot = createVideoPlaybackSnapshot({
    ...version,
    currentTime: sample.currentTime,
    isPaused: sample.isPaused,
    rate: 1,
  }, sampledAt);
  if (!snapshot) return;
  $broadcast.send(BROADCAST_TYPE.VIDEO_STATE, {
    ...version, ...snapshot,
    currentTime: sample.currentTime,
    duration: sample.duration,
    isPaused: sample.isPaused,
    sentAt: sampledAt,
  });
}

function _broadcastVideoState(currentTime?: number, isPaused?: boolean): void {
  if (!$appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE)) return;
  const version = _videoStateRevisions.next(_activePlayback?.playback_id);
  if (!version) return;
  const el = _audio.getElement();
  const position = currentTime ?? (Number.isFinite(el.currentTime) ? el.currentTime : _audio.currentTime.value);
  const paused = isPaused ?? el.paused;
  const sampledAt = Date.now();
  const snapshot = createVideoPlaybackSnapshot({
    ...version,
    currentTime: position,
    isPaused: paused,
    rate: el.playbackRate,
  }, sampledAt);
  if (!snapshot) return;
  $broadcast.send(BROADCAST_TYPE.VIDEO_STATE, {
    currentTime: position,
    isPaused: paused,
    duration: _audio.duration.value,
    sentAt: sampledAt,
    ...snapshot,
    ...version,
  });
}

/**
 * Os fluxos de liturgia/acervo abrem a janela antes do player principal.
 * Assim que `openAudio` reserva o playback, republicamos o mesmo payload com
 * sua identidade para que estados atrasados do vídeo anterior sejam rejeitados.
 */
function _publishVideoProjectionIdentity(playbackId: string, projectionUrl: string): void {
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    if (!stored) return;
    const payload = JSON.parse(stored) as Record<string, unknown>;
    if (payload.type !== "video" || payload.url !== projectionUrl) return;
    if (payload.playback_id === playbackId) return;
    const versionedPayload = { ...payload, playback_id: playbackId };
    localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify(versionedPayload));
    $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, versionedPayload);
  } catch {
    /* cache opcional; o primeiro VIDEO_STATE ainda pode vincular um receiver legado */
  }
}

function _isYouTube(): boolean {
  return !!$appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_YOUTUBE);
}

function _keepVideoProjectionOnLoadError(): boolean {
  return Boolean($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false));
}

// ─── Vídeo do YouTube baixado (ver helpers/OnlineVideo.ts) ───────────────────

type DownloadedOutcome = "playing" | "stopped" | "embed";

let _ytPrepareSeq = 0;
let _ytPreparation: { id: string; promise: Promise<DownloadedOutcome>; owns: boolean } | null = null;
// Vídeo que ainda está sendo baixado (some assim que o download termina).
let _ytDownloading: string | null = null;
// Esse download nasceu deste pedido de tocar. Se o operador o pediu de propósito antes (botão de
// baixar, link novo), ele é dele: desistir de tocar só deixa de esperar, e o download segue.
let _ytOwnsDownload = false;
// Vídeo aberto por links diretos, esperando o som ficar pronto para tocar.
let _ytStarting: string | null = null;
const _videoWindowOpenings = new Set<Promise<void>>();
let _stageEpoch = 0;
let _stageWindowTransition: Promise<void> = Promise.resolve();
const VIDEO_WINDOW_RELEASE_WAIT_MS = 2500;
// O vídeo do YouTube que o operador acabou de pedir, do clique até o som estar pronto (ou ele desistir). Enquanto o
// yt-dlp resolve os links (~5 s) nada mais aparece na tela: sem isto o clique parece não ter feito nada.
const _opening = shallowRef<{ id: string | null; title: string } | null>(null);

/**
 * O operador desistiu do vídeo que ainda baixava — fechou a mídia ou abriu outra
 * coisa. Sem isso o vídeo apareceria sozinho no telão quando terminasse.
 */
function _dropPendingDownload(): void {
  const preparation = _ytPreparation;
  if (preparation) {
    _ytPrepareSeq++;
    _ytPreparation = null;
  }
  if (_ytStarting) {
    // Fechou a mídia ou abriu outra coisa antes de o vídeo começar: quem espera o som
    // ficar pronto não pode, ao estourar o prazo, abrir o player do YouTube por cima.
    _ytStarting = null;
    if (!preparation) _ytPrepareSeq++;
  }
  if (!_ytDownloading) return;
  if (_ytOwnsDownload) OnlineVideo.cancel(_ytDownloading);
  _ytDownloading = null;
  _ytOwnsDownload = false;
  if (!preparation) _ytPrepareSeq++; // o resultado que chegar já não interessa
  // Quem pedir o mesmo vídeo agora começa um preparo novo: reaproveitar o cancelado,
  // que ainda está encerrando, o faria terminar em "parado" e o vídeo nunca abriria.
  _ytPreparation = null;
}

function _clearFileProjectionCache(): void {
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
  } catch { /* armazenamento indisponível */ }
}

function _hasFileProjectionCache(): boolean {
  try {
    return Boolean(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION) ||
      localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION));
  } catch { return false; }
}

function _queueStageWindows(stageEpoch: number, action: () => Promise<void>): Promise<void> {
  const transition = _stageWindowTransition.then(async () => {
    if (stageEpoch === _stageEpoch) await action();
  });
  _stageWindowTransition = transition.catch(() => {});
  return transition;
}

/** Wait for older close operations without making a native window open block later stage changes. */
async function _afterStageWindowCloses(stageEpoch: number, action: () => Promise<void>): Promise<void> {
  await _stageWindowTransition;
  if (stageEpoch === _stageEpoch) await action();
}

function _closeFileWindowsAfterPendingOpen(stageEpoch: number): void {
  if (!_videoWindowOpenings.size) return;
  void Promise.allSettled([..._videoWindowOpenings]).then(() => {
    if (stageEpoch === _stageEpoch) {
      void _queueStageWindows(stageEpoch, closeFileProjectionWindows).catch(() => {});
    }
  });
}

async function _waitForPreviousVideoWindows(stageEpoch: number): Promise<void> {
  if (!_videoWindowOpenings.size) return;
  const finished = Promise.allSettled([..._videoWindowOpenings]);
  let settled = false;
  const done = finished.then(() => { settled = true; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    done,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, VIDEO_WINDOW_RELEASE_WAIT_MS); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!settled) {
    // A chamada nativa demorou além do limite. Não atrasa a nova música;
    // se a janela antiga aparecer depois, fecha-a apenas se este palco ainda for dono.
    void done.then(() => {
      if (stageEpoch === _stageEpoch) {
        void _queueStageWindows(stageEpoch, closeFileProjectionWindows).catch(() => {});
      }
    });
  }
}

/** Encerra o palco de arquivo/vídeo antes de um novo slide musical ou do editor. */
async function _releaseFileVideoStage(stageEpoch: number, wasVisibleAlready = false): Promise<void> {
  const wasVisible = _isYouTube() || _keepVideoProjectionOnLoadError() ||
    _hasFileProjectionCache() || _videoWindowOpenings.size > 0 || wasVisibleAlready;
  if (!wasVisible) return;
  if (_ytUnlisten) {
    _ytUnlisten();
    _ytUnlisten = null;
  }
  if (_ytWatchdog) clearTimeout(_ytWatchdog);
  _ytWatchdog = null;
  _clearFileProjectionCache();
  $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
  await _queueStageWindows(stageEpoch, async () => {
    // A abertura Electron já enviada pode terminar depois do pedido de troca.
    await _waitForPreviousVideoWindows(stageEpoch);
    if (stageEpoch === _stageEpoch) await closeFileProjectionWindows();
  });
}

async function _openTrackedVideoWindows(withOperator = false): Promise<void> {
  const opening = openVideoProjectionWindows({ withOperator });
  _videoWindowOpenings.add(opening);
  try { await opening; }
  finally { _videoWindowOpenings.delete(opening); }
}

async function _openTrackedFileWindows(): Promise<void> {
  const opening = openFileProjectionWindows();
  _videoWindowOpenings.add(opening);
  try { await opening; }
  finally { _videoWindowOpenings.delete(opening); }
}

async function _claimVideoWindows(stageEpoch: number, withOperator = false): Promise<boolean> {
  // O close de MUSIC/RETURN termina antes de um novo pedido de música poder
  // abrir essas features. FILE permanece intacta ao trocar vídeo por vídeo.
  await _queueStageWindows(stageEpoch, closeMusicProjectionWindows);
  if (stageEpoch !== _stageEpoch) return false;
  await _afterStageWindowCloses(stageEpoch, () => _openTrackedVideoWindows(withOperator));
  return stageEpoch === _stageEpoch;
}

/**
 * Baixa o vídeo (ou o acha em cache) e o projeta. O download aparece na lista de
 * processos em segundo plano, com barra e botão de cancelar. Pedir outro vídeo
 * cancela o que ainda está baixando; pedir o mesmo de novo aproveita o pedido em
 * curso em vez de abrir uma segunda projeção.
 */
function _prepareYouTube(
  id: string,
  run: (seq: number) => Promise<DownloadedOutcome>
): Promise<DownloadedOutcome> {
  if (_ytPreparation?.id === id) return _ytPreparation.promise;
  // Trocar de vídeo cancela o que ainda não começou — menos o download que o operador pediu de
  // propósito (botão de baixar, link novo), que só deixa de ser esperado.
  if (_ytPreparation?.owns) OnlineVideo.cancel(_ytPreparation.id);

  const owns = !useOnlineVideoDownloads().pending[id];
  _ytOwnsDownload = owns;
  const seq = ++_ytPrepareSeq;
  const promise = run(seq).finally(() => {
    if (_ytPreparation?.promise === promise) _ytPreparation = null;
  });
  _ytPreparation = { id, promise, owns };
  return promise;
}

function _prepareDownloadedYouTube(id: string, title: string): Promise<DownloadedOutcome> {
  return _prepareYouTube(id, (seq) => _runDownloadedYouTube(id, title, seq));
}

function _prepareStreamedYouTube(id: string, title: string): Promise<DownloadedOutcome> {
  return _prepareYouTube(id, (seq) => _runStreamedYouTube(id, title, seq));
}

async function _runDownloadedYouTube(
  id: string,
  title: string,
  seq: number
): Promise<DownloadedOutcome> {
  const t = i18nAtual()?.global?.t;
  const say = (key: string): string => (t ? String(t(key)) : key);
  const tasks = useBackgroundTasks();
  const downloads = useOnlineVideoDownloads();
  const taskId = `online-video:${id}`;
  let registered = false;

  _ytDownloading = id;
  const res = await OnlineVideo.ensure(id, (p) => {
    if (seq !== _ytPrepareSeq) return;
    downloads.mark(id, p); // o cartão do vídeo mostra o andamento, e o "✕" cancela
    // Só entra na lista quando há trabalho de verdade: um vídeo em cache não tem
    // progresso, e não vale piscar um "preparando" para algo instantâneo.
    if (!registered) {
      registered = true;
      tasks.registerTask(taskId, title || id, () => OnlineVideo.cancel(id));
      $snackbar.info(say("online_video.preparing"), { key: `ov-prep-${id}`, timeout: 5000 });
    }
    tasks.updateTask(taskId, { progress: p.percent, detail: OnlineVideo.phaseText(p) });
  });
  if (_ytDownloading === id) _ytDownloading = null;
  // Baixou de verdade: o cartão passa a mostrar "baixado" sem piscar "não baixado" no meio.
  if (res.ok && registered) await downloads.refresh();
  downloads.unmark(id);

  const dropTask = (): void => {
    if (registered) tasks.dismissTask(taskId);
  };

  // O operador já pediu outro vídeo: este resultado não interessa mais.
  if (seq !== _ytPrepareSeq) {
    dropTask();
    return "stopped";
  }

  if (res.ok) {
    if (registered) tasks.completeTask(taskId);
    return (await _openVideoFileProjection(res.url, title, res.url, seq)) ? "playing" : "stopped";
  }

  const kind = res.error.kind;
  const action = OnlineVideo.actionForFailure(kind);
  if (action === "silent") {
    dropTask();
    return "stopped";
  }
  if (registered) tasks.updateTask(taskId, { status: "error", error: res.error.message });
  const text = say(OnlineVideo.messageKeyForFailure(kind));
  if (action === "error") {
    $snackbar.error(text, { key: `ov-error-${id}`, timeout: 8000 });
    return "stopped";
  }
  $snackbar.warning(text, { key: `ov-fallback-${id}`, timeout: 8000 });
  return "embed";
}

/**
 * Entra pelo mesmo caminho de um vídeo local da liturgia: as janelas de projeção
 * e retorno tocam o arquivo sem som, sincronizadas por VIDEO_STATE, e o operador
 * mostra a prévia; o áudio sai da janela principal.
 */
async function _openVideoFileProjection(
  url: string,
  title: string,
  audioUrl: string = url,
  seq?: number
): Promise<boolean> {
  if (seq !== undefined && seq !== _ytPrepareSeq) return false;
  // Se o que estava no ar era o player embutido, as janelas dele saem primeiro.
  if (_isYouTube()) _self.close(true, true, true, true);
  const stageEpoch = _stageEpoch;

  const payload = { url, type: "video", title };
  try {
    localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify(payload));
    localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
  } catch {
    /* ignore */
  }

  try {
    if (!(await _claimVideoWindows(stageEpoch, true))) return false;
  } catch (error) {
    Telemetry.captureException(error, { operation: "online_video_projection_open" });
  }
  if (stageEpoch !== _stageEpoch || (seq !== undefined && seq !== _ytPrepareSeq)) return false;
  $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, payload);
  // As janelas levam um instante para abrir; se o operador pediu outra coisa nesse
  // meio-tempo, este vídeo já não é o do telão.
  await _self.openAudio({
    url: audioUrl,
    title,
    mediaType: "video",
    // Imagem e som em arquivos diferentes: o player do app mostra a imagem por conta própria.
    ...(audioUrl !== url ? { videoUrl: url } : {}),
  }, true);
  return true;
}

/** Sem o som pronto neste prazo, os links diretos não estão servindo (rede, bloqueio, link vencido). */
const STREAM_START_TIMEOUT_MS = 20_000;
const STREAM_START_POLL_MS = 200;

/**
 * O som do vídeo aberto por links diretos ficou pronto para tocar? Não se prende ao
 * que o operador fizer no meio: se ele fechou a mídia ou abriu outra coisa, é "stopped"
 * e ninguém cai no player do YouTube por cima disso.
 */
async function _waitForStreamStart(seq: number): Promise<"started" | "failed" | "stopped"> {
  const deadline = Date.now() + STREAM_START_TIMEOUT_MS;
  for (;;) {
    if (seq !== _ytPrepareSeq) return "stopped";
    const el = _audio.getElement();
    if (el.error) return "failed";
    if (el.readyState >= 3) return "started";
    if (Date.now() > deadline) return "failed";
    await new Promise((resolve) => setTimeout(resolve, STREAM_START_POLL_MS));
  }
}

/**
 * Toca já, sem esperar o download e sem o player do YouTube — logo, sem anúncio. O main
 * baixa o vídeo uma vez, aos pedaços, e todas as janelas leem do mesmo arquivo em
 * crescimento (nada de uma conexão por janela). Entra pelo mesmo caminho do vídeo
 * baixado (imagem sem som nas janelas, som na principal), só que imagem e som vêm de
 * duas trilhas. Quando o download termina, ele vira o arquivo em cache.
 */
async function _runStreamedYouTube(
  id: string,
  title: string,
  seq: number
): Promise<DownloadedOutcome> {
  const t = i18nAtual()?.global?.t;
  const say = (key: string): string => (t ? String(t(key)) : key);
  const startedAt = _mediaClockMs();
  let phaseStartedAt = startedAt;
  let resolutionMs: number | null = null;
  let projectionOpenMs: number | null = null;
  let mediaReadyMs: number | null = null;
  let outcome = "error";

  try {
    _ytDownloading = id; // até os links chegarem, cancelar ou abrir outra coisa desiste do pedido
    const res = await OnlineVideo.stream(id);
    resolutionMs = _mediaElapsedMs(phaseStartedAt);
    if (_ytDownloading === id) _ytDownloading = null;
    if (seq !== _ytPrepareSeq) {
      outcome = "superseded";
      return "stopped";
    }

    if (!res.ok) {
      const kind = res.error.kind;
      console.warn("[OnlineVideo] abrir direto falhou:", { id, kind, message: res.error.message });
      // Já há um download comum em curso para este vídeo (um pré-download, por exemplo): não
      // dá para tocar dele antes de terminar, então o operador o acompanha, com barra.
      if (kind === "busy") {
        outcome = "download_fallback";
        return _runDownloadedYouTube(id, title, seq);
      }
      const action = OnlineVideo.actionForFailure(kind);
      if (action === "silent") {
        outcome = "cancelled";
        return "stopped";
      }
      if (action === "error") {
        outcome = "unplayable";
        $snackbar.error(say(OnlineVideo.messageKeyForFailure(kind)), {
          key: `ov-error-${id}`,
          timeout: 8000,
        });
        return "stopped";
      }
      // Ferramentas ainda sendo instaladas (primeiro uso): o download ao fundo as instala,
      // e não há falha a explicar.
      if (kind !== "tools") {
        $snackbar.warning(say(OnlineVideo.messageKeyForStreamFailure(kind)), {
          key: `ov-fallback-${id}`,
          timeout: 8000,
        });
      }
      outcome = "embed_fallback";
      return "embed";
    }

    phaseStartedAt = _mediaClockMs();
    if (!(await _openVideoFileProjection(res.video.url, title, res.audio.url, seq))) {
      projectionOpenMs = _mediaElapsedMs(phaseStartedAt);
      outcome = "superseded";
      return "stopped";
    }
    projectionOpenMs = _mediaElapsedMs(phaseStartedAt);
    _ytStarting = id;
    phaseStartedAt = _mediaClockMs();
    const started = await _waitForStreamStart(seq);
    mediaReadyMs = _mediaElapsedMs(phaseStartedAt);
    if (_ytStarting === id) _ytStarting = null;
    if (started === "stopped") {
      outcome = "superseded";
      return "stopped";
    }
    if (started === "failed") {
      outcome = "media_not_ready";
      const el = _audio.getElement();
      const detail = {
        ready_state: el.readyState,
        network_state: el.networkState,
        error_code: el.error?.code ?? null,
        error_message: el.error?.message ?? null,
      };
      console.warn("[OnlineVideo] o vídeo aberto direto não chegou a tocar:", { id, ...detail });
      Telemetry.track("online_video_stream_start_failed", { video_id: id, ...detail });
      _self.close(true, true, true, true);
      $snackbar.warning(say(OnlineVideo.messageKeyForStreamFailure("unknown")), {
        key: `ov-fallback-${id}`,
        timeout: 8000,
      });
      return "embed";
    }

    void useOnlineVideoDownloads().download(id, title, { keep: false, quiet: true, background: true });
    outcome = "playing";
    return "playing";
  } finally {
    // Um resumo por tentativa, sem título/URL/ID e sem log por chunk ou frame.
    try {
      Telemetry.track("online_video_stream_start_latency", {
        resolution_ms: resolutionMs,
        projection_open_ms: projectionOpenMs,
        media_ready_ms: mediaReadyMs,
        total_ms: _mediaElapsedMs(startedAt),
        outcome,
      });
    } catch { /* diagnóstico nunca substitui o resultado da reprodução */ }
  }
}

function _loadAudioSrc(
  audioUrl: string,
  idCheck: string | number | null,
  retryFn: (id: string | number) => void,
  onSource: (src: string, lazy: boolean) => void = (src, lazy) => {
    _audio.setSrc(src, lazy);
    _self.pause(false);
  },
  deferAudioContext = false
): void {
  // Captura o contexto desta tentativa. Callbacks de XHR podem chegar depois
  // que outra faixa assumiu `_activePlayback`; usar o contexto global nesse
  // ponto misturaria um erro antigo com o playback novo.
  let requestContext: AudioTelemetryContext | null = _activePlayback
    ? { ..._activePlayback, source_type: _sourceType(audioUrl) }
    : null;
  const requestTelemetry = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
    requestContext ? _telemetryFor(requestContext, extra) : extra;
  const startedAt = Date.now();
  const requestRetry = (): void => {
    Telemetry.track(
      "music_retry_requested",
      requestTelemetry({ id_music: idCheck, source_type: _sourceType(audioUrl) })
    );
    if (idCheck != null) retryFn(idCheck);
  };
  if (_activePlayback) {
    _activePlayback = { ..._activePlayback, source_type: _sourceType(audioUrl) };
    if (!deferAudioContext) _audio.setTelemetryContext(_activePlayback);
  }
  Telemetry.track(
    "music_audio_load_started",
    requestTelemetry({
      id_music: idCheck,
      remote: ehRemota(audioUrl),
      source_type: _sourceType(audioUrl),
    })
  );
  // Vídeo do YouTube já baixado: o arquivo está no disco e o protocolo atende
  // `Range`, então o <video> lê direto dele. Passar pelo XHR/blob abaixo traria o
  // arquivo inteiro (dezenas a centenas de MB) para a memória antes de tocar — e
  // é justamente o caminho que se usaria sem internet, quando o vídeo baixado
  // mais faz falta.
  // O vídeo que ainda baixa (tocar já) é lido do arquivo em crescimento: passar pelo XHR
  // traria a trilha inteira antes de tocar, que é justamente a espera que se quer evitar.
  const streamsFromDisk =
    audioUrl.startsWith("louvorja://onlinevideo/") || OnlineVideo.isProgressiveUrl(audioUrl);
  if (
    streamsFromDisk ||
    ($appdata.get(KEYS.SHELL.IS_ONLINE) && $userdata.get(KEYS.MODULES.MEDIA.LAZY_LOAD))
  ) {
    if (_activePlayback) {
      _activePlayback = { ..._activePlayback, lazy: true };
      if (!deferAudioContext) _audio.setTelemetryContext(_activePlayback);
      requestContext = { ...requestContext, ..._activePlayback };
    }
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, true);
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.track(
      "music_audio_streaming_started",
      requestTelemetry({ id_music: idCheck, source_type: _sourceType(audioUrl) })
    );
    onSource(audioUrl, true);
    console.info("[Media] arquivo direto em streaming:", {
      kind: $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false) ? "video" : "audio",
      source_type: _sourceType(audioUrl),
      id_music: idCheck,
    });
    return;
  }

  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, false);
  if (_audioXhr) {
    const previousRequest = _audioXhr;
    _audioXhr = null;
    try {
      previousRequest.abort();
    } catch (_) {
      /* ignore */
    }
  }
  const request = new XMLHttpRequest();
  _audioXhr = request;
  try {
    request.open("GET", audioUrl, true);
  } catch (error) {
    if (_audioXhr === request) _audioXhr = null;
    _switchingMode = false;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.captureException(
      error,
      requestTelemetry({ operation: "music_audio_request_open", id_music: idCheck })
    );
    if (!_keepVideoProjectionOnLoadError()) _self.close(true);
    $alert.error({ text: "modules.media.alerts.not_loaded", error }, function (a?: unknown) {
      if (a) requestRetry();
    });
    return;
  }

  request.responseType = "blob";
  request.timeout = NET_TIMEOUT.STALLED;
  request.onload = function (this: XMLHttpRequest) {
    const isCurrentRequest = _audioXhr === request;
    if (isCurrentRequest) _audioXhr = null;
    if (!isCurrentRequest || _loadingId !== idCheck) return;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    const elapsed = Date.now() - startedAt;
    if (
      this.status >= 200 &&
      this.status < 300 &&
      this.response instanceof Blob &&
      this.response.size > 0
    ) {
      Telemetry.histogram("louvorja.music.audio.load.duration", elapsed, {
        outcome: "completed",
        source_type: _sourceType(audioUrl),
      });
      Telemetry.track(
        "music_audio_loaded",
        requestTelemetry({
          id_music: idCheck,
          status: this.status,
          bytes: this.response.size,
          content_type: this.response.type,
          elapsed_ms: elapsed,
        })
      );
      Telemetry.track(
        "music_audio_transfer_completed",
        requestTelemetry({
          id_music: idCheck,
          status: this.status,
          bytes: this.response.size,
          content_type: this.response.type,
          elapsed_ms: elapsed,
        })
      );
      if (ehRemota(audioUrl)) reportNetworkResult(true, "media");
      const sourceUrl = URL.createObjectURL(this.response as Blob);
      onSource(sourceUrl, false);
      console.info("[Media] arquivo direto transferido:", {
        source_type: _sourceType(audioUrl),
        bytes: this.response.size,
        content_type: this.response.type || "unknown",
        elapsed_ms: elapsed,
      });
    } else {
      Telemetry.histogram("louvorja.music.audio.load.duration", elapsed, {
        outcome: "invalid_response",
        source_type: _sourceType(audioUrl),
      });
      _switchingMode = false;
      if (!_keepVideoProjectionOnLoadError()) _self.close(true);
      Telemetry.track(
        "music_audio_load_failed",
        requestTelemetry({
          id_music: idCheck,
          reason: this.status >= 200 && this.status < 300 ? "empty_or_invalid_body" : "http_status",
          status: this.status,
          status_text: request.statusText,
          bytes: this.response?.size,
          content_type: this.response?.type,
          elapsed_ms: elapsed,
        })
      );
      Telemetry.track(
        "music_playback_failed",
        requestTelemetry({
          stage: "transfer",
          reason: this.status >= 200 && this.status < 300 ? "empty_or_invalid_body" : "http_status",
          status: this.status,
          elapsed_ms: elapsed,
        })
      );
      $alert.error(
        { text: "modules.media.alerts.not_loaded", error: request.statusText || "" },
        function (a?: unknown) {
          if (a) requestRetry();
        }
      );
    }
  };
  const falhaDeRede = function (event?: Event) {
    const isCurrentRequest = _audioXhr === request;
    if (isCurrentRequest) _audioXhr = null;
    if (!isCurrentRequest || _loadingId !== idCheck) return;
    _switchingMode = false;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    // No desktop o áudio vem por `louvorja://`, que é o protocolo lendo disco:
    // falhar ali é arquivo ausente, não internet fora. Reportar isso derrubava
    // o app para offline com a rede intacta.
    if (ehRemota(audioUrl)) reportNetworkResult(false, "media");
    if (!_keepVideoProjectionOnLoadError()) _self.close(true);
    const reason = event?.type === "timeout" ? "timeout" : "network_error";
    const elapsed = Date.now() - startedAt;
    Telemetry.histogram("louvorja.music.audio.load.duration", elapsed, {
      outcome: reason,
      source_type: _sourceType(audioUrl),
    });
    Telemetry.track(
      "music_audio_load_failed",
      requestTelemetry({
        id_music: idCheck,
        reason,
        remote: ehRemota(audioUrl),
        elapsed_ms: elapsed,
      })
    );
    Telemetry.track(
      "music_playback_failed",
      requestTelemetry({
        stage: "transfer",
        reason,
        remote: ehRemota(audioUrl),
        elapsed_ms: Date.now() - startedAt,
      })
    );
    // Um modal aqui obriga o operador a fechar diálogo com o culto rolando, e
    // sem rede ele volta a cada música. O aviso leva a repetição no clique.
    const t = i18nAtual()?.global?.t;
    $snackbar.warning(
      t ? t("modules.media.alerts.not_loaded_offline") : "Não foi possível baixar este áudio.",
      {
        key: "media-offline",
        timeout: 6000,
        action: requestRetry,
      }
    );
  };
  request.onerror = falhaDeRede;
  request.ontimeout = falhaDeRede;
  request.onabort = function () {
    const isCurrentRequest = _audioXhr === request;
    if (isCurrentRequest) _audioXhr = null;
    if (!isCurrentRequest || _loadingId !== idCheck) return;
    _switchingMode = false;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.track(
      "music_audio_load_failed",
      requestTelemetry({ id_music: idCheck, reason: "aborted", elapsed_ms: Date.now() - startedAt })
    );
    Telemetry.track(
      "music_playback_failed",
      requestTelemetry({ stage: "transfer", reason: "aborted" })
    );
  };

  // LOADING só cai nos handlers: o blob ainda está sendo baixado aqui, e
  // liberar a UI antes disso deixa o usuário apertar Play num <audio> sem
  // fonte — que rejeita com "no supported source was found".
  try {
    request.send();
  } catch (error) {
    if (_audioXhr === request) _audioXhr = null;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.captureException(
      error,
      requestTelemetry({ operation: "music_audio_request_send", id_music: idCheck })
    );
    Telemetry.track(
      "music_playback_failed",
      requestTelemetry({ stage: "transfer", reason: "request_send" })
    );
    if (!_keepVideoProjectionOnLoadError()) _self.close(true);
  }
}

// Mantém $appdata sincronizado com o estado reativo de useSlides
// (Player.vue, Footer.vue e media/Index.vue ainda leem de $appdata)
watch(
  _slides.slideIndex,
  (si) => {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, si);
  },
  { flush: "sync" }
);
watch(
  _slides.slideProgress,
  (sp) => {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_PROGRESS, sp);
  },
  { flush: "sync" }
);
watch(
  _slides.totalSlides,
  (n) => {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAST_SLIDE, n);
  },
  { flush: "sync" }
);

// Throttle para evitar sobrecarga de broadcasts de sincronia de vídeo
let _lastVideoSync = 0;
const _VIDEO_SYNC_INTERVAL = 500; // ms entre broadcasts de sincronia

const _uiSyncGate = createRateGate(PROGRESS_UI_INTERVAL_MS);
let _uiSyncTime = 0;
let _uiSyncDuration = 0;

// Callback de timeUpdate: mantém $appdata de timing e fecha ao fim da música.
_audio.onTimeUpdate((ct, d) => {
  // Salto de posição (seek) ou duração nova aparece na hora; o resto segue o ritmo do gate.
  const jumped = Math.abs(ct - _uiSyncTime) > 1 || d !== _uiSyncDuration;
  if (_uiSyncGate(jumped)) {
    _uiSyncTime = ct;
    _uiSyncDuration = d;
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, ct);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, d);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, _audio.progress.value);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.BUFFERED, _audio.buffered.value);
  }

  if (!_audio.isPaused.value && ct >= d && d > 0 && !_switchingMode) {
    if (_playlistOnEnd) {
      const handled = _playlistOnEnd();
      if (!handled) {
        _self.close(true, true);
      }
    } else {
      _self.close(true, true);
    }
  }

  // Sincronia contínua de vídeo: broadcast periódico para manter o <video>
  // das janelas de projeção sincronizado com o <audio> oculto.
  const now = Date.now();
  if (
    !$appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED) &&
    now - _lastVideoSync >= _VIDEO_SYNC_INTERVAL
  ) {
    _lastVideoSync = now;
    _broadcastVideoState();
  }
});

function _lyricEntries(data: Music): Lyric[] {
  const lyric = data?.lyric;
  if (Array.isArray(lyric)) return lyric;
  if (lyric && typeof lyric === "object") return Object.values(lyric);
  return [];
}

function _buildSlidesFrom(data: Music): Slide[] {
  let prev_image: string | undefined = data?.url_image as string | undefined;
  let prev_image_position: string | number | undefined = data?.image_position;
  const lyricEntries = _lyricEntries(data);

  return [
    {
      lyric: data?.name,
      cover: true,
      time: "00:00:00",
      instrumental_time: "00:00:00",
      url_image: data?.url_image as string | undefined,
      image_position: data?.image_position,
      id_music: data?.id_music,
    },
    ...lyricEntries
      .filter((lyric) => lyric.show_slide === 1)
      .sort((a, b) => a.order - b.order)
      .map((lyric) => {
        if (lyric.url_image) {
          prev_image = lyric.url_image as string;
          prev_image_position = lyric.image_position;
        }
        return {
          ...lyric,
          cover: false,
          lyric: lyric.lyric ? lyric.lyric.replace(/[\r\n]+/g, "<br>") : "",
          url_image: prev_image,
          image_position: prev_image_position,
          id_music: data?.id_music,
        };
      }),
  ];
}

/** Marcações de troca de slide da faixa pedida — cantada e playback têm as suas. */
function _timesFor(slides: Slide[], mode: string): number[] {
  if (mode !== MusicActionEnum.AUDIO && mode !== MusicActionEnum.INSTRUMENTAL) return [];
  return slides.map((item) =>
    $datetime.toNumber(
      (mode === MusicActionEnum.AUDIO ? item.time : item.instrumental_time) as string
    )
  );
}

const _self = {
  /** ID da tentativa atual para os módulos que orquestram a reprodução. */
  getActivePlaybackId(): string | null {
    return _activePlayback?.playback_id || null;
  },

  /** Responde com o relógio atual, inclusive quando a reprodução está pausada. */
  broadcastVideoStateForRequest(playbackId?: string): void {
    if (_isYouTube() && shouldRespondToVideoStateRequest(
      playbackId, _activePlayback?.playback_id, true
    )) {
      _broadcastYoutubeStateForRequest();
      return;
    }
    if (!shouldRespondToVideoStateRequest(
      playbackId, _activePlayback?.playback_id,
      Boolean($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE))
    )) return;
    _broadcastVideoState();
  },

  async open(params: MediaOpenParams | string | number): Promise<void> {
    params = _openParams(params);
    const requestedId = params.id_music;
    if (!((typeof requestedId === "string" && requestedId.trim().length > 0) ||
      (typeof requestedId === "number" && Number.isFinite(requestedId)))) return;

    $dev.write("open media", params);
    const playback_id = _newPlaybackId();
    const requestedMode = params.mode || "no_audio";
    const playbackContext: AudioTelemetryContext = {
      playback_id,
      id_music: params.id_music,
      mode: requestedMode,
    };
    Telemetry.track("music_open_requested", {
      playback_id,
      id_music: params.id_music,
      mode: requestedMode,
      id_album: params.id_album,
      minimized: params.minimized,
    });

    // Conexão remota está ativada? Se sim, abre do programa desktop
    if ($userdata.get(KEYS.REMOTE.IS_CONNECTED)) {
      _setPlaybackContext(playbackContext);
      const tag = params.mode == "audio" ? 1 : params.mode == "instrumental" ? 2 : 3;
      const baseUrl = $userdata.get(KEYS.REMOTE.URL);
      const token = $userdata.get(KEYS.REMOTE.TOKEN);

      $alert.info("modules.media.alerts.open_remote");
      const remoteStartedAt = Date.now();
      Telemetry.track(
        "music_remote_open_started",
        _telemetryFor(playbackContext, { stage: "remote_request" })
      );
      try {
        const response = await fetchWithTimeout(`${baseUrl}/api/open-song?token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: params.id_music, tag }),
          mode: "cors",
          timeout: NET_TIMEOUT.DEFAULT,
          source: "open-song",
        });
        const ret = await response.json();
        Telemetry.track(
          "music_remote_open_completed",
          _telemetryFor(playbackContext, {
            status: response.status,
            ok: response.ok,
            elapsed_ms: Date.now() - remoteStartedAt,
            response_code: ret?.code,
          })
        );
        if (ret.status != "ok") {
          Telemetry.track(
            "music_playback_failed",
            _telemetryFor(playbackContext, {
              stage: "remote_request",
              reason: ret.code || "remote_rejected",
              status: response.status,
              response_code: ret.code,
            })
          );
          $alert.error({
            text:
              ret.code == "INVALID_TOKEN"
                ? "modules.remote_control.messages.invalid_token"
                : "modules.remote_control.messages.error",
            error: ret.code,
          });
        }
      } catch (error) {
        Telemetry.captureException(
          error,
          _telemetryFor(playbackContext, {
            operation: "music_remote_open",
            elapsed_ms: Date.now() - remoteStartedAt,
          })
        );
        Telemetry.track(
          "music_playback_failed",
          _telemetryFor(playbackContext, {
            stage: "remote_request",
            reason: "remote_open_failed",
            elapsed_ms: Date.now() - remoteStartedAt,
          })
        );
        $alert.error({ text: "modules.remote_control.messages.error", error });
      }
      return;
    }

    const stageEpoch = ++_stageEpoch;
    _dropPendingDownload();
    _opening.value = null;
    await _releaseFileVideoStage(stageEpoch);
    if (stageEpoch !== _stageEpoch) return;

    // Crossfade: se há audio tocando, faz fade out antes de carregar a nova música
    const _existingAudio = _audio.getElement();
    if (
      !_existingAudio.paused &&
      _existingAudio.src &&
      $userdata.get(KEYS.MODULES.MEDIA.FADE_AUDIO, false)
    ) {
      await new Promise<void>((resolve) => {
        _audio.fadeOut(() => {
          _audio.stop();
          resolve();
        });
      });
    } else {
      _audio.stop();
    }

    this.clearVariables();
    // O player compartilhado também reproduz arquivos de vídeo. Um
    // HTMLAudioElement consegue tocar alguns MP4, mas falha silenciosamente em
    // outros codecs e deixa a projeção visual sem relógio confiável.
    _audio.setElementKind("audio");
    // `clearVariables` encerra o contexto anterior; a requisição de metadata
    // pertence à tentativa que acabou de ser criada acima.
    _setPlaybackContext(playbackContext);

    const id_music = params.id_music;
    const minimizeOnStart = $userdata.get(KEYS.OPTIONS.MINIMIZE_ON_START, false);
    const minimized = params.minimized !== undefined ? params.minimized : minimizeOnStart;
    const id_album = params.id_album ? params.id_album : null;
    let mode: string = params.mode ? params.mode : "no_audio";

    _loadingId = id_music ?? null;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);

    let data: Music | null;
    const metadataStartedAt = Date.now();
    Telemetry.track("music_metadata_load_started", _telemetryFor(playbackContext, { id_music }));
    let metadataTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const metadataRequest = $database.get<Music>(`music_${id_music}`);
      const metadataDeadline = new Promise<never>((_, reject) => {
        metadataTimeout = setTimeout(
          () => reject(new Error(`Music metadata timeout: ${id_music}`)),
          NET_TIMEOUT.DEFAULT + 5000
        );
      });
      data = await Promise.race([metadataRequest, metadataDeadline]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = message.includes("metadata timeout")
        ? "metadata_timeout"
        : "metadata_exception";
      Telemetry.captureException(
        error,
        _telemetryFor(playbackContext, {
          operation: "music_metadata_load",
          elapsed_ms: Date.now() - metadataStartedAt,
          reason,
        })
      );
      Telemetry.track(
        "music_open_failed",
        _telemetryFor(playbackContext, {
          id_music,
          reason,
          elapsed_ms: Date.now() - metadataStartedAt,
        })
      );
      if (_loadingId === id_music && _activePlayback?.playback_id === playback_id) this.close(true);
      return;
    } finally {
      if (metadataTimeout) clearTimeout(metadataTimeout);
    }
    Telemetry.track(
      "music_metadata_load_completed",
      _telemetryFor(playbackContext, {
        id_music,
        found: data != null,
        elapsed_ms: Date.now() - metadataStartedAt,
      })
    );
    const isCurrentPlayback = _activePlayback?.playback_id === playback_id;
    if (data == null || _loadingId !== id_music || !isCurrentPlayback) {
      Telemetry.track(
        "music_open_failed",
        _telemetryFor(playbackContext, {
          id_music,
          reason: data == null ? "not_found" : "superseded",
        })
      );
      if (data == null && _loadingId === id_music && isCurrentPlayback) this.close(true);
      return;
    }
    Telemetry.track("music_opened", {
      playback_id,
      id_music,
      name: data.name,
      mode,
      id_album,
      duration: data.duration,
      has_audio: !!data.url_music,
      has_instrumental_audio: !!data.url_instrumental_music,
      slides_count: _lyricEntries(data).length,
      stage: "metadata_only",
    });
    Telemetry.track(
      "music_metadata_resolved",
      _telemetryFor(playbackContext, {
        name: data.name,
        duration: data.duration,
        has_audio: !!data.url_music,
        has_instrumental_audio: !!data.url_instrumental_music,
        slides_count: _lyricEntries(data).length,
      })
    );
    $appdata.set(KEYS.MODULES.MEDIA.DATA, data);
    $history.add(id_music, data.name, !!data.url_instrumental_music);

    $appdata.set(KEYS.MODULES.MEDIA.ID_MUSIC, id_music);
    $appdata.set(KEYS.MODULES.MEDIA.ID_ALBUM, id_album);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, data.name);
    this.setAlbumInfo(id_album);

    const slidesArray = _buildSlidesFrom(data);
    const timesArray = _timesFor(slidesArray, mode);

    let audioUrl: string | null = null;
    if (mode == "audio" || mode == "instrumental") {
      const rawAudioPath = mode == "audio" ? data.url_music : data.url_instrumental_music;
      if (!rawAudioPath) {
        Telemetry.track(
          "music_playback_failed",
          _telemetryFor(playbackContext, {
            stage: "source_resolution",
            reason: "audio_path_missing",
          })
        );
        $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
        this.close(true);
        return;
      }
      try {
        audioUrl = $path.file(rawAudioPath as string);
      } catch (error) {
        Telemetry.captureException(
          error,
          _telemetryFor(playbackContext, { operation: "music_source_resolution" })
        );
        Telemetry.track(
          "music_playback_failed",
          _telemetryFor(playbackContext, {
            stage: "source_resolution",
            reason: "invalid_audio_path",
          })
        );
        $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
        this.close(true);
        return;
      }
    }

    this._launchProjection({
      slides: slidesArray,
      times: timesArray,
      title: data.name ?? "",
      audioUrl,
      idCheck: id_music,
      retryFn: (id) => _self.open(id),
      minimized: !!minimized,
      mode,
      playbackId: playback_id,
    });
  },

  /**
   * Troca cantada ↔ playback ↔ sem áudio na música que já está no ar sem voltar
   * ao começo: o slide continua onde estava e a faixa nova entra no ponto
   * equivalente. Fora desse caso (YouTube, só-áudio, nada aberto) delega ao
   * `open`, que recomeça do zero.
   */
  switchMode(mode: MusicActionEnum): void {
    const idMusic = $appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC) as string | number | null;
    if (idMusic == null) return;
    const previousPlaybackId = _activePlayback?.playback_id;
    Telemetry.track("music_mode_switch_requested", {
      playback_id: previousPlaybackId,
      id_music: idMusic,
      mode,
      previous_mode: $appdata.get(KEYS.MODULES.MEDIA.CONFIG.MODE),
    });

    const keepsPosition =
      !_isYouTube() &&
      !$appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY) &&
      _slides.totalSlides.value > 0;
    if (!keepsPosition) {
      this.open({ id_music: idMusic, mode, minimized: this.isMinimized() });
      return;
    }

    const current = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.MODE) as string;
    if (mode === current) return;

    const data = $appdata.get(KEYS.MODULES.MEDIA.DATA) as Music | null;
    const file =
      mode === MusicActionEnum.AUDIO
        ? (data?.url_music as string | undefined)
        : mode === MusicActionEnum.INSTRUMENTAL
          ? (data?.url_instrumental_music as string | undefined)
          : undefined;
    if (mode !== MusicActionEnum.NO_AUDIO && !file) {
      Telemetry.track(
        "music_mode_switch_failed",
        _audioTelemetry({
          id_music: idMusic,
          mode,
          previous_mode: current,
          reason: "audio_path_missing",
        })
      );
      return;
    }

    const hadAudio = current === MusicActionEnum.AUDIO || current === MusicActionEnum.INSTRUMENTAL;

    if (mode === MusicActionEnum.NO_AUDIO) {
      _slides.unbindAudio();
      _audio.stop();
      const noAudioContext: AudioTelemetryContext = {
        playback_id: _newPlaybackId(),
        id_music: idMusic,
        mode,
        source_type: "none",
        parent_playback_id: previousPlaybackId,
      };
      _setPlaybackContext(noAudioContext);
      _slides.setPlaybackId(noAudioContext.playback_id);
      Telemetry.track(
        "music_mode_switch_started",
        _telemetryFor(noAudioContext, { id_music: idMusic, mode, previous_mode: current })
      );
      _audio.currentTime.value = 0;
      _audio.duration.value = 0;
      _audio.progress.value = 0;
      _audio.buffered.value = 0;
      _slides.setTimes([]);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "");
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.BUFFERED, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      _slides.broadcastSlide();
      Telemetry.track(
        "music_mode_switch_completed",
        _telemetryFor(noAudioContext, { id_music: idMusic, mode, previous_mode: current })
      );
      return;
    }

    let audioUrl: string;
    try {
      audioUrl = $path.file(file as string);
    } catch (error) {
      Telemetry.captureException(
        error,
        _audioTelemetry({ operation: "music_mode_source_resolution" })
      );
      Telemetry.track(
        "music_mode_switch_failed",
        _audioTelemetry({
          id_music: idMusic,
          mode,
          previous_mode: current,
          reason: "invalid_audio_path",
        })
      );
      return;
    }
    const switchPlaybackId = _newPlaybackId();
    const switchContext: AudioTelemetryContext = {
      playback_id: switchPlaybackId,
      id_music: idMusic,
      mode,
      source_type: _sourceType(audioUrl),
      parent_playback_id: previousPlaybackId,
    };
    // A faixa anterior continua audível enquanto a nova baixa. Mantemos o
    // contexto do elemento de áudio antigo até o takeover, mas já reservamos
    // o ID novo para callbacks da requisição e do preparo.
    _activePlayback = switchContext;
    Telemetry.track(
      "music_mode_switch_started",
      _telemetryFor(switchContext, { id_music: idMusic, mode, previous_mode: current })
    );
    _loadingId = idMusic;
    _switchingMode = true;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);

    // A faixa que está no ar continua tocando enquanto a nova baixa: quem troca
    // no meio do louvor não pode ficar com a igreja em silêncio pelo tempo do
    // download. Por isso o ponto de retomada só é lido aqui, quando a faixa
    // nova assume — lê-lo no clique faria o áudio voltar o que tocou desde lá.
    _loadAudioSrc(
      audioUrl,
      idMusic,
      (id) => _self.open(id),
      (src, lazy) => {
        _audio
          .prepare(src, lazy, _audio.currentTime.value, switchContext)
          .then((faixa) => {
            // Outra música entrou no ar durante o carregamento: esta não serve
            // mais, e o blob dela só sai da memória se alguém soltar.
            if (_loadingId !== idMusic) {
              _audio.release(faixa);
              return;
            }
            _switchingMode = false;

            // Lido só agora, com a faixa nova pronta para entrar: ler no clique
            // faria o áudio voltar tudo que tocou enquanto ela carregava.
            const slideIndex = _slides.slideIndex.value;
            const fraction = hadAudio ? _slides.slideProgress.value / 100 : 0;
            const playing = !hadAudio || !_audio.isPaused.value;

            // Com o watcher ligado, o tempo da faixa nova ainda em zero jogaria a
            // projeção na capa e de volta, à vista da igreja.
            _slides.unbindAudio();
            _slides.setTimes(_timesFor(_slides.slides.value, mode));

            return _audio
              .takeOver(faixa, (d) => _slides.timeForPosition(slideIndex, fraction, d), playing)
              .then(() => {
                _setPlaybackContext(switchContext);
                _slides.setPlaybackId(switchPlaybackId);
                _slides.bindAudio(_audio);
                $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, !playing);
                if (!playing) _self.broadcastSlide();
                Telemetry.track(
                  "music_mode_switch_completed",
                  _telemetryFor(switchContext, { id_music: idMusic, mode, previous_mode: current })
                );
              });
          })
          .catch((error) => {
            // A faixa não quis carregar em paralelo; o caminho normal reabre a
            // música e traz junto o tratamento de erro de sempre.
            _switchingMode = false;
            Telemetry.captureException(
              error,
              _telemetryFor(switchContext, { operation: "music_mode_switch_prepare" })
            );
            Telemetry.track(
              "music_mode_switch_failed",
              _telemetryFor(switchContext, {
                id_music: idMusic,
                mode,
                previous_mode: current,
                reason: error?.name || "prepare_failed",
              })
            );
            _self.open({ id_music: idMusic, mode, minimized: _self.isMinimized() });
          });
      },
      true
    );
  },

  /**
   * Executa uma música personalizada (Coletâneas Pessoais / Editor de Músicas).
   *
   * Monta os slides no useSlides, toca o áudio (se houver audio_token) com
   * sincronia, marca a mídia como ativa (para o ESC global oferecer
   * confirmação de encerramento) e abre as janelas de projeção.
   */
  async openCustomSong(song: {
    nome?: string;
    audio_token?: string;
    audio_name?: string;
    slides?: Array<{
      tipo?: string;
      letra?: string;
      letra_aux?: string;
      cor_letra?: string;
      cor_letra_aux?: string;
      imagem?: string;
      imagem_posicao?: number | string;
      tamanho_letra?: number;
      tamanho_letra_aux?: number;
      tempo_seconds?: number;
    }>;
  }): Promise<void> {
    const stageEpoch = ++_stageEpoch;
    _dropPendingDownload();
    _opening.value = null;
    await _releaseFileVideoStage(stageEpoch);
    if (stageEpoch !== _stageEpoch) return;
    $dev.write("open custom song", song?.nome);
    const playback_id = _newPlaybackId();
    const playbackContext: AudioTelemetryContext = {
      playback_id,
      mode: "audio",
      title: song?.nome,
    };
    Telemetry.track("custom_music_opened", {
      playback_id,
      name: song?.nome,
      slides_count: Array.isArray(song?.slides) ? song.slides.length : 0,
      has_audio: !!song?.audio_token,
    });

    _audio.stop();
    this.clearVariables();
    _audio.setElementKind("audio");
    _setPlaybackContext(playbackContext);

    const slidesArray: Slide[] = [];
    const timesArray: number[] = [];
    for (const s of song.slides || []) {
      let urlImage: string | undefined;
      if (s.imagem) {
        urlImage = (await AudioLibrary.resolveImage(s.imagem)) || undefined;
        if (_activePlayback?.playback_id !== playback_id) {
          Telemetry.track(
            "custom_music_open_failed",
            _telemetryFor(playbackContext, { reason: "superseded" })
          );
          return;
        }
      }
      slidesArray.push({
        lyric: s.letra || "",
        aux_lyric: s.letra_aux || "",
        url_image: urlImage,
        image_position: typeof s.imagem_posicao === "number" ? s.imagem_posicao - 1 : 4,
        cover: s.tipo === "CAPA",
        tipo: s.tipo,
        color: s.cor_letra,
        color_aux: s.cor_letra_aux,
        font_size_pct: s.tamanho_letra,
        font_size_aux_pct: s.tamanho_letra_aux,
        name: song.nome || "",
      });
      // tempo_seconds é o instante de INÍCIO do slide (mesma convenção do
      // Media.open com os campos time do banco) — usar direto, sem acumular.
      timesArray.push(Number(s.tempo_seconds) || 0);
    }
    if (!slidesArray.length) {
      this.close(true);
      return;
    }

    const audioUrl = song.audio_token
      ? (await AudioLibrary.resolveAudio(song.audio_token)) || null
      : null;
    if (_activePlayback?.playback_id !== playback_id) {
      Telemetry.track(
        "custom_music_open_failed",
        _telemetryFor(playbackContext, { reason: "superseded" })
      );
      return;
    }

    if (song.audio_token && !audioUrl) {
      Telemetry.track(
        "music_playback_failed",
        _telemetryFor(playbackContext, {
          stage: "source_resolution",
          reason: "custom_audio_not_found",
        })
      );
    }

    _loadingId = null;
    const minimizeOnStart = $userdata.get(KEYS.OPTIONS.MINIMIZE_ON_START, false);

    this._launchProjection({
      slides: slidesArray,
      times: timesArray,
      title: song.nome || "",
      audioUrl,
      idCheck: null,
      retryFn: () => {},
      minimized: !!minimizeOnStart,
      mode: "audio",
      playbackId: playback_id,
    });
  },

  /**
   * Helper compartilhado entre `open` e `openCustomSong`: registra os slides,
   * transmite SLIDES_DATA, marca a mídia ativa e dispara o pipeline de áudio
   * (via _loadAudioSrc — lazy-load/erro/retry) e a abertura das projeções.
   */
  _launchProjection(opts: {
    slides: Slide[];
    times: number[];
    title: string;
    audioUrl: string | null;
    idCheck: string | number | null;
    retryFn: (id: string | number) => void;
    minimized: boolean;
    mode: string;
    playbackId?: string;
  }): void {
    const projectionContext: AudioTelemetryContext | null = opts.playbackId
      ? {
          playback_id: opts.playbackId,
          id_music: opts.idCheck,
          mode: opts.mode,
          source_type: opts.audioUrl ? _sourceType(opts.audioUrl) : "none",
          title: opts.title,
        }
      : null;
    if (opts.playbackId) {
      _setPlaybackContext(projectionContext);
    }
    _slides.setSlides(opts.slides, opts.times, opts.title, opts.playbackId);
    // A capa precisa existir antes de carregar áudio, inclusive quando o
    // decoder falha, o player fica pausado ou uma janela abre nesse intervalo.
    // O core é a fonte visual; o relógio só seleciona slides posteriores.
    if (opts.slides.length > 0) _slides.broadcastSlide();
    const presentationSession = _slides.presentationSnapshot()?.sessionId;

    $broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
      slides: opts.slides,
      title: opts.title,
      slide_index: 0,
      playback_id: opts.playbackId,
      presentation_session: presentationSession,
    });

    if (opts.minimized) {
      this.minimize();
    } else {
      this.maximize();
    }

    if (opts.audioUrl) {
      const volume = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME);
      _audio.setVolume(volume as number);
      _audio.getElement().currentTime = 0;
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, opts.audioUrl);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false);
      _slides.bindAudio(_audio);
      _loadAudioSrc(opts.audioUrl, opts.idCheck, opts.retryFn);
    } else {
      Telemetry.track("music_playback_skipped", _audioTelemetry({ reason: "no_audio_mode" }));
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "");
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false);
      $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
      // A capa já foi publicada antes de iniciar os efeitos de mídia.
    }

    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, opts.mode);

    // Replica fmMusica + fmMusicaRetorno + fmMusicaOperador do Delphi:
    // ao iniciar uma música, abre as janelas auxiliares conforme
    // configurado em "Configurações → Slides de Músicas".
    _afterStageWindowCloses(_stageEpoch, openProjectionWindows).catch((e) => {
      console.warn("[Media] openProjectionWindows falhou:", e);
      const properties = projectionContext
        ? _telemetryFor(projectionContext, { operation: "music_projection_open" })
        : { operation: "music_projection_open" };
      Telemetry.captureException(e, properties);
      Telemetry.track("music_projection_failed", {
        ...(projectionContext || {}),
        reason: "window_open_failed",
      });
    });
  },

  stop(): void {
    ++_stageEpoch;
    _dropPendingDownload();
    _opening.value = null;
    if (_ytUnlisten) {
      _ytUnlisten();
      _ytUnlisten = null;
    }
    _audio.stop();
    this.clearVariables();
    _slides.reset();
    $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, false);
  },

  /** O editor assume as janelas de slides; um player de arquivo/vídeo anterior precisa sair. */
  stopForSlideEditor(): Promise<void> {
    const wasFileVideo = _isYouTube() || _keepVideoProjectionOnLoadError();
    this.stop();
    const released = _releaseFileVideoStage(_stageEpoch, wasFileVideo);
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
    return released;
  },

  /** Serialized stage-window ownership for the editor's start/stop controls. */
  openProjectionStage(): Promise<void> {
    return _afterStageWindowCloses(_stageEpoch, openProjectionWindows);
  },

  closeProjectionStage(): Promise<void> {
    const stageEpoch = ++_stageEpoch;
    return _queueStageWindows(stageEpoch, closeProjectionWindows);
  },

  /** Reserva a projeção FILE para imagem, PDF ou vídeo vindos da liturgia, acervo ou controle remoto. */
  async projectFile(
    payload: { url: string; type: "image" | "pdf" | "video"; title?: string; [key: string]: unknown },
    videoAudioUrl?: string,
    { stopExistingAudio = false }: { stopExistingAudio?: boolean } = {}
  ): Promise<boolean> {
    if (!payload || typeof payload.url !== "string" || !payload.url ||
      !["image", "pdf", "video"].includes(payload.type)) return false;
    const projection = {
      ...payload,
      playback_id: typeof payload.playback_id === "string" && payload.playback_id
        ? payload.playback_id : _newPlaybackId(),
    };
    const stageEpoch = ++_stageEpoch;
    _dropPendingDownload();
    _opening.value = null;
    const wasYouTube = _isYouTube();
    const editorOrYouTube = wasYouTube ||
      $userdata.get<boolean>(KEYS.MODULES.SLIDE_EDITOR.PROJECTING, false) === true;
    if (_ytUnlisten) {
      _ytUnlisten();
      _ytUnlisten = null;
    }
    if (wasYouTube || stopExistingAudio) {
      _audio.stop();
      this.clearVariables();
      $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
    } else {
      // Liturgia, timer e HTTP historicamente mostram imagem/PDF sobre uma
      // música ainda audível. Retira só o slide musical do telão.
      _slides.reset();
    }
    if (editorOrYouTube) $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);

    await _queueStageWindows(stageEpoch, closeMusicProjectionWindows);
    if (stageEpoch !== _stageEpoch) return false;
    try {
      localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, JSON.stringify(projection));
      localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
    } catch { /* cache de reabertura opcional */ }
    try {
      await _afterStageWindowCloses(stageEpoch, _openTrackedFileWindows);
    } catch (error) {
      Telemetry.captureException(error, { operation: "file_projection_open" });
    }
    if (stageEpoch !== _stageEpoch) return false;
    $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, projection);
    if (projection.type === "video" && videoAudioUrl) {
      await this.openAudio({ url: videoAudioUrl, title: projection.title || "", mediaType: "video" }, true);
    }
    return stageEpoch === _stageEpoch;
  },

  /**
   * @param keepPendingDownload  o fim natural da mídia não cancela o vídeo do YouTube que
   *   o operador pediu enquanto ela tocava; qualquer outro fechamento cancela.
   */
  close(
    force = false,
    keepPendingDownload = false,
    keepProjectionWindows = false,
    preserveStageEpoch = false
  ): void {
    if (force && !preserveStageEpoch) {
      ++_stageEpoch;
      _opening.value = null;
      _closeFileWindowsAfterPendingOpen(_stageEpoch);
    }
    if (force && !keepPendingDownload) _dropPendingDownload();
    if (_isYouTube()) {
      if (!force) {
        const key = "modules.media.alerts.close";
        const self = this;
        $alert.yesno({ title: key }, function (btn?: string) {
          if (btn == "yes") self.close(true);
        });
        return;
      }

      if (_ytUnlisten) {
        _ytUnlisten();
        _ytUnlisten = null;
      }

      try {
        localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
        localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
      } catch {
        /* ignore */
      }

      this.clearVariables();
      $appdata.set(KEYS.MODULES.MEDIA.SHOW, false);
      $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
      $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, false);
      $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
      if (!keepProjectionWindows) _queueStageWindows(_stageEpoch, closeProjectionWindows).catch((e) => {
        console.warn("[Media] closeProjectionWindows falhou:", e);
      });
      return;
    }

    if (!force) {
      const self = this;
      const key = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY)
        ? "modules.media.alerts.close_audio"
        : "modules.media.alerts.close";
      $alert.yesno({ title: key }, function (btn?: string) {
        if (btn == "yes") self.close(true);
      });
      return;
    }

    _audio.stop();
    this.clearVariables();
    $appdata.set(KEYS.MODULES.MEDIA.SHOW, false);
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
    $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, false);

    // Reseta o estado de slides — sem isso o `useSlides.slides` retém o
    // último array, e qualquer janela/cliente que reabra fica vendo a
    // música anterior.
    _slides.reset();

    // O payload de arquivo é apenas o cache de reabertura enquanto a mídia
    // está ativa. Remover no fechamento explícito evita ressuscitar um vídeo
    // antigo caso todas as janelas de projeção já tenham sido fechadas.
    try {
      localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
      localStorage.removeItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION);
    } catch {
      /* ignore */
    }

    // Avisa janelas locais (Projection, ProjectionReturn) e clients
    // remotos (SSE) para limparem a tela. Sem este broadcast, OBS continua
    // mostrando a letra mesmo depois de fechar a música.
    $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);

    // Fecha janelas auxiliares (espelha o fmMusica.Close do Delphi).
    if (!keepProjectionWindows) _queueStageWindows(_stageEpoch, closeProjectionWindows).catch((e) => {
      console.warn("[Media] closeProjectionWindows falhou:", e);
    });
  },

  async openLyric(params?: LyricOpenParams | string | number | null): Promise<void> {
    if (params == null || params == undefined) {
      params = {
        id_music: $appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC) as string | number,
        id_album: $appdata.get(KEYS.MODULES.MEDIA.ID_ALBUM) as string | number | null,
      };
    } else if (typeof params != "object") {
      params = { id_music: params };
    }
    Telemetry.track("music_lyrics_opened", {
      id_music: params.id_music,
      id_album: params.id_album,
    });

    const ok = await _lyric.open(params as LyricOpenParams);
    if (!ok) {
      this.closeLyric();
      return;
    }

    $appdata.set(KEYS.MODULES.LYRIC.SHOW, true);
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
  },

  closeLyric(): void {
    _lyric.close();
    $appdata.set(KEYS.MODULES.LYRIC.SHOW, false);
  },

  async openAlbum(id_album: string | number): Promise<void> {
    Telemetry.track("music_album_open_requested", { id_album });
    const { redirect } = await _album.open(id_album);
    if (redirect) $modules.open(redirect);
  },

  closeAlbum(): void {
    _album.close();
  },

  async openAudio(params: MediaOpenParams | string | number, preserveProjectionStage = false): Promise<void> {
    params = _openParams(params);
    const stageEpoch = preserveProjectionStage ? _stageEpoch : ++_stageEpoch;
    if (!preserveProjectionStage) {
      _dropPendingDownload();
      _opening.value = null;
    }
    if (params.mediaType !== "video") {
      await _releaseFileVideoStage(stageEpoch);
      if (stageEpoch !== _stageEpoch) return;
    } else if (!preserveProjectionStage) {
      if ($userdata.get<boolean>(KEYS.MODULES.SLIDE_EDITOR.PROJECTING, false) === true)
        $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
      await _queueStageWindows(stageEpoch, closeMusicProjectionWindows);
      if (stageEpoch !== _stageEpoch) return;
    }
    const playback_id = _newPlaybackId();
    const audioMode = params.mode || "audio";
    const playbackContext: AudioTelemetryContext = {
      playback_id,
      id_music: params.id_music,
      mode: audioMode,
      title: params.title,
    };
    Telemetry.track("music_audio_open_requested", {
      playback_id,
      id_music: params.id_music,
      mode: audioMode,
    });
    $dev.write("open audio", params);

    _audio.stop();
    this.clearVariables();
    _audio.setElementKind(params.mediaType === "video" ? "video" : "audio");
    _setPlaybackContext(playbackContext);
    // Sinal para módulos como Som de Fundo (auto-pausa).
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);

    const mode = params.mode || "audio";

    // Modo URL direta (ex: arquivo de áudio da liturgia) — pula busca no banco
    if (params.url) {
      const isVideo = params.mediaType === "video";
      console.info("[Media] arquivo direto solicitado:", {
        kind: isVideo ? "video" : "audio",
        source_type: _sourceType(params.url),
        extension: params.url.split("?")[0].split(".").pop()?.toLowerCase() || "",
        title: params.title || "",
      });
      _loadingId = null;
      $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, params.title || "");
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAST_SLIDE, 1);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, !isVideo);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, isVideo);

      const audioUrl = params.url;
      _setPlaybackContext({
        playback_id,
        id_music: null,
        mode: audioMode,
        source_type: _sourceType(audioUrl),
        title: params.title,
      });
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_SRC, params.videoUrl || "");
      if (isVideo) {
        _publishVideoProjectionIdentity(playback_id, params.videoUrl || audioUrl);
      }

      const volume = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME);
      _audio.setVolume(volume as number);
      _audio.getElement().currentTime = 0;

      _loadAudioSrc(audioUrl, null, () => {});
      this.minimize();
      return;
    }

    const id_music = params.id_music;
    _loadingId = id_music ?? null;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);

    let data: Music | null;
    try {
      data = await $database.get<Music>(`music_${id_music}`);
    } catch (error) {
      Telemetry.captureException(
        error,
        _telemetryFor(playbackContext, { operation: "music_audio_metadata_load" })
      );
      Telemetry.track(
        "music_audio_open_failed",
        _telemetryFor(playbackContext, { id_music, reason: "metadata_exception" })
      );
      if (_loadingId === id_music && _activePlayback?.playback_id === playback_id) this.close(true);
      return;
    }
    const isCurrentPlayback = _activePlayback?.playback_id === playback_id;
    if (data == null || _loadingId !== id_music || !isCurrentPlayback) {
      Telemetry.track(
        "music_audio_open_failed",
        _telemetryFor(playbackContext, {
          id_music,
          reason: data == null ? "not_found" : "superseded",
        })
      );
      if (data == null && _loadingId === id_music && isCurrentPlayback) this.close(true);
      return;
    }

    $appdata.set(KEYS.MODULES.MEDIA.DATA, data);
    $appdata.set(KEYS.MODULES.MEDIA.ID_MUSIC, id_music);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, data.name);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAST_SLIDE, 1);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, true);

    const volume = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME);
    _audio.setVolume(volume as number);
    _audio.getElement().currentTime = 0;

    const rawAudioPath = mode == "instrumental" ? data.url_instrumental_music : data.url_music;
    if (!rawAudioPath) {
      Telemetry.track(
        "music_playback_failed",
        _telemetryFor(playbackContext, { stage: "source_resolution", reason: "audio_path_missing" })
      );
      this.close(true);
      return;
    }
    let audioUrl: string;
    try {
      audioUrl = $path.file(rawAudioPath as string);
    } catch (error) {
      Telemetry.captureException(
        error,
        _telemetryFor(playbackContext, { operation: "music_audio_source_resolution" })
      );
      Telemetry.track(
        "music_playback_failed",
        _telemetryFor(playbackContext, { stage: "source_resolution", reason: "invalid_audio_path" })
      );
      this.close(true);
      return;
    }
    _setPlaybackContext({
      playback_id,
      id_music,
      mode,
      source_type: _sourceType(audioUrl),
      title: data.name,
    });
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);

    _loadAudioSrc(audioUrl, id_music, (id) => _self.openAudio(id));

    this.minimize();
  },

  /**
   * Abre um vídeo do YouTube. No desktop ele toca pelo app, sem anúncios, como um vídeo local
   * — projeção, retorno e operador incluídos —: do arquivo, se já está no disco, ou já, das
   * trilhas que o main vai baixando (sem esperar o fim do download, e entrando nele se já
   * estava em curso). O player embutido fica como reserva.
   *
   * @returns true quando há algo tocando; false quando o operador cancelou ou o
   *          vídeo não pode ser reproduzido (privado, removido, restrito).
   */
  async openYouTube(url: string, title: string): Promise<boolean> {
    const id = OnlineVideo.videoIdFromUrl(url);
    // Dois cliques no mesmo vídeo enquanto ele abre partilham a tentativa em
    // curso; um segundo vídeo de fato revoga a primeira tentativa.
    const stageEpoch = _opening.value?.id === id ? _stageEpoch : ++_stageEpoch;
    const opening = { id, title };
    _opening.value = opening;
    try {
      // Um vídeo que o operador já baixou toca do arquivo mesmo com o download desligado: é de
      // graça e sem anúncio.
      const downloaded = !!id && (await OnlineVideo.isDownloaded(id));
      if (stageEpoch !== _stageEpoch) return false;
      if (id && downloaded) {
        const outcome = await _prepareDownloadedYouTube(id, title);
        if (outcome !== "embed") return outcome === "playing";
      } else if (id && OnlineVideo.downloadEnabled()) {
        // Sem esperar o download: toca das trilhas que o main baixa uma vez só, e o download termina
        // ao fundo. Se não der para tocar assim, começa pelo player do YouTube (que pode ter
        // anúncio) e o download segue mesmo assim, para as próximas vezes.
        const outcome = await _prepareStreamedYouTube(id, title);
        if (outcome !== "embed") return outcome === "playing";
        void useOnlineVideoDownloads().download(id, title, { keep: false, quiet: true, background: true });
      }
      if (stageEpoch !== _stageEpoch) return false;
      await this.openEmbeddedYouTube(url, title, stageEpoch);
      return stageEpoch === _stageEpoch;
    } finally {
      if (_opening.value === opening) _opening.value = null;
    }
  },

  /** O vídeo do YouTube que está sendo aberto, ou null. Reativo: a tela mostra "Abrindo…" enquanto for não nulo. */
  opening(): { id: string | null; title: string } | null {
    return _opening.value;
  },

  /** O operador desistiu antes de o vídeo tocar: some o aviso e o pedido pendente é cancelado. */
  cancelOpening(): void {
    _opening.value = null;
    this.close(true);
  },

  async openEmbeddedYouTube(url: string, title: string, expectedStageEpoch?: number): Promise<void> {
    const stageEpoch = expectedStageEpoch ?? ++_stageEpoch;
    if (stageEpoch !== _stageEpoch) return;
    if (expectedStageEpoch === undefined) _dropPendingDownload();
    $dev.write("open youtube", { url, title });
    const playback_id = _newPlaybackId();
    const youtubeContext: AudioTelemetryContext = {
      playback_id,
      mode: "youtube",
      source_type: "youtube",
      title,
    };
    Telemetry.track("music_youtube_requested", { playback_id, title });

    // Trocar de um vídeo embutido para outro fica na MESMA janela (mesma feature "file"):
    // `_initYoutube` já destrói o player antigo antes de criar o novo. Fechar e reabrir aqui
    // corriam — o Electron ainda estava destruindo a janela antiga quando o pedido de abrir a
    // mesma feature chegava, reaproveitava a quase-morta em vez de recriar, e travava preta.
    if (_isYouTube()) {
      _dropPendingDownload();
      if (_ytUnlisten) {
        _ytUnlisten();
        _ytUnlisten = null;
      }
    }

    _audio.stop();
    this.clearVariables();
    _setPlaybackContext(youtubeContext);

    $appdata.set(KEYS.MODULES.MEDIA.SHOW, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, title);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_YOUTUBE, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.YOUTUBE_URL, url);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, "audio");
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);

    _audio.currentTime.value = 0;
    _audio.duration.value = 0;
    _audio.isPaused.value = false;
    _audio.progress.value = 0;
    _youtubePlaybackSample = { currentTime: 0, duration: 0, isPaused: false };

    this.minimize();

    try {
      localStorage.setItem(
        KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION,
        JSON.stringify({ url, type: "youtube", title, playback_id })
      );
      // Sem isto, uma janela recriada depois (retorno, operador, ou a própria
      // projeção reaberta) lia o vídeo por arquivo anterior em vez deste —
      // `_readPendingProjection` sempre prioriza LJ_FILE_PROJECTION.
      localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
    } catch {
      /* ignore */
    }

    try {
      if (!(await _claimVideoWindows(stageEpoch))) return;
      Telemetry.track("music_youtube_projection_opened", _telemetryFor(youtubeContext));
    } catch (error) {
      Telemetry.captureException(
        error,
        _telemetryFor(youtubeContext, { operation: "youtube_projection_open" })
      );
      Telemetry.track(
        "music_playback_failed",
        _telemetryFor(youtubeContext, { stage: "youtube_projection", reason: "window_open_failed" })
      );
      return;
    }

    $broadcast.send(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, {
      url,
      type: "youtube",
      title,
      playback_id,
    });

    _ytUnlisten = $broadcast.listen((msg) => {
      if (msg.type !== BROADCAST_TYPE.YOUTUBE_STATE) return;
      const p = msg.payload as Record<string, unknown>;
      if (!p) return;
      if (p.playback_id !== playback_id) return;
      if (typeof p.sampledAt !== "number" || !Number.isSafeInteger(p.sampledAt) ||
          p.sampledAt < _ytLastSampledAt) return;
      _ytLastSampledAt = p.sampledAt;
      if (typeof p.currentTime === "number" && Number.isFinite(p.currentTime) && p.currentTime >= 0 &&
          typeof p.duration === "number" && Number.isFinite(p.duration) && p.duration >= 0 &&
          typeof p.isPaused === "boolean") {
        _youtubePlaybackSample = {
          currentTime: p.currentTime, duration: p.duration, isPaused: p.isPaused,
        };
      }
      _ytStateReceived = true;
      if (typeof p.state === "number") {
        if (p.state !== _ytLastState) {
          if (p.state === 1)
            Telemetry.track(
              "music_youtube_play_started",
              _telemetryFor(youtubeContext, { state: p.state })
            );
          if (p.state === 3)
            Telemetry.track(
              "music_youtube_buffering_started",
              _telemetryFor(youtubeContext, { state: p.state })
            );
          if (p.state === 0)
            Telemetry.track(
              "music_playback_ended",
              _telemetryFor(youtubeContext, { ended_reason: "youtube_ended" })
            );
          _ytLastState = p.state;
        }
        if (
          p.state === 0 &&
          p.playback_id === playback_id &&
          _isYouTube() &&
          _activePlayback?.playback_id === playback_id
        ) {
          // A janela apenas reporta o fim; a Shell é a dona do lifecycle e
          // publica MEDIA_CLOSE uma única vez para todas as projeções.
          _self.close(true);
          return;
        }
      }
      _audio.currentTime.value =
        typeof p.currentTime === "number" ? p.currentTime : _audio.currentTime.value;
      _audio.duration.value = typeof p.duration === "number" ? p.duration : _audio.duration.value;
      _audio.isPaused.value = typeof p.isPaused === "boolean" ? p.isPaused : _audio.isPaused.value;
      _audio.progress.value =
        _audio.duration.value > 0 ? (_audio.currentTime.value / _audio.duration.value) * 100 : 0;

      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, _audio.currentTime.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, _audio.duration.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, _audio.isPaused.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, _audio.progress.value);
    });
    _ytWatchdog = setTimeout(() => {
      if (_isYouTube() && !_ytStateReceived) {
        Telemetry.track(
          "music_playback_failed",
          _telemetryFor(youtubeContext, {
            stage: "youtube_projection",
            reason: "no_player_state",
            timeout_ms: 15000,
          })
        );
      }
      _ytWatchdog = null;
    }, 15000);
  },

  clearVariables(): void {
    _switchingMode = false;
    if (_ytWatchdog) clearTimeout(_ytWatchdog);
    _ytWatchdog = null;
    _ytLastState = null;
    _ytStateReceived = false;
    _youtubePlaybackSample = null;
    _ytLastSampledAt = 0;
    _loadingId = null;
    if (_audioXhr) {
      const currentRequest = _audioXhr;
      _audioXhr = null;
      try {
        currentRequest.abort();
      } catch {
        /* troca/fechamento já em andamento */
      }
    }
    _slides.reset();
    _audio.reset();
    _setPlaybackContext(null);
    $appdata.set(KEYS.MODULES.MEDIA.DATA, {});
    $appdata.set(KEYS.MODULES.MEDIA.ID_MUSIC, null);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SUBTITLE, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TRACK, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IMAGE, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_SRC, "");
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, 0);
    // O espelho de `_slides.slideIndex` só grava quando o índice muda: uma
    // música que parte do slide 0 nunca o dispara, e o contador da janela de
    // Mídia mostrava NaN/N com o slide ativo sem marcação.
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VOLUME, 100);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_FADING, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_YOUTUBE, false);
  },

  minimize(): void {
    $appdata.set(KEYS.MODULES.MEDIA.SHOW, false);
    $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, true);
  },

  maximize(): void {
    $appdata.set(KEYS.MODULES.MEDIA.SHOW, true);
    $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, false);
  },

  isMinimized(): boolean {
    return $appdata.get(KEYS.MODULES.MEDIA.MINIMIZED, false) as boolean;
  },

  isLoading(): boolean {
    return $appdata.get(KEYS.MODULES.MEDIA.LOADING, false) as boolean;
  },

  config(): unknown {
    return $appdata.get(KEYS.MODULES.MEDIA.CONFIG.ROOT);
  },

  slides(): Slide[] {
    return _slides.slides.value;
  },

  slide(): Slide | null {
    return _slides.slide.value;
  },

  broadcastSlide(): void {
    _slides.broadcastSlide();
  },

  goToSlide(index: number): void {
    _slides.goToSlide(index);
  },

  goToTime(time: number): void {
    if (_isYouTube()) {
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "seekTo", value: time, playback_id: _activePlayback?.playback_id });
    } else {
      _audio.seekTo(time);
      _broadcastVideoState(time);
    }
  },

  advanceTime(time = 10): void {
    if (_isYouTube()) {
      const newTime = Math.max(0, _audio.currentTime.value + time);
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "seekTo", value: newTime, playback_id: _activePlayback?.playback_id });
    } else if (
      _audio.duration.value > 0 &&
      Number.isFinite(_audio.duration.value) &&
      $appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO) != ""
    ) {
      _audio.advanceTime(time);
      _broadcastVideoState();
    }
  },

  play(): void {
    this.pause(false);
  },

  pause(bool = true, callback?: () => void): void {
    if (_isYouTube()) {
      if (bool) {
        $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "pause", playback_id: _activePlayback?.playback_id });
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
        _audio.isPaused.value = true;
      } else {
        $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "play", playback_id: _activePlayback?.playback_id });
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
        _audio.isPaused.value = false;
      }
      if (callback) callback();
      return;
    }

    const fade_audio = $userdata.get(KEYS.MODULES.MEDIA.FADE_AUDIO, false);
    const isVideo = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE);

    if (bool) {
      if (fade_audio && !isVideo) {
        _audio.fadeOut(() => {
          _audio.pause(callback);
          $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
          $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_FADING, false);
        });
      } else {
        _audio.pause(callback);
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      }
      _broadcastVideoState();
    } else {
      const self = this;
      _audio.play(
        (e) => {
          $alert.error(
            { text: "modules.media.alerts.not_loaded", error: e || "" },
            function (a?: unknown) {
              const id = $appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC) as string | number | null;
              // Arquivos diretos da liturgia não têm id_music. Não tente
              // reabrir o banco com null após um erro de codec do vídeo.
              if (a && id != null) self.open(id);
            }
          );
        },
        () => {
          $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
          _broadcastVideoState();
        }
      );
      if (fade_audio && !isVideo) {
        _audio.fadeIn($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME) as number, () => {
          $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_FADING, false);
          if (callback) callback();
        });
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_FADING, true);
      } else {
        _audio.setVolume($appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME) as number);
        if (callback) callback();
      }
    }
  },

  firstSlide(): void {
    _slides.goFirst();
  },
  prevSlide(): void {
    _slides.goPrev();
  },
  nextSlide(): void {
    _slides.goNext();
  },
  lastSlide(): void {
    _slides.goLast();
  },

  setVolume(val: number): void {
    _audio.setVolume(val);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VOLUME, val);
    if (_isYouTube()) {
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "setVolume", value: val, playback_id: _activePlayback?.playback_id });
    }
  },

  toogleVolume(): void {
    const volume = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME) as number;
    this.setVolume(volume < 100 ? 100 : 0);
  },

  fullscreen(value = true): void {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.FULLSCREEN, value);
  },

  setAlbumInfo(id_album: string | number | null, module = "media"): void {
    _album.setAlbumInfo(id_album, module);
  },

  registerPlaylistEndHandler(handler: () => boolean): void {
    _playlistOnEnd = handler;
  },

  unregisterPlaylistEndHandler(): void {
    _playlistOnEnd = null;
  },
};

export default _self;
