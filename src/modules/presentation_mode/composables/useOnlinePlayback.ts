import { computed } from "vue";
import Telemetry from "@/helpers/Telemetry";
import { videoIdFromUrl, youtubeEmbedUrl } from "@/helpers/OnlineVideo";
import Media from "@/composables/useMedia";
import type { ProgramItem } from "@/types/Presentation";
import type { Playable } from "../program/playable";
import { useOnlineLibrary, type OnlineEntry } from "./useOnlineLibrary";
import { queueCounter, type NavigableSource } from "./useLiveNavigation";

/**
 * Vídeos do YouTube no palco: como um vídeo da aba vira um Playable, como ele
 * vai ao ar e a fila da lista de onde ele saiu.
 */

export function onlinePlayable(video: OnlineEntry): Playable {
  return { type: "online", videoId: video.id, title: video.title, channel: video.channel };
}

/** O vídeo vai ao ar pelo mesmo caminho dos outros módulos: baixado, transmitido ou embutido. */
export function openOnline(videoId: string, title: string): void {
  void Media.openYouTube(youtubeEmbedUrl(videoId), title).catch((error: unknown) => {
    Telemetry.captureException(error, { source: "presentation_mode.online.open" });
  });
}

export function itemVideoId(item: ProgramItem | null | undefined): string | null {
  return item?.kind === "online_video" ? videoIdFromUrl(item.source?.url) : null;
}

/**
 * A fila da playlist ou do canal de onde saiu o vídeo enviado ao ar: o
 * Anterior/Próximo anda por ela, e o vídeo seguinte fica preparado.
 */
export function useOnlineQueue(deps: { sent: () => Playable | null; onSent: (playable: Playable) => void }) {
  const lib = useOnlineLibrary();

  const live = () => {
    const q = lib.queue.value;
    const sent = deps.sent();
    return !!q && sent?.type === "online" && q.entries[q.index]?.id === sent.videoId;
  };

  const nextId = computed(() => {
    const q = lib.queue.value;
    return live() && q ? (q.entries[q.index + 1]?.id ?? null) : null;
  });

  const source: NavigableSource = {
    active: live,
    canStep: () => (lib.queue.value?.entries.length ?? 0) > 1,
    counter: () => queueCounter(lib.queue.value),
    step(to) {
      // Sem `dispatch`: ele recomeçaria a fila pela lista aberta agora.
      const video = lib.stepQueue(to);
      if (!video) return false;
      openOnline(video.id, video.title);
      deps.onSent(onlinePlayable(video));
      return true;
    },
  };

  return { source, nextId, start: lib.startQueue };
}
