import { computed } from "vue";
import $snackbar from "@/helpers/Snackbar";
import type { ProgramItem } from "@/types/Presentation";
import { newId, useProgram } from "./useProgram";
import { acceptsInMoment, withFiles } from "../program/moment";

/**
 * Os momentos do programa como destino de arquivos: a biblioteca (menu e,
 * depois, o arrastar) acrescenta fotos, vídeos e PDFs à lista de um deles.
 */
export function useMoments(tm: (key: string, named?: Record<string, unknown>) => string) {
  const { program, updateItem } = useProgram();

  const moments = computed(() =>
    program.value.sessions.flatMap((s) => s.items).filter((i) => i.kind === "moment")
  );

  function addTo(item: ProgramItem, paths: string[]): void {
    const children = withFiles(item, paths, newId);
    if (children.length === (item.children?.length ?? 0)) return;
    updateItem(item.id, { children });
    $snackbar.success(tm("moment.added", { name: item.title }));
  }

  /** Um momento novo já com estes arquivos; o título é o do primeiro. */
  function newMoment(paths: string[], title: string): ProgramItem {
    const base: ProgramItem = { id: newId(), kind: "moment", title, plannedMinutes: 5, children: [] };
    return { ...base, children: withFiles(base, paths, newId) };
  }

  return { moments, addTo, newMoment, accepts: acceptsInMoment };
}
