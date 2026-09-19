import { ref, getCurrentScope, onScopeDispose, type Ref } from "vue";
import { detachMediaSource as _detachSource } from "@/helpers/Dom";
import Telemetry from "@/helpers/Telemetry";

type TimeCallback = (currentTime: number, duration: number) => void;
export type MediaElementKind = "audio" | "video";

export interface AudioTelemetryContext {
  playback_id: string;
  parent_playback_id?: string;
  id_music?: string | number | null;
  mode?: string;
  source_type?: string;
  lazy?: boolean;
  title?: string;
}

export interface AudioPlayback {
  volume: Ref<number>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  progress: Ref<number>;
  buffered: Ref<number>;
  isPaused: Ref<boolean>;
  isFading: Ref<boolean>;
  getElement: () => HTMLMediaElement;
  /** Troca o elemento de mídia usado pelo player sem perder o estado reativo. */
  setElementKind: (kind: MediaElementKind) => HTMLMediaElement;
  setTelemetryContext: (context: AudioTelemetryContext | null) => void;
  setSrc: (src: string, lazy?: boolean) => void;
  prepare: (src: string, lazy?: boolean, seekHint?: number, telemetryContext?: AudioTelemetryContext) => Promise<HTMLAudioElement>;
  release: (el: HTMLMediaElement) => void;
  takeOver: (next: HTMLMediaElement, startTime: (duration: number) => number, play: boolean) => Promise<void>;
  setDurationHint: (seconds: number) => void;
  play: (onError?: (e: unknown) => void, onStarted?: () => void) => void;
  pause: (callback?: () => void) => void;
  stop: (callback?: () => void) => void;
  setVolume: (val: number) => void;
  toggleVolume: () => void;
  seekTo: (time: number) => void;
  advanceTime: (delta: number) => void;
  fadeIn: (maxVolume: number, callback?: () => void) => void;
  fadeOut: (callback?: () => void) => void;
  onTimeUpdate: (cb: TimeCallback) => () => void;
  reset: () => void;
  cleanup: () => void;
}

let _shared: AudioPlayback | null = null;

