import { computed, type Ref } from "vue";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import type { Playable } from "../program/playable";
import { useFileLibrary } from "./useFileLibrary";

/**
 * O que a biblioteca marca como "no ar": o arquivo da fila de Anterior/Próximo
 * que está na tela (borda de destaque e ✕ na grade) e o trecho da Bíblia que o
 * módulo pôs no ar — da biblioteca ou de um item do programa.
 */
export function useLibraryLiveMarks(opts: {
  liveOrigin: Ref<Playable | null>;
  liveProgramItem: Ref<ProgramItem | null>;
}) {
  const library = useFileLibrary();

  const libraryLivePath = computed(() => {
    const q = library.queue.value;
    const origin = opts.liveOrigin.value;
    const fromQueue = origin?.type === "file" || origin?.type === "folderFile";
    return q && fromQueue && q.entries[q.index]?.path === origin.entry.path
      ? q.entries[q.index].path
      : null;
  });

  const liveBibleRef = computed<ProgramBibleRef | null>(() => {
    const origin = opts.liveOrigin.value;
    if (origin?.type === "bible") return origin.ref;
    return opts.liveProgramItem.value?.bible ?? null;
  });

  return { libraryLivePath, liveBibleRef };
}
