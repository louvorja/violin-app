import { ref, computed, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from "vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry, { isProjectionMilestone } from "@/helpers/Telemetry";
import Path from "@/helpers/Path";

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

  onBeforeUnmount(() => {
    // Um rAF pendente não deve atribuir o frame da próxima rota ao slide antigo.
    frameProbeGeneration++;
  });

  // Janelas que abrem depois da música começar não recebem o broadcast
  // anterior. Solicitamos reemissão ao montar — o emissor (useSlides na
  // janela principal) reenviará SLIDE_CHANGE se houver slides ativos.
  onMounted(() => {
    $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
  });

  useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload) => {
    const p = payload as Record<string, unknown>;
    const receivedAt = Date.now();
    const probeGeneration = ++frameProbeGeneration;
    slide.value = (p.slide as Slide) ?? null;
    nextSlide.value = (p.next_slide as Slide) ?? null;
    title.value = (p.title as string) ?? "";
    progress.value = (p.progress as number) ?? 0;
    slideIndex.value = (p.slide_index as number) ?? 0;
    totalSlides.value = (p.total_slides as number) ?? (p.last_slide as number) ?? 0;

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
          const appliedAt = Date.now();
          requestAnimationFrame(() => {
            if (probeGeneration !== frameProbeGeneration) return;
            requestAnimationFrame(() => {
              if (probeGeneration !== frameProbeGeneration || document.visibilityState === "hidden") return;
              const frameAt = Date.now();
              const broadcastToFrameMs = Math.max(0, frameAt - sentAt);
              const receiveToApplyMs = Math.max(0, appliedAt - receivedAt);
              const commandAt = typeof p._command_ts === "number" &&
                Number.isFinite(p._command_ts) && p._command_ts <= sentAt &&
                p._command_ts >= sentAt - 30_000
                ? p._command_ts
                : null;
              const commandToFrameMs = commandAt === null ? null : Math.max(0, frameAt - commandAt);
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
                  receive_to_apply_ms: receiveToApplyMs,
                  broadcast_to_frame_ms: broadcastToFrameMs,
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
    const sp = (p.slide_progress as number) ?? 0;
    slideProgress.value = sp;
    // Mantém consistência caso uma janela receba slide_progress antes do slide_change.
    const idx = p.slide_index as number | undefined;
    if (typeof idx === "number") slideIndex.value = idx;
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
