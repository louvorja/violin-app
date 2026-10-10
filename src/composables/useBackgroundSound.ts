import { effectScope, ref, watch } from "vue";
import { MediaFile } from "@/types/Media";
import { detachMediaSource } from "@/helpers/Dom";
import { PROGRESS_UI_INTERVAL_MS } from "@/constants/Playback";
import { createRateGate } from "@/helpers/RateGate";
import $appdata from "@/helpers/AppData";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { getSetting } from "@/helpers/SettingsStorage";
import { SETTINGS_TABLE } from "@/constants/DbTables";
import { BackgroundSoundSettings } from "@/types/Settings";

const _audio = new Audio();
const isPlaying = ref(false);
const currentFile = ref<MediaFile | null>(null);
const currentTime = ref(0);
const duration = ref(0);
const progress = ref(0);
const volume = ref(50);
const repeat = ref(false);
const fadeInMs = ref(3000);
const fadeOutMs = ref(3000);
/**
 * Pausa automática quando outra mídia entra.
 *
 * Vive AQUI (e não no Index do módulo) porque é estado do player, não da tela:
 * a aba do módulo vai para a faixa KeepAlive de consultas (`moduleCacheMax: 4`)
 * e some do DOM depois de outras quatro — junto com os gatilhos que estavam
 * nela. Ver `armarAutoPause`.
 */
const autoPause = ref(true);
/** Promessa do `carregarConfig` — lê uma vez, aplica uma vez. */
let _configPromessa: Promise<void> | null = null;
/** Os gatilhos são do processo, não de quem chamou: arma uma vez só. */
let _autoPauseArmado = false;

let _rafId: number | null = null;
let _fadeTimer: ReturnType<typeof setInterval> | null = null;
let _playFileFn: ((file: MediaFile, fadeInMs?: number) => void) | null = null;

function _stopRaf(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

function _clearFade(): void {
  if (_fadeTimer !== null) {
    clearInterval(_fadeTimer);
    _fadeTimer = null;
  }
}

const _uiSyncGate = createRateGate(PROGRESS_UI_INTERVAL_MS);

function _startRaf(): void {
  _stopRaf();
  const tick = (): void => {
    if (_audio.paused) {
      _rafId = null;
      return;
    }
    const ct = isNaN(_audio.currentTime) ? 0 : _audio.currentTime;
    const d = isNaN(_audio.duration) || !isFinite(_audio.duration) ? 0 : _audio.duration;
    const jumped = Math.abs(ct - currentTime.value) > 1 || d !== duration.value;
    if (_uiSyncGate(jumped)) {
      currentTime.value = ct;
      duration.value = d;
      progress.value = d > 0 ? (ct / d) * 100 : 0;
    }
    _rafId = requestAnimationFrame(tick);
  };
  _rafId = requestAnimationFrame(tick);
}

function _revokeBlob(): void {
  if (_audio.src && _audio.src.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(_audio.src);
    } catch {
      /* ignora */
    }
  }
}

function _setupEnded(): void {
  _audio.onended = () => {
    _stopRaf();
    isPlaying.value = false;
    if (repeat.value && currentFile.value && _playFileFn) {
      _playFileFn(currentFile.value);
    }
  };
}

/**
 * Lê `background_sound` do IndexedDB e aplica no player.
 *
 * Necessário porque `autoPause` e o fader viraram estado do composable: sem
 * isto, depois de reiniciar o app — e sem ninguém abrir a aba do módulo — os
 * valores voltariam para os defaults, ignorando o que o operador escolheu.
 *
 * Chamado pelo `Footer` (sempre montado), não automático no composable: assim
 * quem só usa o composable em teste não puxa IndexedDB.
 *
 * @returns a mesma promessa para quem quiser esperar (cacheada)
 */
