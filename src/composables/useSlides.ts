import { ref, computed, watch, toRaw, type Ref, type ComputedRef } from "vue";
import $broadcast from "@/helpers/Broadcast";
import type { AudioPlayback } from "@/composables/useAudioPlayback";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry, { isProjectionMilestone } from "@/helpers/Telemetry";
import { MusicPresentationCore, musicSnapshotDifferences, type MusicOperation, type MusicSnapshot } from "@/presentation/MusicPresentationCore";
import { createMemoryPresentationTransport, type PresentationTransport } from "@/presentation/PresentationTransport";
import { readMusicShadowPacket } from "@/presentation/MusicShadowReceiver";
import { createMusicShadowSessionFactory } from "@/helpers/MusicShadowSession";

export interface Slide {
  lyric?: string;
  cover?: boolean;
  time?: string;
  instrumental_time?: string;
  url_image?: string;
  image_position?: string | number;
  id_music?: number;
  [key: string]: unknown;
}

interface SlidesInstance {
  slides: Ref<Slide[]>;
  slideIndex: Ref<number>;
  slideProgress: Ref<number>;
  title: Ref<string>;
  slide: ComputedRef<Slide | null>;
  nextSlide: ComputedRef<Slide | null>;
  totalSlides: ComputedRef<number>;
  setSlides: (newSlides: Slide[], newTimes: number[], newTitle: string, playbackId?: string) => void;
  setPlaybackId: (playbackId?: string) => void;
  setTimes: (newTimes: number[]) => void;
  timeForPosition: (index: number, fraction: number, duration: number) => number;
  bindAudio: (audioPlayback: AudioPlayback) => void;
  unbindAudio: () => void;
  broadcastSlide: () => void;
  goToSlide: (index: number, commandAt?: number) => void;
  goPrev: () => void;
  goNext: () => void;
  goFirst: () => void;
  goLast: () => void;
  reset: () => void;
  /** Diagnostic only: never used to render or control the legacy presentation. */
  presentationShadow: () => { snapshot: MusicSnapshot | null; differences: readonly string[] };
}

let _shared: SlidesInstance | null = null;

