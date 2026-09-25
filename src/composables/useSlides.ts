import { ref, computed, watch, toRaw, type Ref, type ComputedRef } from "vue";
import $broadcast from "@/helpers/Broadcast";
import type { AudioPlayback } from "@/composables/useAudioPlayback";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry, { isProjectionMilestone } from "@/helpers/Telemetry";
import { MusicPresentationCore, type MusicOperation, type MusicSnapshot } from "@/presentation/MusicPresentationCore";
import { createMemoryPresentationTransport, type PresentationTransport } from "@/presentation/PresentationTransport";
import { createBroadcastPresentationTransport } from "@/presentation/BroadcastPresentationTransport";
import { readMusicPresentationPacket, type MusicPresentationPacket } from "@/presentation/MusicPresentationPacket";
import { createMusicPresentationSessionFactory } from "@/helpers/MusicPresentationSession";

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
  presentationSnapshot: () => MusicSnapshot | null;
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
  let _nextPublishRetryAt = 0;
  let _publishRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let _publishRetryAttempts = 0;
  let _playbackId: string | undefined;
  let _presentationRevision = 0;
  let _pendingStateCommitAt = 0;
  let _pendingCommand: { targetIndex: number; at: number } | null = null;
  let _stopAudioWatch: (() => void) | null = null;
  let _audio: AudioPlayback | null = null;
  let _core: PresentationTransport | null = null;
  let _lastPresentationPacket: MusicPresentationPacket | null = null;
  const _visualTransport = createBroadcastPresentationTransport($broadcast, {
    currentSnapshot: () => _lastPresentationPacket,
  });
  const nextCoreSession = createMusicPresentationSessionFactory();
  let _coreCommand = 0;
  let _publishFailureReported = false;
  let _coreFailureReported = false;

  function reportCoreFailure(error: unknown, phase: "initialize" | "command"): void {
    if (_coreFailureReported) return;
    _coreFailureReported = true;
    Telemetry.captureException(error, { source: "presentation_core", phase });
    Telemetry.track("presentation_core_failed", { phase });
  }

  function cancelPublishRetry(): void {
    if (_publishRetryTimer) clearTimeout(_publishRetryTimer);
    _publishRetryTimer = null;
    _publishRetryAttempts = 0;
  }

  function schedulePublishRetry(sessionId: string): void {
    if (_publishRetryTimer || _publishRetryAttempts >= 2) return;
    _publishRetryAttempts++;
    _publishRetryTimer = setTimeout(() => {
      _publishRetryTimer = null;
      if (_core?.requestSnapshot().sessionId !== sessionId || !_core.requestSnapshot().active) return;
      broadcastSlide();
    }, 1_000);
  }

  function scheduleCloseRetry(sessionId: string): void {
    if (_publishRetryTimer || _publishRetryAttempts >= 2) return;
    _publishRetryAttempts++;
    _publishRetryTimer = setTimeout(() => {
      _publishRetryTimer = null;
      const current = _core?.requestSnapshot();
      if (!current || current.sessionId !== sessionId || current.active) return;
      const failure = publishVisualSnapshot();
      if (failure) scheduleCloseRetry(sessionId);
      else cancelPublishRetry();
    }, 1_000);
  }

  function coreCommand(operation: MusicOperation): MusicSnapshot | null {
    try {
      if (!_core) return null;
      _core.dispatch({ ...operation, sessionId: _core.requestSnapshot().sessionId, commandId: ++_coreCommand });
      return _core.requestSnapshot();
    } catch (error) {
      // A failed core command must not silently select via the old renderer path.
      _core = null;
      reportCoreFailure(error, "command");
      return null;
    }
  }

  function publishVisualSnapshot(timing: { sentAt: number; commandAt?: number; commitAt?: number } = { sentAt: Date.now() }): string | null {
    if (!_core) return "core_unavailable";
    try {
      const boundedPercent = (value: number): number => Number.isFinite(value)
        ? Math.max(0, Math.min(100, value)) : 0;
      const packet = readMusicPresentationPacket({
        schema: 1,
        selectionRevision: _presentationRevision,
        playbackId: _playbackId,
        progress: boundedPercent(_audio?.progress.value ?? 0),
        slideProgress: boundedPercent(slideProgress.value),
        emittedAt: timing.sentAt,
        commandAt: timing.commandAt,
        commitAt: timing.commitAt,
        snapshot: _core.requestSnapshot(),
      });
      if (!packet) return "invalid_packet";
      _lastPresentationPacket = packet;
      const delivery = _visualTransport.publish(packet);
      return delivery === "sent" ? null : delivery;
    } catch {
      // Invalid snapshots are never sent to a visual renderer.
      return "publish_exception";
    }
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
      const request = msg.payload as { index?: unknown; presentation_session?: unknown; _command_ts?: number } | null;
      const currentSession = _core?.requestSnapshot().sessionId;
      if (!currentSession || request?.presentation_session !== currentSession ||
          typeof request.index !== "number" || !Number.isSafeInteger(request.index)) return;
      goToSlide(request.index, request._command_ts);
    } else if (msg.type === BROADCAST_TYPE.REQUEST_SLIDE_STATE) {
      // Janela secundária pediu o estado atual: lista completa para Operator e
      // controle remoto, mais snapshot canônico para a projeção visual.
      if (slides.value.length > 0) {
        $broadcast.send(BROADCAST_TYPE.SLIDES_DATA, {
          slides:      slides.value.map((s) => toRaw(s)),
          title:       title.value,
          slide_index: slideIndex.value,
          playback_id: _playbackId,
          presentation_session: _core?.requestSnapshot().sessionId,
        });
        broadcastSlide();
      }
    }
  });

  function setSlides(newSlides: Slide[], newTimes: number[], newTitle: string, playbackId?: string): void {
    _lastPresentationPacket = null;
    cancelPublishRetry();
    slides.value        = newSlides ?? [];
    times.value         = newTimes ?? [];
    title.value         = newTitle ?? "";
    _playbackId         = playbackId;
    slideIndex.value    = 0;
    slideProgress.value = 0;
    _pendingStateCommitAt = Date.now();
    _lastBroadcastIndex = -1;
    _lastProgressSendAt = 0;
    _lastSlideProgressSent = -1;
    _nextPublishRetryAt = 0;
    _pendingCommand = null;
    _coreCommand = 0;
    _publishFailureReported = false;
    _coreFailureReported = false;
    try {
      _core = createMemoryPresentationTransport(new MusicPresentationCore(
        nextCoreSession(), newSlides ?? [], newTimes ?? [], newTitle ?? ""
      ));
    } catch (error) {
      _core = null;
      reportCoreFailure(error, "initialize");
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
    coreCommand({ type: "times", times: times.value });
  }

  /** Instante, na faixa vigente, do ponto `fraction` (0-1) dentro do slide `index`. */
  function timeForPosition(index: number, fraction: number, duration: number): number {
    const start = times.value[index] ?? 0;
    const end   = times.value[index + 1] ?? duration;
    if (!Number.isFinite(end) || end <= start) return start;
    return start + Math.max(0, Math.min(1, fraction)) * (end - start);
  }

  function broadcastSlide(): void {
    const canonical = _core?.requestSnapshot();
    if (!canonical?.active) return;
    if (canonical?.active && canonical.slideIndex !== slideIndex.value) {
      // The reducer, not the compatibility ref, owns selection.
      slideIndex.value = canonical.slideIndex;
    }
    const idx = slideIndex.value;
    const sentAt = Date.now();
    const commitAt = _pendingStateCommitAt > 0 && _pendingStateCommitAt <= sentAt &&
      sentAt - _pendingStateCommitAt <= 30_000 ? _pendingStateCommitAt : undefined;
    _pendingStateCommitAt = 0;
    const commandAt = _pendingCommand?.targetIndex === idx &&
      sentAt - _pendingCommand.at <= 30_000
      ? _pendingCommand.at
      : undefined;
    if (commandAt !== undefined) _pendingCommand = null;
    const presentationRevision = ++_presentationRevision;
    const publishFailure = publishVisualSnapshot({ sentAt, commandAt, commitAt });
    if (publishFailure) {
      _nextPublishRetryAt = sentAt + 1_000;
      if (!_publishFailureReported) {
        _publishFailureReported = true;
        Telemetry.track("presentation_snapshot_publish_failed", { reason: publishFailure });
      }
      const sessionId = canonical?.sessionId;
      if (sessionId) schedulePublishRetry(sessionId);
      return;
    }
    cancelPublishRetry();
    _lastBroadcastIndex = idx;
    _nextPublishRetryAt = 0;

    // Também reenviamos o progresso do SLIDE atual (0-100) para janelas
    // de retorno (que não têm acesso direto ao áudio).
    $broadcast.send(BROADCAST_TYPE.SLIDE_PROGRESS, {
      slide_index: idx,
      slide_progress: slideProgress.value,
      playback_id: _playbackId,
      presentation_revision: presentationRevision,
    });
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
      const canonical = coreCommand({ type: "select", index });
      if (!canonical?.active) return;
      slideIndex.value = canonical.slideIndex;
      _pendingStateCommitAt = Date.now();
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

        const canonical = coreCommand({ type: "clock", position: ct });
        if (!canonical?.active) return;
        const si = canonical.slideIndex;
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

        if (si !== _lastBroadcastIndex && now >= _nextPublishRetryAt) {
          _pendingStateCommitAt = now;
          // Audio commands commit only when the actual player clock advances.
          // The core independently derives the index from the same time input.
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
    cancelPublishRetry();
    slides.value        = [];
    slideIndex.value    = 0;
    times.value         = [];
    slideProgress.value = 0;
    title.value         = "";
    _playbackId         = undefined;
    _pendingCommand     = null;
    _pendingStateCommitAt = 0;
    _lastBroadcastIndex = -1;
    _lastProgressSendAt = 0;
    _lastSlideProgressSent = -1;
    _nextPublishRetryAt = 0;
    const closed = _core?.requestSnapshot().active ? coreCommand({ type: "close" }) : null;
    if (closed && !closed.active) {
      const failure = publishVisualSnapshot();
      if (failure) {
        if (!_publishFailureReported) {
          _publishFailureReported = true;
          Telemetry.track("presentation_snapshot_publish_failed", { reason: failure, phase: "close" });
        }
        scheduleCloseRetry(closed.sessionId);
      }
    }
  }

  return {
    slides, slideIndex, slideProgress, title,
    slide, nextSlide, totalSlides,
    setSlides, setPlaybackId, setTimes, timeForPosition, bindAudio, unbindAudio, broadcastSlide,
    goToSlide, goPrev, goNext, goFirst, goLast, reset,
    presentationSnapshot: () => _core?.requestSnapshot() ?? null,
  };
}

export function useSlides(): SlidesInstance {
  if (!_shared) _shared = _create();
  return _shared;
}
