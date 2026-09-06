import { ref, getCurrentScope, onScopeDispose, type Ref } from "vue";
import { detachMediaSource as _detachSource } from "@/helpers/Dom";

type TimeCallback = (currentTime: number, duration: number) => void;

export interface AudioPlayback {
  volume: Ref<number>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  progress: Ref<number>;
  buffered: Ref<number>;
  isPaused: Ref<boolean>;
  isFading: Ref<boolean>;
  getElement: () => HTMLAudioElement;
  setSrc: (src: string, lazy?: boolean) => void;
  prepare: (src: string, lazy?: boolean, seekHint?: number) => Promise<HTMLAudioElement>;
  release: (el: HTMLAudioElement) => void;
  takeOver: (next: HTMLAudioElement, startTime: (duration: number) => number, play: boolean) => Promise<void>;
  setDurationHint: (seconds: number) => void;
  play: (onError?: (e: unknown) => void) => void;
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

  let _el: HTMLAudioElement | null = null;
  let _rafId: number | null = null;
  let _playing = false;
  const _timeCallbacks: TimeCallback[] = [];

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
  }

  function _startRaf(): void {
    if (_rafId) return;
    const tick = () => {
      if (!_playing) {
        _rafId = null;
        return;
      }
      _syncTime();
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
  }

  function _listen(el: HTMLAudioElement): void {
    el.addEventListener("timeupdate", _syncTime);
    el.addEventListener("progress", _syncTime);
    el.addEventListener("loadedmetadata", _syncTime);
  }

  function _unlisten(el: HTMLAudioElement): void {
    el.removeEventListener("timeupdate", _syncTime);
    el.removeEventListener("progress", _syncTime);
    el.removeEventListener("loadedmetadata", _syncTime);
  }

  function getElement(): HTMLAudioElement {
    if (!_el) {
      _el = document.getElementById("__audio") as HTMLAudioElement | null;
      if (!_el) {
        _el = document.createElement("audio");
        _el.id = "__audio";
        _el.preload = "auto";
        document.body.appendChild(_el);
      }
      _listen(_el);
    }
    _el.autoplay = true;
    return _el;
  }

  /**
   * Carrega uma faixa num elemento à parte, sem tocar em quem está no ar.
   * Resolve quando ela já dá para tocar — é o que permite trocar de faixa sem
   * o buraco de silêncio da decodificação.
   */
  function prepare(src: string, lazy = false, seekHint = 0): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
      const el = document.createElement("audio");
      el.preload = "auto";
      el.autoplay = false;
      el.volume = volume.value / 100;
      el.dataset.lazy = lazy ? "1" : "";
      el.src = src;

      // Faixa que vem por streaming bufferiza a partir do zero; sem levá-la já
      // para perto do ponto de entrada, o salto na hora da troca vira espera
      // de rede — justo o silêncio que se quer evitar.
      const posicionar = (): void => {
        const d = el.duration;
        if (seekHint > 0 && Number.isFinite(d) && d > 0) {
          el.currentTime = Math.max(0, Math.min(seekHint, d));
        }
      };

      let encerrado = false;
      const encerrar = (): void => {
        encerrado = true;
        clearTimeout(prazo);
        el.removeEventListener("loadedmetadata", posicionar);
        el.removeEventListener("canplay", pronto);
        el.removeEventListener("error", falhou);
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
        reject(new Error("prepare: falha ao carregar " + src));
      };
      // Rede ruim não pode deixar a troca pendurada — quem chamou decide o que
      // fazer com um elemento que ainda vai engasgar.
      const prazo = setTimeout(pronto, 10000);

      el.addEventListener("loadedmetadata", posicionar);
      el.addEventListener("canplay", pronto);
      el.addEventListener("error", falhou);
      el.load();
    });
  }

  function _descartar(el: HTMLAudioElement): void {
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
    next: HTMLAudioElement,
    startTime: (duration: number) => number,
    play: boolean,
  ): Promise<void> {
    const d = isNaN(next.duration) || !isFinite(next.duration) ? 0 : next.duration;
    const alvo = startTime(d);
    if (Number.isFinite(alvo) && alvo > 0) {
      next.currentTime = d > 0 ? Math.max(0, Math.min(alvo, d)) : alvo;
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
      if (_playing) _startRaf();
    };
    const p = next.play();
    if (!p) {
      tocando();
      return Promise.resolve();
    }
    return p.then(tocando, tocando);
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

  function play(onError?: (e: unknown) => void): void {
    const el = getElement();
    // Sem fonte anexada o play() rejeita com NotSupportedError e vira um
    // alerta de "erro ao carregar áudio" — mas aqui o áudio só ainda não
    // chegou: o onload do XHR chama play() de novo assim que o blob existir.
    if (!el.getAttribute("src")) return;
    const playPromise = el.play();
    if (playPromise) {
      playPromise
        .then(() => {
          if (el.paused) return;
          _playing = true;
          isPaused.value = false;
          _startRaf();
        })
        .catch((e) => {
          // Interromper um play() pendente — com pause(), com load() ao trocar
          // de faixa, ou soltando a fonte — rejeita a promise com AbortError.
          // É o desfecho esperado dessas ações, não uma falha de carregamento:
          // reportar viraria um alerta de erro a cada troca rápida de música.
          if ((e as { name?: string } | null)?.name === "AbortError") return;
          if (onError) onError(e);
        });
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
    el.currentTime = Math.max(0, Math.min(time, d));
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
    volume.value      = 100;
    currentTime.value = 0;
    duration.value    = 0;
    progress.value    = 0;
    buffered.value    = 0;
    isPaused.value    = true;
    isFading.value    = false;
    isLazy.value      = false;
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
    getElement, setSrc, prepare, release: _descartar, takeOver, setDurationHint,
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