function _create(): SlidesInstance {
  const slides        = ref<Slide[]>([]);
  const slideIndex    = ref(0);
  const times         = ref<number[]>([]);
  const slideProgress = ref(0);
  const title         = ref("");

  let _lastBroadcastIndex = -1;
  let _lastProgressSendAt = 0;
  let _lastSlideProgressSent = -1;
  let _playbackId: string | undefined;
  let _presentationRevision = 0;
  let _pendingCommand: { targetIndex: number; at: number } | null = null;
  let _stopAudioWatch: (() => void) | null = null;
  let _audio: AudioPlayback | null = null;
  let _shadow: PresentationTransport | null = null;
  const nextShadowSession = createMusicShadowSessionFactory();
  let _shadowCommand = 0;
  let _shadowDifferences: string[] = [];
  let _shadowReported = false;

  function compareShadow(snapshot: MusicSnapshot): void {
    if (!_shadow) return;
    _shadowDifferences = musicSnapshotDifferences(snapshot, {
      title: title.value, slideIndex: slideIndex.value, totalSlides: slides.value.length,
      slide: slides.value[slideIndex.value] ?? null,
      nextSlide: slides.value[slideIndex.value + 1] ?? null,
    });
    if (_shadowDifferences.length && !_shadowReported) {
      _shadowReported = true;
      // One metadata-only incident per session, never one event per command.
      Telemetry.track("presentation_shadow_divergence", { fields: _shadowDifferences.join(",") });
    }
  }

  function shadowCommand(operation: MusicOperation): void {
    try {
      _shadow?.dispatch({ ...operation, sessionId: _shadow.requestSnapshot().sessionId, commandId: ++_shadowCommand });
    } catch {
      // Shadow failure must never interrupt the authoritative legacy path.
      _shadow = null;
    }
  }

  function publishShadow(): void {
    try {
      if (!_shadow) return;
      const packet = readMusicShadowPacket({
        version: 1, legacyRevision: _presentationRevision, snapshot: _shadow.requestSnapshot(),
      });
      if (packet) $broadcast.send(BROADCAST_TYPE.MUSIC_SHADOW_SNAPSHOT, packet);
    } catch { /* diagnostics must not block legacy */ }
  }

  const slide      = computed<Slide | null>(() => slides.value[slideIndex.value] ?? null);
  const nextSlide  = computed<Slide | null>(() => slides.value[slideIndex.value + 1] ?? null);
  const totalSlides = computed<number>(() => slides.value.length);

  // Listener de GO_TO_SLIDE vindo do Operator ou outras janelas
  $broadcast.listen((msg) => {
    if (msg.type === BROADCAST_TYPE.GO_TO_SLIDE) {
      // Só navega quem tem os slides. As janelas de projeção também escutam:
      // sem esta guarda, cada uma respondia ao pedido caindo no índice 0 da
      // própria lista vazia e transmitindo um slide nulo — a tela piscava a
      // capa a cada avanço, o Libras reiniciava a animação do avatar e, quando
      // o evento vazio chegava por último, a projeção ficava em branco.
      if (!slides.value.length) return;
      const request = msg.payload as { index?: number; _command_ts?: number };
      goToSlide(request?.index ?? 0, request?._command_ts);
    } else if (msg.type === BROADCAST_TYPE.REQUEST_MUSIC_SHADOW_SNAPSHOT) {
      publishShadow();
    } else if (msg.type === BROADCAST_TYPE.REQUEST_SLIDE_STATE) {
      // Janela secundária pediu o estado atual — reemite SLIDES_DATA (lista completa)
      // e SLIDE_CHANGE (índice atual) para que ela possa renderizar sem esperar
      // a próxima troca de slide.
      if (slides.value.length > 0) {
        $broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
          slides:      slides.value.map((s) => toRaw(s)),
          title:       title.value,
          slide_index: slideIndex.value,
          playback_id: _playbackId,
        });
        broadcastSlide();
      }
    }
  });

  function setSlides(newSlides: Slide[], newTimes: number[], newTitle: string, playbackId?: string): void {
    slides.value        = newSlides ?? [];
    times.value         = newTimes ?? [];
    title.value         = newTitle ?? "";
    _playbackId         = playbackId;
    slideIndex.value    = 0;
    slideProgress.value = 0;
    _lastBroadcastIndex = -1;
    _lastProgressSendAt = 0;
    _lastSlideProgressSent = -1;
    _pendingCommand = null;
    _shadowCommand = 0;
    _shadowDifferences = [];
    _shadowReported = false;
    try {
      _shadow = createMemoryPresentationTransport(new MusicPresentationCore(
        nextShadowSession(), newSlides ?? [], newTimes ?? [], newTitle ?? ""
      ));
      _shadow.subscribe(compareShadow);
      compareShadow(_shadow.requestSnapshot());
    } catch {
      _shadow = null;
    }
  }

  function setPlaybackId(playbackId?: string): void {
    _playbackId = playbackId;
  }

  // Trocar cantada por playback mantendo o slide no ar: as marcações dos dois
  // áudios são independentes e chegam a divergir alguns segundos, então o que
  // se preserva é o slide, não o instante do relógio.
  function setTimes(newTimes: number[]): void {
    times.value = newTimes ?? [];
    shadowCommand({ type: "times", times: times.value });
  }

  /** Instante, na faixa vigente, do ponto `fraction` (0-1) dentro do slide `index`. */
  function timeForPosition(index: number, fraction: number, duration: number): number {
    const start = times.value[index] ?? 0;
    const end   = times.value[index + 1] ?? duration;
    if (!Number.isFinite(end) || end <= start) return start;
    return start + Math.max(0, Math.min(1, fraction)) * (end - start);
  }

  function broadcastSlide(): void {
    const idx = slideIndex.value;
    const sentAt = Date.now();
    const commandAt = _pendingCommand?.targetIndex === idx &&
      sentAt - _pendingCommand.at <= 30_000
      ? _pendingCommand.at
      : undefined;
    if (commandAt !== undefined) _pendingCommand = null;
    const presentationRevision = ++_presentationRevision;
    $broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
      slide_index:  idx,
      slide:        toRaw(slide.value),
      next_slide:   toRaw(nextSlide.value),
      title:        title.value,
      progress:     _audio?.progress.value ?? 0,
      total_slides: totalSlides.value,
      playback_id: _playbackId,
      presentation_revision: presentationRevision,
      presentation_session: _shadow?.requestSnapshot().sessionId,
      // Preserva o início do comando mesmo quando um seek de áudio só publica
      // a troca depois que o relógio do player avança.
      _command_ts: commandAt,
      // Permite medir a latência real entre a janela do operador e as janelas
      // auxiliares sem enviar o conteúdo da letra.
      _ts: sentAt,
    });

    // Também reenviamos o progresso do SLIDE atual (0-100) para janelas
    // de retorno (que não têm acesso direto ao áudio).
    $broadcast.send(BROADCAST_TYPE.SLIDE_PROGRESS, {
      slide_index: idx,
      slide_progress: slideProgress.value,
      playback_id: _playbackId,
      presentation_revision: presentationRevision,
    });
    publishShadow();
    // Telemetria não participa do caminho de publicação do slide.
    if (isProjectionMilestone(idx, totalSlides.value, !!slide.value)) {
      Telemetry.track("projection_slide_broadcast", {
        slide_index: idx,
        total_slides: totalSlides.value,
        has_slide: !!slide.value,
        has_next_slide: !!nextSlide.value,
        playback_id: _playbackId,
        presentation_revision: presentationRevision,
      });
    }
  }

  function goToSlide(index: number, commandAt?: number): void {
    const last = totalSlides.value - 1;
    const requestedIndex = Number.isFinite(index) ? Math.floor(index) : 0;
    const idx  = Math.max(0, Math.min(requestedIndex, last < 0 ? 0 : last));
    const now = Date.now();
    const issuedAt = typeof commandAt === "number" && Number.isFinite(commandAt) &&
      commandAt <= now + 1_000 && commandAt >= now - 30_000 ? commandAt : now;
    _pendingCommand = { targetIndex: idx, at: issuedAt };

    // Com áudio e timestamps: seek no áudio → slideIndex atualiza via watcher reativo
    if (_audio && _audio.duration.value > 0 && times.value.length > 0) {
      _audio.seekTo(times.value[idx] ?? 0);
    } else {
      slideIndex.value = idx;
      shadowCommand({ type: "select", index });
      broadcastSlide();
    }
  }

  function goPrev(): void  { goToSlide(slideIndex.value - 1); }
  function goNext(): void  { goToSlide(slideIndex.value + 1); }
  function goFirst(): void { goToSlide(0); }
  function goLast(): void  { goToSlide(totalSlides.value - 1); }

  // Vincula ao useAudioPlayback: watch reativo em currentTime substitui RAF/setInterval
  function bindAudio(audioPlayback: AudioPlayback): void {
    _audio = audioPlayback;
    if (_stopAudioWatch) {
      _stopAudioWatch();
      _stopAudioWatch = null;
    }
    _stopAudioWatch = watch(
      () => audioPlayback.currentTime.value,
      (ct) => {
        const ts = times.value;
        const d  = audioPlayback.duration.value;
        if (!ts?.length) return;

        const si    = Math.max(0, ts.filter((t) => t <= ct).length - 1);
        const start = ts[si] ?? 0;
        const end   = ts[si + 1] ?? d;
        const spRaw = end > start ? ((ct - start) / (end - start)) * 100 : 0;
        const sp    = Math.max(0, Math.min(100, spRaw));

        slideProgress.value = sp;
        slideIndex.value    = si;

        // Envia progresso do slide de forma contínua (throttled) para
        // permitir animação fluida em ProjectionReturn.
        const now = Date.now();
        const sendByTime = now - _lastProgressSendAt >= 100; // ~10fps
        const sendByDelta = Math.abs(sp - _lastSlideProgressSent) >= 0.75;
        if (sendByTime || sendByDelta) {
          _lastProgressSendAt = now;
          _lastSlideProgressSent = sp;
          $broadcast.send(BROADCAST_TYPE.SLIDE_PROGRESS, {
            slide_index: si,
            slide_progress: sp,
            playback_id: _playbackId,
            presentation_revision: _presentationRevision,
          });
        }

        if (si !== _lastBroadcastIndex) {
          _lastBroadcastIndex = si;
          // Audio commands commit only when the actual player clock advances.
          // The core independently derives the index from the same time input.
          shadowCommand({ type: "clock", position: ct });
          broadcastSlide();
        }
      }
    );
  }

  function unbindAudio(): void {
    if (_stopAudioWatch) {
      _stopAudioWatch();
      _stopAudioWatch = null;
    }
    _audio = null;
  }

  function reset(): void {
    unbindAudio();
    slides.value        = [];
    slideIndex.value    = 0;
    times.value         = [];
    slideProgress.value = 0;
    title.value         = "";
    _playbackId         = undefined;
    _pendingCommand     = null;
    _lastBroadcastIndex = -1;
    _lastProgressSendAt = 0;
    _lastSlideProgressSent = -1;
    shadowCommand({ type: "close" });
    publishShadow();
  }

  return {
    slides, slideIndex, slideProgress, title,
    slide, nextSlide, totalSlides,
    setSlides, setPlaybackId, setTimes, timeForPosition, bindAudio, unbindAudio, broadcastSlide,
    goToSlide, goPrev, goNext, goFirst, goLast, reset,
    presentationShadow: () => ({ snapshot: _shadow?.requestSnapshot() ?? null, differences: [..._shadowDifferences] }),
  };
}

export function useSlides(): SlidesInstance {
  if (!_shared) _shared = _create();
  return _shared;
}
