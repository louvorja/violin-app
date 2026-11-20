import { onBeforeUnmount, onMounted, type Ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

/**
 * A tela conta o que o vídeo dela está fazendo de verdade: tocando ou parado,
 * e em que ponto. Quem opera compara com o player — a miniatura nunca pode
 * mostrar "pausado" com a tela real ainda rodando.
 */

export type ScreenRole = "main" | "return";

export interface ScreenVideoReport {
  screen: ScreenRole;
  playback_id: string | null;
  isPaused: boolean;
  currentTime: number;
  sentAt: number;
}

const REPORT_MS = 1000;

export function useScreenVideoReport(
  screen: ScreenRole,
  video: Ref<HTMLVideoElement | null>,
  playbackId: () => string | null,
  active: () => boolean
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    timer = setInterval(() => {
      const el = video.value;
      if (!el || !active()) return;
      Broadcast.send(BROADCAST_TYPE.SCREEN_VIDEO_REPORT, {
        screen,
        playback_id: playbackId(),
        isPaused: el.paused,
        currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
        sentAt: Date.now(),
      } satisfies ScreenVideoReport);
    }, REPORT_MS);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });
}
