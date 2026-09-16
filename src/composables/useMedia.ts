import { watch } from "vue";
import $dev from "@/helpers/Dev";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
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
import { openProjectionWindows, openVideoProjectionWindows, closeProjectionWindows } from "@/helpers/ProjectionWindows";
import { Music } from "@/types/Music";
import type { Lyric } from "@/types/Lyric";
import { LyricOpenParams } from "@/types/Lyric";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { MediaOpenParams } from "@/types/Media";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import AudioLibrary from "@/helpers/AudioLibrary";
import Telemetry from "@/helpers/Telemetry";

const _audio = useAudioPlayback();
const _slides = useSlides();
const _lyric  = useLyric();
const _album  = useAlbum();
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

function _newPlaybackId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* ambientes antigos sem randomUUID */ }
  return `playback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function _audioTelemetry(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(_activePlayback || {}), ...extra };
}

function _telemetryFor(context: AudioTelemetryContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
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
  _audio.setTelemetryContext(context);
}

// YouTube mode
let _ytUnlisten: (() => void) | null = null;
let _ytWatchdog: ReturnType<typeof setTimeout> | null = null;
let _ytLastState: number | null = null;
let _ytStateReceived = false;

function _broadcastVideoState(currentTime?: number, isPaused?: boolean): void {
  if (!$appdata.get(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE)) return;
  $broadcast.send(BROADCAST_TYPE.VIDEO_STATE, {
    currentTime: currentTime ?? _audio.currentTime.value,
    isPaused: isPaused ?? _audio.isPaused.value,
  });
}

function _isYouTube(): boolean {
  return !!$appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_YOUTUBE);
}

function _loadAudioSrc(
  audioUrl: string,
  idCheck: string | number | null,
  retryFn: (id: string | number) => void,
  onSource: (src: string, lazy: boolean) => void = (src, lazy) => {
    _audio.setSrc(src, lazy);
    _self.pause(false);
  },
  deferAudioContext = false,
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
    Telemetry.track("music_retry_requested", requestTelemetry({ id_music: idCheck, source_type: _sourceType(audioUrl) }));
    if (idCheck != null) retryFn(idCheck);
  };
  if (_activePlayback) {
    _activePlayback = { ..._activePlayback, source_type: _sourceType(audioUrl) };
    if (!deferAudioContext) _audio.setTelemetryContext(_activePlayback);
  }
  Telemetry.track("music_audio_load_started", requestTelemetry({ id_music: idCheck, remote: ehRemota(audioUrl), source_type: _sourceType(audioUrl) }));
  if ($appdata.get(KEYS.SHELL.IS_ONLINE) && $userdata.get(KEYS.MODULES.MEDIA.LAZY_LOAD)) {
    if (_activePlayback) {
      _activePlayback = { ..._activePlayback, lazy: true };
      if (!deferAudioContext) _audio.setTelemetryContext(_activePlayback);
      requestContext = { ...requestContext, ..._activePlayback };
    }
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, true);
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.track("music_audio_streaming_started", requestTelemetry({ id_music: idCheck, source_type: _sourceType(audioUrl) }));
    onSource(audioUrl, true);
    return;
  }

  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, false);
  if (_audioXhr) {
    const previousRequest = _audioXhr;
    _audioXhr = null;
    try { previousRequest.abort(); } catch (_) { /* ignore */ }
  }
  const request = new XMLHttpRequest();
  _audioXhr = request;
  try {
    request.open("GET", audioUrl, true);
  } catch (error) {
    if (_audioXhr === request) _audioXhr = null;
    _switchingMode = false;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.captureException(error, requestTelemetry({ operation: "music_audio_request_open", id_music: idCheck }));
    _self.close(true);
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
    if (this.status >= 200 && this.status < 300 && this.response instanceof Blob && this.response.size > 0) {
      Telemetry.track("music_audio_loaded", requestTelemetry({ id_music: idCheck, status: this.status, bytes: this.response.size, content_type: this.response.type, elapsed_ms: elapsed }));
      Telemetry.track("music_audio_transfer_completed", requestTelemetry({ id_music: idCheck, status: this.status, bytes: this.response.size, content_type: this.response.type, elapsed_ms: elapsed }));
      if (ehRemota(audioUrl)) reportNetworkResult(true, "media");
      onSource(URL.createObjectURL(this.response as Blob), false);
    } else {
      _switchingMode = false;
      _self.close(true);
      Telemetry.track("music_audio_load_failed", requestTelemetry({
        id_music: idCheck,
        reason: this.status >= 200 && this.status < 300 ? "empty_or_invalid_body" : "http_status",
        status: this.status,
        status_text: request.statusText,
        bytes: this.response?.size,
        content_type: this.response?.type,
        elapsed_ms: elapsed,
      }));
      Telemetry.track("music_playback_failed", requestTelemetry({ stage: "transfer", reason: this.status >= 200 && this.status < 300 ? "empty_or_invalid_body" : "http_status", status: this.status, elapsed_ms: elapsed }));
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
    _self.close(true);
    const reason = event?.type === "timeout" ? "timeout" : "network_error";
    Telemetry.track("music_audio_load_failed", requestTelemetry({ id_music: idCheck, reason, remote: ehRemota(audioUrl), elapsed_ms: Date.now() - startedAt }));
    Telemetry.track("music_playback_failed", requestTelemetry({ stage: "transfer", reason, remote: ehRemota(audioUrl), elapsed_ms: Date.now() - startedAt }));
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
    Telemetry.track("music_audio_load_failed", requestTelemetry({ id_music: idCheck, reason: "aborted", elapsed_ms: Date.now() - startedAt }));
    Telemetry.track("music_playback_failed", requestTelemetry({ stage: "transfer", reason: "aborted" }));
  };

  // LOADING só cai nos handlers: o blob ainda está sendo baixado aqui, e
  // liberar a UI antes disso deixa o usuário apertar Play num <audio> sem
  // fonte — que rejeita com "no supported source was found".
  try {
    request.send();
  } catch (error) {
    if (_audioXhr === request) _audioXhr = null;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
    Telemetry.captureException(error, requestTelemetry({ operation: "music_audio_request_send", id_music: idCheck }));
    Telemetry.track("music_playback_failed", requestTelemetry({ stage: "transfer", reason: "request_send" }));
    _self.close(true);
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

// Callback de timeUpdate: mantém $appdata de timing e fecha ao fim da música.
_audio.onTimeUpdate((ct, d) => {
  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, ct);
  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, d);
  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, _audio.progress.value);
  $appdata.set(KEYS.MODULES.MEDIA.CONFIG.BUFFERED, _audio.buffered.value);

  if (!_audio.isPaused.value && ct >= d && d > 0 && !_switchingMode) {
    if (_playlistOnEnd) {
      const handled = _playlistOnEnd();
      if (!handled) {
        _self.close(true);
      }
    } else {
      _self.close(true);
    }
  }

  // Sincronia contínua de vídeo: broadcast periódico para manter o <video>
  // das janelas de projeção sincronizado com o <audio> oculto.
  const now = Date.now();
  if (!$appdata.get(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED) && now - _lastVideoSync >= _VIDEO_SYNC_INTERVAL) {
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
      lyric:                data?.name,
      cover:                true,
      time:                 "00:00:00",
      instrumental_time:    "00:00:00",
      url_image:            data?.url_image as string | undefined,
      image_position:       data?.image_position,
      id_music:             data?.id_music,
    },
    ...lyricEntries
      .filter((lyric) => lyric.show_slide === 1)
      .sort((a, b) => a.order - b.order)
      .map((lyric) => {
        if (lyric.url_image) {
          prev_image          = lyric.url_image as string;
          prev_image_position = lyric.image_position;
        }
        return {
          ...lyric,
          cover:          false,
          lyric:          lyric.lyric ? lyric.lyric.replace(/[\r\n]+/g, "<br>") : "",
          url_image:      prev_image,
          image_position: prev_image_position,
          id_music:       data?.id_music,
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

  async open(params: MediaOpenParams | string | number): Promise<void> {
    if (typeof params != "object") {
      params = { id_music: params };
    }

    $dev.write("open media", params);
    const playback_id = _newPlaybackId();
    const requestedMode = params.mode || "no_audio";
    const playbackContext: AudioTelemetryContext = { playback_id, id_music: params.id_music, mode: requestedMode };
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

      const url =
        $userdata.get(KEYS.REMOTE.URL) +
        "/api/open-song?id=" +
        params.id_music +
        "&tag=" +
        tag +
        "&token=" +
        $userdata.get(KEYS.REMOTE.TOKEN);

      $alert.info("modules.media.alerts.open_remote");
      const remoteStartedAt = Date.now();
      Telemetry.track("music_remote_open_started", _telemetryFor(playbackContext, { stage: "remote_request" }));
      try {
        const response = await fetchWithTimeout(url, {
          method: "GET",
          mode: "cors",
          timeout: NET_TIMEOUT.DEFAULT,
          source: "open-song",
        });
        const ret = await response.json();
        Telemetry.track("music_remote_open_completed", _telemetryFor(playbackContext, { status: response.status, ok: response.ok, elapsed_ms: Date.now() - remoteStartedAt, response_code: ret?.code }));
        if (ret.status != "ok") {
          Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "remote_request", reason: ret.code || "remote_rejected", status: response.status, response_code: ret.code }));
          $alert.error({
            text:
              ret.code == "INVALID_TOKEN"
                ? "modules.remote_control.messages.invalid_token"
                : "modules.remote_control.messages.error",
            error: ret.code,
          });
        }
      } catch (error) {
        Telemetry.captureException(error, _telemetryFor(playbackContext, { operation: "music_remote_open", elapsed_ms: Date.now() - remoteStartedAt }));
        Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "remote_request", reason: "remote_open_failed", elapsed_ms: Date.now() - remoteStartedAt }));
        $alert.error({ text: "modules.remote_control.messages.error", error });
      }
      return;
    }

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
    // `clearVariables` encerra o contexto anterior; a requisição de metadata
    // pertence à tentativa que acabou de ser criada acima.
    _setPlaybackContext(playbackContext);

    const id_music = params.id_music;
    const minimizeOnStart = $userdata.get(KEYS.OPTIONS.MINIMIZE_ON_START, false);
    const minimized = params.minimized !== undefined ? params.minimized : minimizeOnStart;
    const id_album  = params.id_album  ? params.id_album  : null;
    let mode: string = params.mode ? params.mode : "no_audio";

    _loadingId = id_music ?? null;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);

    let data: Music | null;
    try {
      data = await $database.get<Music>(`music_${id_music}`);
    } catch (error) {
      Telemetry.captureException(error, _telemetryFor(playbackContext, { operation: "music_metadata_load" }));
      Telemetry.track("music_open_failed", _telemetryFor(playbackContext, { id_music, reason: "metadata_exception" }));
      if (_loadingId === id_music && _activePlayback?.playback_id === playback_id) this.close(true);
      return;
    }
    const isCurrentPlayback = _activePlayback?.playback_id === playback_id;
    if (data == null || _loadingId !== id_music || !isCurrentPlayback) {
      Telemetry.track("music_open_failed", _telemetryFor(playbackContext, { id_music, reason: data == null ? "not_found" : "superseded" }));
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
    Telemetry.track("music_metadata_resolved", _telemetryFor(playbackContext, {
      name: data.name,
      duration: data.duration,
      has_audio: !!data.url_music,
      has_instrumental_audio: !!data.url_instrumental_music,
      slides_count: _lyricEntries(data).length,
    }));
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
        Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "source_resolution", reason: "audio_path_missing" }));
        $appdata.set(KEYS.MODULES.MEDIA.LOADING, false);
        this.close(true);
        return;
      }
      try {
        audioUrl = $path.file(rawAudioPath as string);
      } catch (error) {
        Telemetry.captureException(error, _telemetryFor(playbackContext, { operation: "music_source_resolution" }));
        Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "source_resolution", reason: "invalid_audio_path" }));
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
    Telemetry.track("music_mode_switch_requested", { playback_id: previousPlaybackId, id_music: idMusic, mode, previous_mode: $appdata.get(KEYS.MODULES.MEDIA.CONFIG.MODE) });

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
      mode === MusicActionEnum.AUDIO        ? (data?.url_music as string | undefined) :
      mode === MusicActionEnum.INSTRUMENTAL ? (data?.url_instrumental_music as string | undefined) :
      undefined;
    if (mode !== MusicActionEnum.NO_AUDIO && !file) {
      Telemetry.track("music_mode_switch_failed", _audioTelemetry({ id_music: idMusic, mode, previous_mode: current, reason: "audio_path_missing" }));
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
      Telemetry.track("music_mode_switch_started", _telemetryFor(noAudioContext, { id_music: idMusic, mode, previous_mode: current }));
      _audio.currentTime.value = 0;
      _audio.duration.value    = 0;
      _audio.progress.value    = 0;
      _audio.buffered.value    = 0;
      _slides.setTimes([]);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "");
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.BUFFERED, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      _slides.broadcastSlide();
      Telemetry.track("music_mode_switch_completed", _telemetryFor(noAudioContext, { id_music: idMusic, mode, previous_mode: current }));
      return;
    }

    let audioUrl: string;
    try {
      audioUrl = $path.file(file as string);
    } catch (error) {
      Telemetry.captureException(error, _audioTelemetry({ operation: "music_mode_source_resolution" }));
      Telemetry.track("music_mode_switch_failed", _audioTelemetry({ id_music: idMusic, mode, previous_mode: current, reason: "invalid_audio_path" }));
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
    Telemetry.track("music_mode_switch_started", _telemetryFor(switchContext, { id_music: idMusic, mode, previous_mode: current }));
    _loadingId = idMusic;
    _switchingMode = true;
    $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);

    // A faixa que está no ar continua tocando enquanto a nova baixa: quem troca
    // no meio do louvor não pode ficar com a igreja em silêncio pelo tempo do
    // download. Por isso o ponto de retomada só é lido aqui, quando a faixa
    // nova assume — lê-lo no clique faria o áudio voltar o que tocou desde lá.
    _loadAudioSrc(audioUrl, idMusic, (id) => _self.open(id), (src, lazy) => {
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
          const fraction   = hadAudio ? _slides.slideProgress.value / 100 : 0;
          const playing    = !hadAudio || !_audio.isPaused.value;

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
              Telemetry.track("music_mode_switch_completed", _telemetryFor(switchContext, { id_music: idMusic, mode, previous_mode: current }));
            });
        })
        .catch((error) => {
          // A faixa não quis carregar em paralelo; o caminho normal reabre a
          // música e traz junto o tratamento de erro de sempre.
          _switchingMode = false;
          Telemetry.captureException(error, _telemetryFor(switchContext, { operation: "music_mode_switch_prepare" }));
          Telemetry.track("music_mode_switch_failed", _telemetryFor(switchContext, { id_music: idMusic, mode, previous_mode: current, reason: error?.name || "prepare_failed" }));
          _self.open({ id_music: idMusic, mode, minimized: _self.isMinimized() });
        });
    }, true);
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
    $dev.write("open custom song", song?.nome);
    const playback_id = _newPlaybackId();
    const playbackContext: AudioTelemetryContext = { playback_id, mode: "audio", title: song?.nome };
    Telemetry.track("custom_music_opened", {
      playback_id,
      name: song?.nome,
      slides_count: Array.isArray(song?.slides) ? song.slides.length : 0,
      has_audio: !!song?.audio_token,
    });

    _audio.stop();
    this.clearVariables();
    _setPlaybackContext(playbackContext);

    const slidesArray: Slide[] = [];
    const timesArray: number[] = [];
    for (const s of song.slides || []) {
      let urlImage: string | undefined;
      if (s.imagem) {
        urlImage = (await AudioLibrary.resolveImage(s.imagem)) || undefined;
        if (_activePlayback?.playback_id !== playback_id) {
          Telemetry.track("custom_music_open_failed", _telemetryFor(playbackContext, { reason: "superseded" }));
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
      Telemetry.track("custom_music_open_failed", _telemetryFor(playbackContext, { reason: "superseded" }));
      return;
    }

    if (song.audio_token && !audioUrl) {
      Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "source_resolution", reason: "custom_audio_not_found" }));
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

    $broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
      slides: opts.slides,
      title: opts.title,
      slide_index: 0,
      playback_id: opts.playbackId,
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
      // Sem áudio: broadcast imediato do slide de capa para a projeção.
      _slides.broadcastSlide();
    }

    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, opts.mode);

    // Replica fmMusica + fmMusicaRetorno + fmMusicaOperador do Delphi:
    // ao iniciar uma música, abre as janelas auxiliares conforme
    // configurado em "Configurações → Slides de Músicas".
    openProjectionWindows().catch((e) => {
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
    _audio.stop();
    this.clearVariables();
    _slides.reset();
    $appdata.set(KEYS.MODULES.MEDIA.MINIMIZED, false);
  },

  close(force = false): void {
    if (_isYouTube()) {
      if (!force) {
        const key = "modules.media.alerts.close";
        const self = this;
        $alert.yesno({title: key}, function (btn?: string) {
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
      closeProjectionWindows().catch((e) => {
        console.warn("[Media] closeProjectionWindows falhou:", e);
      });
      return;
    }

    if (!force) {
      const self = this;
      const key = $appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY)
        ? "modules.media.alerts.close_audio"
        : "modules.media.alerts.close";
      $alert.yesno({title: key}, function (btn?: string) {
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

    // Avisa janelas locais (Projection, ProjectionReturn) e clients
    // remotos (SSE) para limparem a tela. Sem este broadcast, OBS continua
    // mostrando a letra mesmo depois de fechar a música.
    $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);

    // Fecha janelas auxiliares (espelha o fmMusica.Close do Delphi).
    closeProjectionWindows().catch((e) => {
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
    Telemetry.track("music_lyrics_opened", { id_music: params.id_music, id_album: params.id_album });

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

  async openAudio(params: MediaOpenParams | string | number): Promise<void> {
    if (typeof params != "object") {
      params = { id_music: params };
    }
    const playback_id = _newPlaybackId();
    const audioMode = params.mode || "audio";
    const playbackContext: AudioTelemetryContext = { playback_id, id_music: params.id_music, mode: audioMode, title: params.title };
    Telemetry.track("music_audio_open_requested", { playback_id, id_music: params.id_music, mode: audioMode });
    $dev.write("open audio", params);

    _audio.stop();
    this.clearVariables();
    _setPlaybackContext(playbackContext);
    // Sinal para módulos como Som de Fundo (auto-pausa).
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);

    const mode = params.mode || "audio";

    // Modo URL direta (ex: arquivo de áudio da liturgia) — pula busca no banco
    if (params.url) {
      _loadingId = null;
      $appdata.set(KEYS.MODULES.MEDIA.LOADING, true);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.TITLE, params.title || "");
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.MODE, mode);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 0);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAST_SLIDE, 1);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, true);

      const audioUrl = params.url;
      _setPlaybackContext({ playback_id, id_music: null, mode: audioMode, source_type: _sourceType(audioUrl), title: params.title });
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);

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
      Telemetry.captureException(error, _telemetryFor(playbackContext, { operation: "music_audio_metadata_load" }));
      Telemetry.track("music_audio_open_failed", _telemetryFor(playbackContext, { id_music, reason: "metadata_exception" }));
      if (_loadingId === id_music && _activePlayback?.playback_id === playback_id) this.close(true);
      return;
    }
    const isCurrentPlayback = _activePlayback?.playback_id === playback_id;
    if (data == null || _loadingId !== id_music || !isCurrentPlayback) {
      Telemetry.track("music_audio_open_failed", _telemetryFor(playbackContext, { id_music, reason: data == null ? "not_found" : "superseded" }));
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
      Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "source_resolution", reason: "audio_path_missing" }));
      this.close(true);
      return;
    }
    let audioUrl: string;
    try {
      audioUrl = $path.file(rawAudioPath as string);
    } catch (error) {
      Telemetry.captureException(error, _telemetryFor(playbackContext, { operation: "music_audio_source_resolution" }));
      Telemetry.track("music_playback_failed", _telemetryFor(playbackContext, { stage: "source_resolution", reason: "invalid_audio_path" }));
      this.close(true);
      return;
    }
    _setPlaybackContext({ playback_id, id_music, mode, source_type: _sourceType(audioUrl), title: data.name });
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, audioUrl);

    _loadAudioSrc(audioUrl, id_music, (id) => _self.openAudio(id));

    this.minimize();
  },

  async openYouTube(url: string, title: string): Promise<void> {
    $dev.write("open youtube", { url, title });
    const playback_id = _newPlaybackId();
    const youtubeContext: AudioTelemetryContext = { playback_id, mode: "youtube", source_type: "youtube", title };
    Telemetry.track("music_youtube_requested", { playback_id, title });

    if (_isYouTube()) this.close(true);

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

    this.minimize();

    try {
      localStorage.setItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION, JSON.stringify({ url, type: "youtube", title, playback_id }));
    } catch {
      /* ignore */
    }

    try {
      await openVideoProjectionWindows();
      Telemetry.track("music_youtube_projection_opened", _telemetryFor(youtubeContext));
    } catch (error) {
      Telemetry.captureException(error, _telemetryFor(youtubeContext, { operation: "youtube_projection_open" }));
      Telemetry.track("music_playback_failed", _telemetryFor(youtubeContext, { stage: "youtube_projection", reason: "window_open_failed" }));
      return;
    }

    $broadcast.send(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, { url, type: "youtube", title, playback_id });

    _ytUnlisten = $broadcast.listen((msg) => {
      if (msg.type !== BROADCAST_TYPE.YOUTUBE_STATE) return;
      const p = msg.payload as Record<string, unknown>;
      if (!p) return;
      if (typeof p.playback_id === "string" && p.playback_id !== playback_id) return;
      _ytStateReceived = true;
      if (typeof p.state === "number") {
        if (p.state !== _ytLastState) {
          if (p.state === 1) Telemetry.track("music_youtube_play_started", _telemetryFor(youtubeContext, { state: p.state }));
          if (p.state === 3) Telemetry.track("music_youtube_buffering_started", _telemetryFor(youtubeContext, { state: p.state }));
          if (p.state === 0) Telemetry.track("music_playback_ended", _telemetryFor(youtubeContext, { ended_reason: "youtube_ended" }));
          _ytLastState = p.state;
        }
      }
      _audio.currentTime.value = typeof p.currentTime === "number" ? p.currentTime : _audio.currentTime.value;
      _audio.duration.value = typeof p.duration === "number" ? p.duration : _audio.duration.value;
      _audio.isPaused.value = typeof p.isPaused === "boolean" ? p.isPaused : _audio.isPaused.value;
      _audio.progress.value = _audio.duration.value > 0 ? (_audio.currentTime.value / _audio.duration.value) * 100 : 0;

      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, _audio.currentTime.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, _audio.duration.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, _audio.isPaused.value);
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, _audio.progress.value);
    });
    _ytWatchdog = setTimeout(() => {
      if (_isYouTube() && !_ytStateReceived) {
        Telemetry.track("music_playback_failed", _telemetryFor(youtubeContext, { stage: "youtube_projection", reason: "no_player_state", timeout_ms: 15000 }));
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
    _loadingId = null;
    if (_audioXhr) {
      const currentRequest = _audioXhr;
      _audioXhr = null;
      try { currentRequest.abort(); } catch { /* troca/fechamento já em andamento */ }
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
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.LAZY, false);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 0);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.PROGRESS, 0);
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
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "seekTo", value: time });
    } else {
      _audio.seekTo(time);
      _broadcastVideoState(time);
    }
  },

  advanceTime(time = 10): void {
    if (_isYouTube()) {
      const newTime = Math.max(0, _audio.currentTime.value + time);
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "seekTo", value: newTime });
    } else if (_audio.duration.value > 0 && Number.isFinite(_audio.duration.value) && $appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO) != "") {
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
        $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "pause" });
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, true);
        _audio.isPaused.value = true;
      } else {
        $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "play" });
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
      _audio.play((e) => {
        $alert.error({ text: "modules.media.alerts.not_loaded", error: e || "" }, function (a?: unknown) {
          if (a) self.open($appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC) as string | number);
        });
      }, () => {
        $appdata.set(KEYS.MODULES.MEDIA.CONFIG.IS_PAUSED, false);
        _broadcastVideoState();
      });
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

  firstSlide(): void { _slides.goFirst(); },
  prevSlide():  void { _slides.goPrev();  },
  nextSlide():  void { _slides.goNext();  },
  lastSlide():  void { _slides.goLast();  },

  setVolume(val: number): void {
    _audio.setVolume(val);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VOLUME, val);
    if (_isYouTube()) {
      $broadcast.send(BROADCAST_TYPE.YOUTUBE_CONTROL, { action: "setVolume", value: val });
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
