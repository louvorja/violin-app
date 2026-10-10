import type { Ref } from "vue";
import { useSlides } from "@/composables/useSlides";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import { expectationOf, filePathOf, type Playable } from "../program/playable";
import { useBibleLibrary } from "./useBibleLibrary";
import { useFileLibrary } from "./useFileLibrary";
import type { LiveKind } from "./useLiveContent";
import {
  bibleSource,
  fileQueueSource,
  momentSource,
  slidesSource,
  useLiveNavigation,
} from "./useLiveNavigation";
import { useOnlineQueue } from "./useOnlinePlayback";
import { isDeck, usePdfDeck } from "./usePdfDeck";
import { useStage } from "./useStage";
import { claimScreen } from "./useLayers";
import { kindFromPath } from "../program/liturgy";

/**
 * Anterior/Próximo do palco (botões, teclado e passador): junta as fontes que
 * sabem andar — página do PDF, arquivo do momento, versículo, vídeo da lista,
 * arquivo da pasta, slide da música — e tenta na ordem a que estiver no ar.
 */
export function useStageNavigation(deps: {
  liveKind: Ref<LiveKind | null>;
  findItem: (itemId: string) => ProgramItem | null;
  dispatch: (playable: Playable) => void;
  projectPath: (path: string, name: string) => void;
  outputLocked: Ref<boolean>;
  /** Não há mais o que andar: o "A seguir" pisca. */
  onEnd: () => void;
}) {
  const stage = useStage();
  const library = useFileLibrary();
  const slides = useSlides();
  const bibleLibrary = useBibleLibrary();
  const { liveKind, findItem, dispatch } = deps;

  /** O que o módulo enviou, enquanto ainda há algo no ar — a navegação parte daqui, não do eco da tela. */
  function sentWhile(kinds: LiveKind[]): Playable | null {
    const kind = liveKind.value;
    return kind && kinds.includes(kind) ? (stage.sent.value?.playable ?? null) : null;
  }

  function sentBible(): ProgramBibleRef | null {
    const sent = sentWhile(["bible"]);
    if (sent?.type === "bible") return sent.ref;
    return sent?.type === "program" ? (findItem(sent.itemId)?.bible ?? null) : null;
  }

  /** Manda ao ar sem passar pelo `dispatch`, que recomeçaria a fila pela lista aberta agora. */
  function markSent(playable: Playable): void {
    stage.markSent(playable, expectationOf(playable, null));
  }

  const onlineQueue = useOnlineQueue({
    sent: () => sentWhile(["file", "online_video"]),
    onSent: markSent,
  });

  const pdfDeck = usePdfDeck();

  const navigation = useLiveNavigation(
    [
      // O PDF no ar vira página — mesmo dentro de um momento, antes de passar ao arquivo seguinte.
      pdfDeck.source,
      momentSource({
        sent: () => {
          const sent = sentWhile(["file", "announcements"]);
          return sent?.type === "child" ? sent : null;
        },
        item: (itemId) => findItem(itemId),
        send: (itemId, childId, to) => {
          // Voltando para um PDF, ele abre no último slide, de onde o operador saiu.
          if (
            to === "prev" &&
            isDeck(filePathOf({ type: "child", itemId, childId }, findItem(itemId)))
          )
            pdfDeck.openNextAtEnd();
          dispatch({ type: "child", itemId, childId });
        },
      }),
      bibleSource({
        sent: sentBible,
        chapterOf: (ref) => bibleLibrary.chapterOf(ref),
        send: (ref) => dispatch({ type: "bible", ref }),
      }),
      onlineQueue.source,
      fileQueueSource({
        queue: () => library.queue.value,
        sent: () => sentWhile(["file"]),
        step: (to) => library.stepQueue(to),
        send: (entry) => {
          claimScreen(kindFromPath(entry.path) === "video" ? "video" : "other");
        deps.projectPath(entry.path, entry.name);
          // Na pasta do programa, o item continua sendo o que está no ar.
          const sent = stage.sent.value?.playable;
          markSent(sent?.type === "folderFile" ? { ...sent, entry } : { type: "file", entry });
        },
      }),
      slidesSource({
        isMusic: () => liveKind.value === "music",
        total: () => slides.totalSlides.value,
        index: () => slides.slideIndex.value,
      }),
    ],
    deps.outputLocked,
    deps.onEnd
  );
  const { canNavigate, navigate } = navigation;
  return { canNavigate, navigate, onlineQueue, pdfDeck };
}