export function carregarConfig(): Promise<void> {
  if (_configPromessa) return _configPromessa;
  _configPromessa = (async () => {
    try {
      const s = await getSetting<BackgroundSoundSettings & { id: string }>(
        SETTINGS_TABLE.BACKGROUND_SOUND
      );
      if (!s) return;
      if (typeof s.autoPause === "boolean") autoPause.value = s.autoPause;
      if (typeof s.fadeIn === "number") fadeInMs.value = s.fadeIn;
      if (typeof s.fadeOut === "number") fadeOutMs.value = s.fadeOut;
      if (typeof s.repeat === "boolean") repeat.value = s.repeat;
    } catch {
      /* Sem config ainda: os defaults valem. */
    }
  })();
  return _configPromessa;
}

export function useBackgroundSound() {
  function setVolume(val: number): void {
    if (!isFinite(val)) return;
    volume.value = val;
    _audio.volume = val / 100;
  }

  function fadeIn(targetVolume: number, durationMs: number, callback?: () => void): void {
    _clearFade();
    _audio.volume = 0;
    const target = isFinite(targetVolume) ? targetVolume / 100 : 0;
    const steps = Math.max(1, Math.round(durationMs / 30));
    const increment = target / steps;
    let step = 0;
    _fadeTimer = setInterval(() => {
      step++;
      if (step >= steps) {
        _audio.volume = target;
        _clearFade();
        if (callback) callback();
      } else {
        _audio.volume = Math.min(_audio.volume + increment, target);
      }
    }, 30);
  }

  function fadeOut(durationMs: number, callback?: () => void): void {
    _clearFade();
    const startVolume = isFinite(_audio.volume) ? _audio.volume : 0;
    const steps = Math.max(1, Math.round(durationMs / 30));
    const decrement = startVolume / steps;
    let step = 0;
    _fadeTimer = setInterval(() => {
      step++;
      if (step >= steps) {
        _audio.volume = 0;
        _clearFade();
        if (callback) callback();
      } else {
        _audio.volume = Math.max(_audio.volume - decrement, 0);
      }
    }, 30);
  }

  function playFile(file: MediaFile, fadeInMs = 3000): void {
    _playFileFn = playFile;
    _revokeBlob();
    _stopRaf();
    _clearFade();

    currentFile.value = file;
    _audio.loop = repeat.value;
    _audio.src = file.path;
    _audio.load();
    isPlaying.value = true;

    const playPromise = _audio.play();
    if (playPromise) {
      playPromise
        .then(() => {
          _startRaf();
          fadeIn(volume.value, fadeInMs);
          _setupEnded();
        })
        .catch(() => {
          isPlaying.value = false;
        });
    }
  }

  function stop(fadeOutMs = 0): void {
    if (fadeOutMs > 0 && !_audio.paused) {
      isPlaying.value = false;
      fadeOut(fadeOutMs, () => {
        _stopRaf();
        _clearFade();
        _audio.pause();
        _revokeBlob();
        detachMediaSource(_audio);
        _audio.currentTime = 0;
        currentFile.value = null;
        currentTime.value = 0;
        duration.value = 0;
        progress.value = 0;
        _audio.onended = null;
      });
    } else {
      _stopRaf();
      _clearFade();
      _audio.pause();
      _audio.currentTime = 0;
      _revokeBlob();
      detachMediaSource(_audio);
      currentFile.value = null;
      currentTime.value = 0;
      duration.value = 0;
      progress.value = 0;
      isPlaying.value = false;
      _audio.onended = null;
    }
  }

  function pause(): void {
    if (!_audio.paused) {
      _audio.pause();
      _stopRaf();
      isPlaying.value = false;
    }
  }

  function resume(): void {
    if (_audio.paused && _audio.src) {
      // Intenção síncrona (mesmo padrão de playFile/togglePlay): o remote lê o
      // estado logo depois do POST — se `isPlaying` só virasse true na
      // promise, o GET seguinte ainda leria "pausado" com o áudio tocando.
      isPlaying.value = true;
      const playPromise = _audio.play();
      if (playPromise) {
        playPromise
          .then(() => {
            _startRaf();
          })
          .catch(() => {
            isPlaying.value = false;
          });
      }
    }
  }

  function togglePlay(fadeInMs = 3000, fadeOutMs = 3000): void {
    if (isPlaying.value) {
      isPlaying.value = false;
      fadeOut(fadeOutMs, () => {
        _audio.pause();
      });
    } else if (currentFile.value) {
      isPlaying.value = true;
      const promise = _audio.play();
      if (promise) promise.then(() => _startRaf()).catch(() => {});
      fadeIn(volume.value, fadeInMs);
    }
  }

  function seek(pct: number): void {
    if (duration.value > 0) {
      _audio.currentTime = (pct / 100) * duration.value;
    }
  }

  /**
   * Liga, UMA vez, os gatilhos do "pausar automaticamente".
   *
   * Fica dentro do composable (e não no Index do módulo) por dois motivos
   * medidos:
   *
   * 1. `useBroadcastListener` PAUSA o listener no `onDeactivated`, e o módulo
   *    vai para a faixa KeepAlive de consultas (`moduleCacheMax: 4`) — ao
   *    trocar de aba, os eventos de FILE_PROJECTION, ONLINE_VIDEO_PROJECTION e
   *    SLIDES_DATA paravam de chegar, e a mídia aberta pela Biblioteca ou pela
   *    liturgia deixava de pausar. É a metade dos relatos.
   * 2. os `watch` de `modules.media.show/is_playing` sobreviviam à troca de
   *    aba, mas não à desmontagem — e aí também morriam.
   *
   * `effectScope(true)` é o que impede o Vue de amarrar esses efeitos ao escopo
   * do componente que estiver na chamada: um scope destacado não é parado
   * quando esse componente desmonta. O `pause`/`fadeOut` daqui são os da
   * primeira chamada, mas só tocam estado de módulo — não há estado da tela.
   */
  function armarAutoPause(): void {
    if (_autoPauseArmado) return;
    _autoPauseArmado = true;

    /* Respeita o fader configurado: é `fadeOutMs` (compartilho), não o local. */
    const pausar = (): void => {
      if (autoPause.value && isPlaying.value) fadeOut(fadeOutMs.value, pause);
    };

    effectScope(true).run(() => {
      watch(
        () => $appdata.get("modules.media.show"),
        (show) => {
          if (show) pausar();
        }
      );
      watch(
        () => $appdata.get("modules.media.is_playing"),
        (playing) => {
          if (playing) pausar();
        }
      );
    });

    /*
     * Broadcast fora do `useBroadcastListener` de propósito: o helper pausa o
     * listener na troca de aba, e é exatamente para o caso de o operador ESTAR
     * noutra aba que o vídeo precisa pausar o som. `replay: false` — nada de
     * pausar no boot por causa de uma projeção antiga.
     *
     * `SLIDES_DATA` é o sinal de MÚSICA: o caminho de música
     * (`useMedia._launchProjection`) nunca escreve `modules.media.is_playing`
     * nem `modules.media.show` — o áudio passa por `_loadAudioSrc`, não por
     * `openAudio` —, então os dois `watch` de cima nunca viam uma música
     * começar. É ele que publica o deck no palco, incondicionalmente (inclusive
     * em modo áudio, sem slides).
     */
    $broadcast.listen(
      (msg) => {
        if (
          msg.type === BROADCAST_TYPE.FILE_PROJECTION ||
          msg.type === BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION ||
          msg.type === BROADCAST_TYPE.SLIDES_DATA ||
          /* Projeção de Site (liturgia ou Canva): abre janela externa, sem
             escrever nada em `modules.media.*`. */
          msg.type === BROADCAST_TYPE.SITE_PROJECTION
        ) {
          pausar();
        }
      },
      { replay: false }
    );
  }

  function cleanup(): void {
    _stopRaf();
    _clearFade();
    _audio.pause();
    _revokeBlob();
    detachMediaSource(_audio);
    _audio.onended = null;
  }

  armarAutoPause();

  return {
    isPlaying,
    currentFile,
    autoPause,
    carregarConfig,
    currentTime,
    duration,
    progress,
    volume,
    repeat,
    fadeInMs,
    fadeOutMs,
    setVolume,
    playFile,
    stop,
    pause,
    resume,
    togglePlay,
    fadeIn,
    fadeOut,
    seek,
    cleanup,
  };
}