function _create(): AudioPlayback {
  const volume      = ref(100);
  const currentTime = ref(0);
  const duration    = ref(0);
  const progress    = ref(0);
  const buffered    = ref(0);
  const isPaused    = ref(true);
  const isFading    = ref(false);
  const isLazy      = ref(false);

  let _el: HTMLMediaElement | null = null;
  let _elementKind: MediaElementKind = "audio";
  let _rafId: number | null = null;
  let _playing = false;
  const _timeCallbacks: TimeCallback[] = [];
  let _telemetryContext: AudioTelemetryContext | null = null;
  const _elementTelemetryContext = new WeakMap<HTMLMediaElement, AudioTelemetryContext>();
  const _listening = new WeakSet<HTMLMediaElement>();
  let _bufferingSince = 0;
  let _lastProgressAt = 0;
  let _lastProgressTime = 0;
  let _watchdog: ReturnType<typeof setInterval> | null = null;
  let _listenedSeconds = 0;
  let _lastListenedTime = 0;
  let _lastListeningReportAt = 0;
  let _listeningStartedReported = false;
  const LISTENING_REPORT_INTERVAL_MS = 30_000;

  // Só a extensão: o suficiente para separar formato sem suporte de arquivo bloqueado.
  function _srcExtension(el: HTMLMediaElement): string | undefined {
    try {
      const name = new URL(el.currentSrc || el.src).pathname.split("/").pop() || "";
      const ext = name.includes(".") ? (name.split(".").pop() as string).toLowerCase() : "";
      return /^[a-z0-9]{1,5}$/.test(ext) ? ext : undefined;
    } catch {
      return undefined;
    }
  }

  function _telemetryProps(el: HTMLMediaElement, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const error = el.error;
    return {
      ...(_elementTelemetryContext.get(el) || _telemetryContext || {}),
      current_time: Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : 0,
      duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : 0,
      ready_state: el.readyState,
      network_state: el.networkState,
      media_error_code: error?.code,
      media_error_message: error?.message,
      buffered_seconds: (() => {
        try {
          if (!el.buffered.length) return 0;
          return Number(Math.max(0, el.buffered.end(el.buffered.length - 1) - el.currentTime).toFixed(3));
        } catch { return 0; }
      })(),
      ...extra,
    };
  }

  function _reportListening(el: HTMLMediaElement, reason: string, force = false): void {
    if (!_telemetryContext) return;
    const current = Number.isFinite(el.currentTime) ? el.currentTime : _lastListenedTime;
    const delta = current - _lastListenedTime;
    // Saltos grandes normalmente são seek/troca de faixa, não tempo ouvido.
    if (delta > 0 && delta <= 5) _listenedSeconds += delta;
    _lastListenedTime = current;
    const now = Date.now();
    if (!force && now - _lastListeningReportAt < LISTENING_REPORT_INTERVAL_MS) return;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const completionRatio = duration > 0 ? Math.min(1, current / duration) : undefined;
    Telemetry.track("music_listening_progress", _telemetryProps(el, {
      listened_seconds: Number(_listenedSeconds.toFixed(2)),
      completion_ratio: completionRatio,
      listening_reason: reason,
    }));
    Telemetry.histogram("louvorja.music.listened.seconds", _listenedSeconds, {
      mode: _telemetryContext.mode || "unknown",
    });
    if (reason === "ended" || (completionRatio !== undefined && completionRatio >= 0.9)) {
      Telemetry.track("music_listening_completed", _telemetryProps(el, {
        listened_seconds: Number(_listenedSeconds.toFixed(2)),
        completion_ratio: completionRatio,
      }));
    }
    _lastListeningReportAt = now;
  }

  function _trackMediaEvent(el: HTMLMediaElement, eventName: string): void {
    if (!_elementTelemetryContext.has(el) && !_telemetryContext) return;
    const now = Date.now();
    if (eventName === "waiting" || eventName === "stalled") {
      if (!_bufferingSince) {
        _bufferingSince = now;
        Telemetry.track("music_buffering_started", _telemetryProps(el, { trigger: eventName }));
      }
      Telemetry.log("warn", "music media buffering", _telemetryProps(el, { trigger: eventName }));
      return;
    }
    if (eventName === "playing") {
      if (_bufferingSince) {
        Telemetry.track("music_buffering_recovered", _telemetryProps(el, {
          buffering_ms: now - _bufferingSince,
        }));
        _bufferingSince = 0;
      }
      Telemetry.track("music_play_started", _telemetryProps(el));
      if (!_listeningStartedReported) {
        _listeningStartedReported = true;
        _lastListenedTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;
        _lastListeningReportAt = now;
        Telemetry.track("music_listening_started", _telemetryProps(el, { listening_mode: "audio" }));
      }
      return;
    }
    if (eventName === "loadedmetadata" || eventName === "canplay" || eventName === "canplaythrough") {
      Telemetry.track("music_media_ready", _telemetryProps(el, { readiness: eventName }));
      return;
    }
    if (eventName === "error") {
      const reason = el.error?.code === 1 ? "aborted" : el.error?.code === 2 ? "network" :
        el.error?.code === 3 ? "decode" : el.error?.code === 4 ? "source_not_supported" : "unknown";
      const failure = { stage: "media_element", reason, file_ext: _srcExtension(el) };
      Telemetry.track("music_playback_failed", _telemetryProps(el, failure));
      Telemetry.log("error", "music media error", _telemetryProps(el, failure));
      return;
    }
    if (eventName === "ended") {
      _reportListening(el, "ended", true);
      Telemetry.track("music_playback_ended", _telemetryProps(el, { ended_reason: "media_ended" }));
      return;
    }
    if (eventName === "pause") {
      _reportListening(el, "paused", true);
      Telemetry.track("music_playback_paused", _telemetryProps(el, { stage: "media_element" }));
      return;
    }
    if (eventName === "abort") {
      _reportListening(el, "aborted", true);
      Telemetry.track("music_playback_aborted", _telemetryProps(el, { stage: "media_element" }));
    }
  }

  function _onMediaEvent(event: Event): void {
    const el = event.currentTarget as HTMLMediaElement | null;
    if (!el) return;
    _trackMediaEvent(el, event.type);
  }

  function _startWatchdog(): void {
    if (_watchdog) return;
    _lastProgressAt = Date.now();
    _lastProgressTime = currentTime.value;
    _watchdog = setInterval(() => {
      const el = _el;
      if (!el || !_playing || el.paused) return;
      const now = Date.now();
      const current = Number.isFinite(el.currentTime) ? el.currentTime : 0;
      if (current !== _lastProgressTime) {
        _lastProgressTime = current;
        _lastProgressAt = now;
        return;
      }
      if (now - _lastProgressAt >= 5000 && _telemetryContext) {
        Telemetry.track("music_playback_stalled", _telemetryProps(el, {
          stage: "clock",
          reason: "time_not_advancing",
          stalled_ms: now - _lastProgressAt,
        }));
        _lastProgressAt = now;
      }
    }, 2000);
  }

  function _stopWatchdog(): void {
    if (_watchdog) clearInterval(_watchdog);
    _watchdog = null;
    _bufferingSince = 0;
  }

  function _syncTime(): void {
    if (!_el) return;
    const ct = isNaN(_el.currentTime) || !isFinite(_el.currentTime) ? 0 : _el.currentTime;
    const rawD = _el.duration;
    const d =
      isNaN(rawD) || !isFinite(rawD) || rawD < 0 ? duration.value : rawD;
    currentTime.value = ct;
    duration.value    = d;
    progress.value    = d <= 0 ? 0 : (ct / d) * 100;
    if (!isLazy.value) {
      buffered.value = 100;
    } else {
      const b = _el.buffered;
      buffered.value = b.length > 0 ? (b.end(0) / _el.duration) * 100 : 0;
    }
    for (const cb of _timeCallbacks) cb(ct, d);
    if (ct !== _lastProgressTime) {
      _lastProgressTime = ct;
      _lastProgressAt = Date.now();
    }
  }

  function _startRaf(): void {
    if (_rafId) return;
    const tick = () => {
      if (!_playing) {
        _rafId = null;
        return;
      }
      _syncTime();
      if (_el && _playing) _reportListening(_el, "heartbeat");
      _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
  }

  function _stopRaf(): void {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _playing = false;
    _stopWatchdog();
  }

  /**
   * Onde a faixa pode ser posicionada sem encostar no fim. Encostar dispara
   * `ended`, e o fim de faixa encerra a música — nenhuma navegação de slide
   * deve conseguir isso, ainda mais porque a duração conhecida pode ser só o
   * pedaço já baixado.
   */
  const _MARGEM_DO_FIM = 0.25;

  function _posicaoSegura(time: number, duracao: number): number {
    if (!Number.isFinite(duracao) || duracao <= 0) return Math.max(0, time);
    return Math.max(0, Math.min(time, Math.max(0, duracao - _MARGEM_DO_FIM)));
  }

  function _listen(el: HTMLMediaElement): void {
    if (_listening.has(el)) return;
    el.addEventListener("timeupdate", _syncTime);
    el.addEventListener("progress", _syncTime);
    el.addEventListener("loadedmetadata", _syncTime);
    for (const eventName of ["loadstart", "loadedmetadata", "canplay", "canplaythrough", "playing", "waiting", "stalled", "suspend", "durationchange", "pause", "ended", "error", "abort"]) {
      el.addEventListener(eventName, _onMediaEvent);
    }
    _listening.add(el);
  }

  function _unlisten(el: HTMLMediaElement): void {
    if (!_listening.has(el)) return;
    el.removeEventListener("timeupdate", _syncTime);
    el.removeEventListener("progress", _syncTime);
    el.removeEventListener("loadedmetadata", _syncTime);
    for (const eventName of ["loadstart", "loadedmetadata", "canplay", "canplaythrough", "playing", "waiting", "stalled", "suspend", "durationchange", "pause", "ended", "error", "abort"]) {
      el.removeEventListener(eventName, _onMediaEvent);
    }
    _listening.delete(el);
  }

  function getElement(): HTMLMediaElement {
    if (!_el) {
      _el = document.getElementById("__audio") as HTMLAudioElement | null;
      if (_el && _el.tagName.toLowerCase() !== _elementKind) {
        _el.remove();
        _el = null;
      }
      if (!_el) {
        _el = document.createElement(_elementKind);
        _el.id = "__audio";
        _el.preload = "auto";
        _el.setAttribute("aria-hidden", "true");
        _el.style.display = "none";
        document.body.appendChild(_el);
      }
    }
    // O elemento é a fonte de áudio/relógio do player; nunca deve aparecer
    // como um retângulo preto na janela principal quando o tipo for vídeo.
    _el.setAttribute("aria-hidden", "true");
    _el.style.display = "none";
    _listen(_el);
    _el.autoplay = true;
    return _el;
  }

  function setElementKind(kind: MediaElementKind): HTMLMediaElement {
    if (kind !== "audio" && kind !== "video") kind = "audio";
    if (_elementKind === kind && _el) return getElement();
    if (_el) {
      _stopRaf();
      _unlisten(_el);
      _el.pause();
      _detachSource(_el);
      _el.remove();
      _el = null;
    }
    _elementKind = kind;
    return getElement();
  }

  /**
   * Carrega uma faixa num elemento à parte, sem tocar em quem está no ar.
   * Resolve quando ela já dá para tocar — é o que permite trocar de faixa sem
   * o buraco de silêncio da decodificação.
   */
  function prepare(src: string, lazy = false, seekHint = 0, telemetryContext?: AudioTelemetryContext): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
      const el = document.createElement("audio");
      const context = telemetryContext || _telemetryContext;
      if (context) _elementTelemetryContext.set(el, context);
      el.preload = "auto";
      el.autoplay = false;
      el.volume = volume.value / 100;
      el.dataset.lazy = lazy ? "1" : "";
      el.src = src;
      for (const eventName of ["loadstart", "loadedmetadata", "canplay", "canplaythrough", "playing", "waiting", "stalled", "suspend", "durationchange", "pause", "ended", "error", "abort"]) {
        el.addEventListener(eventName, _onMediaEvent);
      }

      // Faixa que vem por streaming bufferiza a partir do zero; sem levá-la já
      // para perto do ponto de entrada, o salto na hora da troca vira espera
      // de rede — justo o silêncio que se quer evitar.
      const posicionar = (): void => {
        const d = el.duration;
        if (seekHint > 0 && Number.isFinite(d) && d > 0) {
          el.currentTime = _posicaoSegura(seekHint, d);
        }
      };

      let encerrado = false;
      const encerrar = (): void => {
        encerrado = true;
        clearTimeout(prazo);
        el.removeEventListener("loadedmetadata", posicionar);
        el.removeEventListener("canplay", pronto);
        el.removeEventListener("error", falhou);
        for (const eventName of ["loadstart", "loadedmetadata", "canplay", "canplaythrough", "playing", "waiting", "stalled", "suspend", "durationchange", "pause", "ended", "error", "abort"]) {
          el.removeEventListener(eventName, _onMediaEvent);
        }
      };
      const pronto = (): void => {
        if (encerrado) return;
        encerrar();
        resolve(el);
      };
      const falhou = (): void => {
        if (encerrado) return;
        encerrar();
        _descartar(el);
        const error = el.error;
        const failure = new Error("prepare: falha ao carregar áudio");
        failure.name = error?.code === 3 ? "DecodeError" : error?.code === 4 ? "NotSupportedError" : "MediaLoadError";
        reject(failure);
      };
      // Rede ruim não pode deixar a troca pendurada — quem chamou decide o que
      // fazer com um elemento que ainda vai engasgar.
      const prazo = setTimeout(() => {
        if (encerrado) return;
        encerrar();
        _descartar(el);
        const failure = new Error("prepare: timeout aguardando canplay");
        failure.name = "TimeoutError";
        reject(failure);
      }, 10000);

      el.addEventListener("loadedmetadata", posicionar);
      el.addEventListener("canplay", pronto);
      el.addEventListener("error", falhou);
      el.load();
    });
  }

  function _descartar(el: HTMLMediaElement): void {
    el.pause();
    if (el.src && el.src.startsWith("blob:")) {
      try { URL.revokeObjectURL(el.src); } catch (_) { /* ignore */ }
    }
    _detachSource(el);
    el.remove();
  }

  /**
   * Promove ao ar a faixa preparada, posicionada em `startTime`. Quando ela
   * entra tocando, a anterior só sai depois que a nova começou de fato — sem
   * isso sobra um silêncio entre uma e outra.
   */
  function takeOver(
    next: HTMLMediaElement,
    startTime: (duration: number) => number,
    play: boolean,
  ): Promise<void> {
    const d = isNaN(next.duration) || !isFinite(next.duration) ? 0 : next.duration;
    const alvo = startTime(d);
    if (Number.isFinite(alvo) && alvo > 0) {
      next.currentTime = _posicaoSegura(alvo, d);
    }
    next.volume = volume.value / 100;

    const promover = (): void => {
      const anterior = _el;
      if (anterior && anterior !== next) {
        _unlisten(anterior);
        _descartar(anterior);
      }
      next.id = "__audio";
      next.autoplay = true;
      if (!next.isConnected) document.body.appendChild(next);
      _el = next;
      if (!_elementTelemetryContext.has(next) && _telemetryContext) {
        _elementTelemetryContext.set(next, _telemetryContext);
      }
      isLazy.value = next.dataset.lazy === "1";
      _listen(next);
      _syncTime();
    };

    if (!play) {
      _stopRaf();
      promover();
      next.pause();
      isPaused.value = true;
      return Promise.resolve();
    }

    const tocando = (): void => {
      promover();
      _playing = !next.paused;
      isPaused.value = next.paused;
      if (_playing) {
        _startRaf();
        _startWatchdog();
      }
    };
    const p = next.play();
    if (!p) {
      tocando();
      return Promise.resolve();
    }
    return p.then(tocando, (error) => {
      _descartar(next);
      throw error;
    });
  }

  function setSrc(src: string, lazy = false): void {
    const el = getElement();
    // Revoga blob URL anterior — sem isso, cada troca de música acumula
    // memória do Blob (URL.createObjectURL não é GC'd até revoke). Em sessões
    // longas com muitas trocas de faixa, vira leak considerável.
    if (el.src && el.src.startsWith("blob:")) {
      try { URL.revokeObjectURL(el.src); } catch (_) { /* ignore */ }
    }
    isLazy.value = lazy;
    el.src = src;
    el.load();
  }

  function setDurationHint(seconds: number): void {
    if (!duration.value) duration.value = seconds;
  }

  function play(onError?: (e: unknown) => void, onStarted?: () => void): void {
    const el = getElement();
    // Sem fonte anexada o play() rejeita com NotSupportedError e vira um
    // alerta de "erro ao carregar áudio" — mas aqui o áudio só ainda não
    // chegou: o onload do XHR chama play() de novo assim que o blob existir.
    if (!el.getAttribute("src")) {
      if (_telemetryContext || _elementTelemetryContext.has(el)) {
        Telemetry.track("music_play_deferred", _telemetryProps(el, { stage: "play_request", reason: "source_not_ready" }));
      }
      return;
    }
    const playPromise = el.play();
    if (playPromise) {
      playPromise
        .then(() => {
          if (el.paused) return;
          _playing = true;
          isPaused.value = false;
          _startRaf();
          _startWatchdog();
          onStarted?.();
        })
        .catch((e) => {
          // Interromper um play() pendente — com pause(), com load() ao trocar
          // de faixa, ou soltando a fonte — rejeita a promise com AbortError.
          // É o desfecho esperado dessas ações, não uma falha de carregamento:
          // reportar viraria um alerta de erro a cada troca rápida de música.
          if ((e as { name?: string } | null)?.name === "AbortError") return;
          Telemetry.track("music_playback_failed", _telemetryProps(el, {
            stage: "play_promise",
            reason: (e as { name?: string } | null)?.name || "unknown",
          }));
          Telemetry.log("error", "music play promise rejected", _telemetryProps(el, {
            stage: "play_promise",
            reason: (e as { name?: string } | null)?.name || "unknown",
          }));
          if (onError) onError(e);
        });
    } else if (!el.paused) {
      _playing = true;
      isPaused.value = false;
      _startRaf();
      _startWatchdog();
      onStarted?.();
    }
  }

  function pause(callback?: () => void): void {
    _stopRaf();
    isPaused.value = true;
    const el = getElement();
    el.pause();
    if (callback) callback();
  }

  function stop(callback?: () => void): void {
    _stopRaf();
    if (_el) {
      _el.onerror = null;
      _el.pause();
      _detachSource(_el);
    }
    isPaused.value = true;
    if (callback) callback();
  }

  function setVolume(val: number): void {
    volume.value = val;
    if (_el) _el.volume = val / 100;
  }

  function toggleVolume(): void {
    setVolume(volume.value < 100 ? 100 : 0);
  }

  function seekTo(time: number): void {
    const el = getElement();
    if (!Number.isFinite(time) || time < 0) return;
    const d = isNaN(el.duration) || !isFinite(el.duration)
      ? duration.value
      : el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    el.currentTime = _posicaoSegura(time, d);
  }

  function advanceTime(delta: number): void {
    seekTo(currentTime.value + delta);
  }

  // Fade rápido para UX: ~200ms total. Antes era ~1200ms (0.05 a cada 60ms),
  // perceptivelmente lento ao trocar/fechar/pausar música. Agora 0.1 a cada
  // 20ms = 10 ticks ≈ 200ms — suave o suficiente pra não cortar abruptamente
  // o áudio, rápido o suficiente pra não atrasar o usuário.
  const _FADE_STEP = 0.1;
  const _FADE_INTERVAL_MS = 20;

  function fadeIn(maxVolume: number, callback?: () => void): void {
    isFading.value = true;
    const target = maxVolume / 100;
    const el = getElement();
    const id = setInterval(() => {
      if (el.volume < target) {
        el.volume = Math.min(el.volume + _FADE_STEP, target);
      } else {
        isFading.value = false;
        clearInterval(id);
        if (callback) callback();
      }
    }, _FADE_INTERVAL_MS);
  }

  function fadeOut(callback?: () => void): void {
    const el = getElement();
    if (el.paused) {
      if (callback) callback();
      return;
    }
    isFading.value = true;
    const id = setInterval(() => {
      if (el.volume > 0) {
        el.volume = Math.max(el.volume - _FADE_STEP, 0);
      } else {
        isFading.value = false;
        clearInterval(id);
        if (callback) callback();
      }
    }, _FADE_INTERVAL_MS);
  }

  function onTimeUpdate(cb: TimeCallback): () => void {
    _timeCallbacks.push(cb);
    return () => {
      const i = _timeCallbacks.indexOf(cb);
      if (i >= 0) _timeCallbacks.splice(i, 1);
    };
  }

  function reset(): void {
    _stopRaf();
    volume.value      = 100;
    currentTime.value = 0;
    duration.value    = 0;
    progress.value    = 0;
    buffered.value    = 0;
    isPaused.value    = true;
    isFading.value    = false;
    isLazy.value      = false;
    _telemetryContext = null;
    _listenedSeconds = 0;
    _lastListenedTime = 0;
    _lastListeningReportAt = 0;
    _listeningStartedReported = false;
    if (_el) {
      // Não deixe eventos enfileirados da faixa anterior atravessarem o novo
      // contexto no mesmo elemento DOM. `getElement` reinstala de forma
      // idempotente os listeners quando a próxima faixa precisar dele.
      _unlisten(_el);
      _elementTelemetryContext.delete(_el);
    }
    _stopWatchdog();
  }

  function cleanup(): void {
    _stopRaf();
    if (_el) {
      _unlisten(_el);
      if (_el.parentNode) _el.parentNode.removeChild(_el);
      _el = null;
    }
  }

  return {
    volume, currentTime, duration, progress, buffered, isPaused, isFading,
    getElement, setElementKind, setTelemetryContext: (context) => {
      if (context?.playback_id !== _telemetryContext?.playback_id) {
        _listenedSeconds = 0;
        _lastListenedTime = 0;
        _lastListeningReportAt = 0;
        _listeningStartedReported = false;
      }
      _telemetryContext = context;
      if (_el) {
        if (context) _elementTelemetryContext.set(_el, context);
        else _elementTelemetryContext.delete(_el);
      }
    }, setSrc, prepare, release: _descartar, takeOver, setDurationHint,
    play, pause, stop,
    setVolume, toggleVolume, seekTo, advanceTime,
    fadeIn, fadeOut, onTimeUpdate,
    reset, cleanup,
  };
}

export function useAudioPlayback(): AudioPlayback {
  if (!_shared) _shared = _create();
  if (getCurrentScope()) {
    onScopeDispose(() => {
      // não destrói o singleton — só remove referências locais se necessário
    });
  }
  return _shared;
}
