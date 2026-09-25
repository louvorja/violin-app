import { ref, computed, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from "vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry, { isProjectionMilestone } from "@/helpers/Telemetry";
import Path from "@/helpers/Path";
import { createBroadcastPresentationTransport } from "@/presentation/BroadcastPresentationTransport";
import type { MusicPresentationPacket } from "@/presentation/MusicPresentationPacket";

export type Slide = Record<string, unknown> | null;

export const IMAGE_POSITION_MAP: Record<string | number, string> = {
  center: "center center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
  1: "left top",
  2: "center top",
  3: "right top",
  4: "left center",
  5: "center center",
  6: "right center",
  7: "left bottom",
  8: "center bottom",
  9: "right bottom",
};

export const COLOR_COVER_GOLD = "#EFB400";
export const COLOR_LYRIC_WHITE = "#FFFFFF";

interface BgImgStyle {
  backgroundImage?: string;
  backgroundSize: string;
  backgroundPosition: string;
}

interface ProjectionStateReturn {
  slide: Ref<Slide>;
  nextSlide: Ref<Slide>;
  title: Ref<string>;
  progress: Ref<number>;
  /** 0-100. Progresso contínuo do slide atual (para barra fina no Return). */
  slideProgress: Ref<number>;
  slideIndex: Ref<number>;
  totalSlides: Ref<number>;
  sessionId: Ref<string | null>;
  isCover: ComputedRef<boolean>;
  bgImgStyle: ComputedRef<BgImgStyle>;
}

/**
 * Estado reativo compartilhado entre as views de projeção.
 * Recebe o snapshot canônico de música. Eventos não versionados continuam
 * servindo outras fontes de projeção (editor, Bíblia e mídia não musical),
 * mas não existe fallback visual de música para SLIDE_CHANGE.
 */
export function useProjectionState(): ProjectionStateReturn {
  const slide = ref<Slide>(null);
  const nextSlide = ref<Slide>(null);
  const title = ref("");
  const progress = ref(0);
  const slideProgress = ref(0);
  const slideIndex = ref(0);
  const totalSlides = ref(0);
  const sessionId = ref<string | null>(null);
  let frameProbeGeneration = 0;
  let musicSlideActive = false;
  let musicPlaybackId: string | undefined;
  let musicRevision: number | undefined;
  let currentVersionedSelection: { session: string; revision: number } | null = null;
  let lastMissingSnapshotKey = "";
  const reportedMissingSessions = new Set<string>();
  let expectedMusicSession: string | null = null;
  let snapshotWaitTimer: ReturnType<typeof setTimeout> | null = null;
  function clearSnapshotWait(): void {
    if (snapshotWaitTimer) clearTimeout(snapshotWaitTimer);
    snapshotWaitTimer = null;
    expectedMusicSession = null;
  }
  const retiredSessions = new Set<string>();
  const retireSession = (session: string): void => {
    retiredSessions.delete(session);
    retiredSessions.add(session);
    if (retiredSessions.size > 32) retiredSessions.delete(retiredSessions.values().next().value!);
  };
  const visualTransport = createBroadcastPresentationTransport($broadcast);

  onBeforeUnmount(() => {
    // Um rAF pendente não deve atribuir o frame da próxima rota ao slide antigo.
    frameProbeGeneration++;
    stopVisualTransport?.();
    visualTransport.dispose();
    clearSnapshotWait();
  });

  function applySelection(p: Record<string, unknown>, source: "canonical" | "editor"): void {
    const playbackId = typeof p.playback_id === "string" ? p.playback_id : undefined;
    const revision = typeof p.presentation_revision === "number" &&
      Number.isSafeInteger(p.presentation_revision) && p.presentation_revision >= 0
      ? p.presentation_revision : undefined;
    const session = typeof p.presentation_session === "string" && p.presentation_session.length > 0
      ? p.presentation_session : undefined;
    if (source === "editor" && (session || revision !== undefined)) {
      // Versioned music has one visual authority: the validated core packet.
      // Only the validated core packet is allowed to select music visually.
      if (session && !retiredSessions.has(session) &&
          (currentVersionedSelection?.session !== session || currentVersionedSelection.revision < (revision ?? 0))) {
        const key = `${session}:${revision ?? "unknown"}`;
        if (lastMissingSnapshotKey !== key) {
          lastMissingSnapshotKey = key;
          visualTransport.requestSnapshot();
          if (!reportedMissingSessions.has(session)) {
            reportedMissingSessions.add(session);
            if (reportedMissingSessions.size > 32) reportedMissingSessions.delete(reportedMissingSessions.values().next().value!);
            Telemetry.track("presentation_snapshot_missing", { reason: "versioned_event_without_snapshot" });
          }
        }
      }
      return;
    }
    if (session && revision !== undefined) {
      if (retiredSessions.has(session)) return;
      if (currentVersionedSelection?.session === session) {
        if (revision <= currentVersionedSelection.revision) return;
      } else if (currentVersionedSelection) {
        retireSession(currentVersionedSelection.session);
      }
      currentVersionedSelection = { session, revision };
      sessionId.value = session;
      if (expectedMusicSession === session) clearSnapshotWait();
    } else if (currentVersionedSelection) {
      // The editor has no comparable identity. Keep its active behavior while
      // preventing a delayed packet from the previous versioned song.
      retireSession(currentVersionedSelection.session);
      currentVersionedSelection = null;
      sessionId.value = null;
      clearSnapshotWait();
    }
    const receivedAt = Date.now();
    const probeGeneration = ++frameProbeGeneration;
    if (playbackId !== musicPlaybackId || revision !== musicRevision || p.slide_index !== slideIndex.value) {
      slideProgress.value = 0;
    }
    musicPlaybackId = playbackId;
    musicRevision = revision;
    musicSlideActive = p.slide != null;
    slide.value = (p.slide as Slide) ?? null;
    nextSlide.value = (p.next_slide as Slide) ?? null;
    title.value = (p.title as string) ?? "";
    progress.value = (p.progress as number) ?? 0;
    slideIndex.value = (p.slide_index as number) ?? 0;
    totalSlides.value = (p.total_slides as number) ?? (p.last_slide as number) ?? 0;
    const stateAppliedAt = Date.now();

    if (typeof p._ts === "number" && Number.isFinite(p._ts) &&
        p._ts >= receivedAt - 300_000 && p._ts <= receivedAt + 1_000) {
      const sentAt = p._ts;
      const latencyMs = Math.max(0, receivedAt - sentAt);
      if (isProjectionMilestone(slideIndex.value, totalSlides.value, !!slide.value)) {
        Telemetry.track("projection_broadcast_received", {
          broadcast_type: source === "canonical"
            ? BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT : BROADCAST_TYPE.SLIDE_CHANGE,
          slide_index: p.slide_index,
          playback_id: p.playback_id,
          latency_ms: latencyMs,
        });
      }
      Telemetry.histogram("louvorja.projection.broadcast.latency", latencyMs, {
        window_role: "auxiliary",
      });

      // nextTick confirma que o Vue aplicou a mudança no DOM. Dois rAFs
      // observam a primeira oportunidade de pintura após esse patch; não
      // afirmam que o monitor físico exibiu o frame (isso exige o lab Windows).
      // Uma troca posterior ou rota desmontada invalida a amostra anterior.
      if (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden") {
        void nextTick().then(() => {
          if (probeGeneration !== frameProbeGeneration) return;
          const domUpdatedAt = Date.now();
          requestAnimationFrame(() => {
            if (probeGeneration !== frameProbeGeneration) return;
            requestAnimationFrame(() => {
              if (probeGeneration !== frameProbeGeneration || document.visibilityState === "hidden") return;
              const frameAt = Date.now();
              const broadcastToFrameMs = Math.max(0, frameAt - sentAt);
              const receiveToStateApplyMs = Math.max(0, stateAppliedAt - receivedAt);
              const stateApplyToDomMs = Math.max(0, domUpdatedAt - stateAppliedAt);
              const domToFrameMs = Math.max(0, frameAt - domUpdatedAt);
              const commandAt = typeof p._command_ts === "number" &&
                Number.isFinite(p._command_ts) && p._command_ts <= sentAt &&
                p._command_ts >= sentAt - 30_000
                ? p._command_ts
                : null;
              const commandToFrameMs = commandAt === null ? null : Math.max(0, frameAt - commandAt);
              const commitAt = typeof p._commit_ts === "number" &&
                Number.isFinite(p._commit_ts) && p._commit_ts <= sentAt &&
                p._commit_ts >= sentAt - 30_000
                ? p._commit_ts
                : null;
              Telemetry.histogram("louvorja.projection.slide.frame_opportunity", broadcastToFrameMs, {
                window_role: "auxiliary",
              });
              if (commandToFrameMs !== null) {
                Telemetry.histogram("louvorja.projection.slide.command_to_frame", commandToFrameMs, {
                  window_role: "auxiliary",
                });
              }
              if (isProjectionMilestone(slideIndex.value, totalSlides.value, !!slide.value) || broadcastToFrameMs >= 500) {
                Telemetry.track("projection_slide_frame_opportunity", {
                  slide_index: slideIndex.value,
                  playback_id: p.playback_id,
                  presentation_revision: typeof p.presentation_revision === "number" &&
                    Number.isSafeInteger(p.presentation_revision) && p.presentation_revision >= 0
                    ? p.presentation_revision : undefined,
                  broadcast_to_receive_ms: latencyMs,
                  // Alias legado: este campo historicamente mediu ate nextTick.
                  receive_to_apply_ms: Math.max(0, domUpdatedAt - receivedAt),
                  receive_to_state_apply_ms: receiveToStateApplyMs,
                  state_apply_to_dom_ms: stateApplyToDomMs,
                  dom_to_frame_ms: domToFrameMs,
                  broadcast_to_frame_ms: broadcastToFrameMs,
                  ...(commitAt === null ? {} : {
                    commit_to_emit_ms: Math.max(0, sentAt - commitAt),
                  }),
                  ...(commandAt === null || commitAt === null || commandAt > commitAt ? {} : {
                    command_to_commit_ms: Math.max(0, commitAt - commandAt),
                  }),
                  ...(commandToFrameMs === null ? {} : { command_to_frame_ms: commandToFrameMs }),
                });
              }
            });
          });
        });
      }
    }
    if (import.meta.env.DEV && typeof p._ts === "number") {
      const log = (window as { __ljLatencyLog?: number[] }).__ljLatencyLog;
      if (Array.isArray(log)) log.push(Date.now() - (p._ts as number));
    }
  }

  useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload) => {
    applySelection(payload as Record<string, unknown>, "editor");
  });

  // SLIDES_DATA carries the full operator deck. Its session identity also
  // tells this visual receiver that a music snapshot ought to arrive. A
  // single delayed retry/incident per session makes a blank projection
  // diagnosable without a polling loop in the render path.
  useBroadcastListener(BROADCAST_TYPE.SLIDES_DATA, (payload) => {
    const session = (payload as Record<string, unknown>)?.presentation_session;
    if (typeof session !== "string" || !session || session.length > 128 ||
        retiredSessions.has(session) || currentVersionedSelection?.session === session ||
        expectedMusicSession === session) return;
    clearSnapshotWait();
    expectedMusicSession = session;
    visualTransport.requestSnapshot();
    if (expectedMusicSession !== session) return;
    snapshotWaitTimer = setTimeout(() => {
      snapshotWaitTimer = null;
      if (expectedMusicSession !== session || currentVersionedSelection?.session === session) return;
      if (!reportedMissingSessions.has(session)) {
        reportedMissingSessions.add(session);
        if (reportedMissingSessions.size > 32) reportedMissingSessions.delete(reportedMissingSessions.values().next().value!);
        Telemetry.track("presentation_snapshot_missing", { reason: "timeout_after_deck" });
      }
      visualTransport.requestSnapshot();
    }, 2_000);
  });

  const stopVisualTransport = visualTransport?.subscribe((packet: MusicPresentationPacket) => {
    const snapshot = packet.snapshot;
    if (!snapshot.active) {
      // MEDIA_CLOSE is shared with other projection sources. A music close may
      // clear only the currently displayed music from the same core session.
      if (currentVersionedSelection?.session === snapshot.sessionId) {
        retireSession(snapshot.sessionId);
        currentVersionedSelection = null;
        sessionId.value = null;
        clearSnapshotWait();
        if (musicSlideActive) {
          frameProbeGeneration++;
          musicSlideActive = false;
          musicPlaybackId = undefined;
          musicRevision = undefined;
          slide.value = null;
          nextSlide.value = null;
          title.value = "";
          progress.value = 0;
          slideProgress.value = 0;
          slideIndex.value = 0;
          totalSlides.value = 0;
        }
      }
      return;
    }
    // The validated reducer snapshot owns visual selection. The emission
    // revision correlates the independent progress stream.
    applySelection({
      presentation_session: snapshot.sessionId,
      presentation_revision: packet.selectionRevision,
      playback_id: packet.playbackId,
      slide_index: snapshot.slideIndex,
      slide: snapshot.slide,
      next_slide: snapshot.nextSlide,
      title: snapshot.title,
      total_slides: snapshot.totalSlides,
      progress: packet.progress,
      slide_progress: packet.slideProgress,
      _ts: packet.emittedAt,
      _command_ts: packet.commandAt,
      _commit_ts: packet.commitAt,
    }, "canonical");
    slideProgress.value = packet.slideProgress;
  });

  // Listener para versículos da bíblia. Permite que a janela de projeção principal
  // (Projection.vue) ou o OBS/Return exibam versículos quando o usuário não tem
  // um monitor de Bíblia dedicado ou quando o sinal é global.
  useBroadcastListener(BROADCAST_TYPE.BIBLE_VERSE, (payload) => {
    const p = payload as Record<string, unknown>;
    if (p.active) {
      clearSnapshotWait();
      musicSlideActive = false;
      sessionId.value = null;
      slide.value = {
        lyric: (p.text as string) || "",
        aux_lyric: (p.reference as string) || "",
        is_bible: true,
      } as Slide;
      title.value = (p.reference as string) || "";
      progress.value = 0;
      slideIndex.value = 0;
      totalSlides.value = 1;
    } else {
      // Se não estiver ativo e o slide atual for bíblia, limpamos
      if (slide.value && (slide.value as any).is_bible) {
        slide.value = null;
        title.value = "";
      }
    }
  });

  // Limpa a tela quando a música é fechada — emitido por `useMedia.close()`.
  // Sem este reset, janelas de projeção e clients de transmissão (OBS)
  // ficam mostrando a letra da música anterior indefinidamente.
  useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, () => {
    clearSnapshotWait();
    if (currentVersionedSelection) {
      retireSession(currentVersionedSelection.session);
      currentVersionedSelection = null;
    }
    musicSlideActive = false;
    musicPlaybackId = undefined;
    musicRevision = undefined;
    sessionId.value = null;
    slide.value = null;
    nextSlide.value = null;
    title.value = "";
    progress.value = 0;
    slideProgress.value = 0;
    slideIndex.value = 0;
    totalSlides.value = 0;
  });

  // Progresso contínuo do slide atual (throttled) para a barra no stage display.
  useBroadcastListener(BROADCAST_TYPE.SLIDE_PROGRESS, (payload) => {
    const p = payload as Record<string, unknown>;
    // Progress is not a navigation command. A late/replayed packet must never
    // select another slide or change the progress of a newer song/revision.
    if (!musicSlideActive || p.slide_index !== slideIndex.value ||
        p.playback_id !== musicPlaybackId || p.presentation_revision !== musicRevision) return;
    const sp = p.slide_progress;
    if (typeof sp !== "number" || !Number.isFinite(sp)) return;
    slideProgress.value = Math.max(0, Math.min(100, sp));
  });

  // Register all consumers before requesting: the local Broadcast fan-out can
  // answer synchronously, whereas another window answers asynchronously.
  onMounted(() => {
    visualTransport.requestSnapshot();
    $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
  });

  const isCover = computed<boolean>(
    () =>
      !!(
        slide.value &&
        (slide.value.cover === true ||
          slide.value.tipo === "CAPA" ||
          slide.value.is_cover === true ||
          slideIndex.value === 0)
      )
  );

  const bgImgStyle = computed<BgImgStyle>(() => {
    const pos =
      IMAGE_POSITION_MAP[slide.value?.image_position as string | number] || "center center";
    const image = slide.value?.url_image as string | undefined;
    let imageUrl: string | undefined;
    if (image) {
      try {
        imageUrl = Path.file(image);
      } catch {
        imageUrl = image;
      }
    }
    return {
      backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
      backgroundSize: "cover",
      backgroundPosition: pos,
    };
  });

  return {
    slide,
    nextSlide,
    title,
    progress,
    slideProgress,
    slideIndex,
    totalSlides,
    sessionId,
    isCover,
    bgImgStyle,
  };
}
