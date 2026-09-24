import { ref, computed, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from "vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry, { isProjectionMilestone } from "@/helpers/Telemetry";
import Path from "@/helpers/Path";
import { MusicShadowReceiver } from "@/presentation/MusicShadowReceiver";

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
  isCover: ComputedRef<boolean>;
  bgImgStyle: ComputedRef<BgImgStyle>;
}

/**
 * Estado reativo compartilhado entre as views de projeção.
 * Encapsula a subscrição ao SLIDE_CHANGE e os computed derivados comuns.
 */
export function useProjectionState(): ProjectionStateReturn {
  const slide = ref<Slide>(null);
  const nextSlide = ref<Slide>(null);
  const title = ref("");
  const progress = ref(0);
  const slideProgress = ref(0);
  const slideIndex = ref(0);
  const totalSlides = ref(0);
  let frameProbeGeneration = 0;
  let musicSlideActive = false;
  let musicPlaybackId: string | undefined;
  let musicRevision: number | undefined;
  const shadowReceiver = new MusicShadowReceiver();
  function compareShadow(): void {
    try {
      const fields = shadowReceiver.takeDifferences();
      if (fields.length) Telemetry.track("presentation_shadow_renderer_divergence", { fields: fields.join(",") });
    } catch { /* diagnostic failure cannot affect projection */ }
  }

  onBeforeUnmount(() => {
    // Um rAF pendente não deve atribuir o frame da próxima rota ao slide antigo.
    frameProbeGeneration++;
  });

  useBroadcastListener(BROADCAST_TYPE.MUSIC_SHADOW_SNAPSHOT, (payload) => {
    shadowReceiver.receive(payload);
    compareShadow();
  });

  useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload) => {
    const p = payload as Record<string, unknown>;
    const receivedAt = Date.now();
    const probeGeneration = ++frameProbeGeneration;
    const playbackId = typeof p.playback_id === "string" ? p.playback_id : undefined;
    const revision = typeof p.presentation_revision === "number" &&
      Number.isSafeInteger(p.presentation_revision) && p.presentation_revision >= 0
      ? p.presentation_revision : undefined;
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
    shadowReceiver.observe(p.presentation_session, musicRevision, {
      active: true, slide: slide.value, nextSlide: nextSlide.value, title: title.value,
      slideIndex: slideIndex.value, totalSlides: totalSlides.value,
    });
    compareShadow();

    if (typeof p._ts === "number" && Number.isFinite(p._ts) &&
        p._ts >= receivedAt - 300_000 && p._ts <= receivedAt + 1_000) {
      const sentAt = p._ts;
      const latencyMs = Math.max(0, receivedAt - sentAt);
      if (isProjectionMilestone(slideIndex.value, totalSlides.value, !!slide.value)) {
        Telemetry.track("projection_broadcast_received", {
          broadcast_type: BROADCAST_TYPE.SLIDE_CHANGE,
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
  });

  // Listener para versículos da bíblia. Permite que a janela de projeção principal
  // (Projection.vue) ou o OBS/Return exibam versículos quando o usuário não tem
  // um monitor de Bíblia dedicado ou quando o sinal é global.
  useBroadcastListener(BROADCAST_TYPE.BIBLE_VERSE, (payload) => {
    const p = payload as Record<string, unknown>;
    if (p.active) {
      musicSlideActive = false;
      shadowReceiver.suspend();
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
    shadowReceiver.close();
    compareShadow();
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
    $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
    $broadcast.send(BROADCAST_TYPE.REQUEST_MUSIC_SHADOW_SNAPSHOT);
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
    isCover,
    bgImgStyle,
  };
}
