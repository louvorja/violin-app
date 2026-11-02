import { computed, type Ref } from "vue";
import Telemetry from "@/helpers/Telemetry";
import Media from "@/composables/useMedia";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import { childIndex, stepChild } from "../program/moment";
import { bibleRefOf, stepVerse, type BibleChapter } from "../program/bible";
import type { Playable } from "../program/playable";
import type { LibraryEntry } from "./useFileLibrary";

export type Step = "first" | "prev" | "next" | "last";

/** O que é cada parte: o texto da posição na barra ("Slide 4 / 12"). */
export type PartUnit = "slide" | "page" | "file" | "video";

/** Onde o que está no ar está, entre as partes dele (índice a partir de 0). */
export interface PartPosition {
  unit: PartUnit;
  index: number;
  total: number;
}

/**
 * Algo no ar que tem partes para percorrer: os slides da música, a pasta de
 * onde saiu o arquivo, a lista de onde saiu o vídeo, o capítulo do versículo.
 * Anterior/Próximo andam pela primeira fonte ativa.
 */
export interface NavigableSource {
  active: () => boolean;
  /** Há para onde andar. */
  canStep: () => boolean;
  /** Em qual parte está, para a barra de controle. */
  position?: () => PartPosition | undefined;
  /** Anda uma parte; false quando não há para onde ir. */
  step: (to: Step) => boolean | Promise<boolean>;
}

/**
 * Os passos vão em fila: o segundo toque parte de onde o primeiro deixou,
 * mesmo que o conteúdo novo ainda não tenha voltado do ar.
 *
 * As fontes ativas são tentadas em ordem: o PDF de um momento vira a página e,
 * na última, o momento passa ao arquivo seguinte. Quando nenhuma anda, o
 * Próximo não pula de item: chama `onEnd` (destaca "A seguir").
 */
export function useLiveNavigation(
  sources: NavigableSource[],
  locked: Ref<boolean>,
  onEnd: () => void
) {
  const activeSources = () => sources.filter((s) => s.active());
  const canNavigate = computed(() => !locked.value && activeSources().some((s) => s.canStep()));
  /** A posição da primeira fonte que sabe dizer — o PDF de um momento conta páginas, não arquivos. */
  const position = computed<PartPosition | null>(() => {
    for (const source of activeSources()) {
      const p = source.position?.();
      if (p) return p;
    }
    return null;
  });

  let queue: Promise<void> = Promise.resolve();
  function navigate(to: Step): void {
    if (locked.value) return;
    queue = queue
      .then(async () => {
        for (const source of activeSources()) {
          if (source.canStep() && (await source.step(to))) return;
        }
        if (to === "next") onEnd();
      })
      .catch((error: unknown) => {
        Telemetry.captureException(error, { source: "presentation_mode.navigate" });
      });
  }

  return { canNavigate, position, navigate };
}

export function queuePosition(
  q: { index: number; entries: unknown[] } | null,
  unit: PartUnit
): PartPosition | undefined {
  return q ? { unit, index: q.index, total: q.entries.length } : undefined;
}

/** Os slides da música no ar — de onde ela tiver vindo. */
export function slidesSource(deps: {
  isMusic: () => boolean;
  total: () => number;
  index: () => number;
}): NavigableSource {
  return {
    active: () => deps.isMusic() && deps.total() > 0,
    canStep: () => true,
    position: () => ({ unit: "slide", index: deps.index(), total: deps.total() }),
    step(to) {
      if (to === "next" && deps.index() >= deps.total() - 1) return false;
      if (to === "first") Media.firstSlide();
      else if (to === "prev") Media.prevSlide();
      else if (to === "next") Media.nextSlide();
      else Media.lastSlide();
      return true;
    },
  };
}

/** A pasta da biblioteca de onde saiu o arquivo enviado ao ar. */
export function fileQueueSource(deps: {
  queue: () => { entries: LibraryEntry[]; index: number } | null;
  sent: () => Playable | null;
  step: (to: Step) => LibraryEntry | null;
  /** Manda o arquivo ao ar sem recomeçar a fila (o `dispatch` recomeçaria pela pasta aberta agora). */
  send: (entry: LibraryEntry) => void;
}): NavigableSource {
  const live = () => {
    const q = deps.queue();
    const sent = deps.sent();
    const fromQueue = sent?.type === "file" || sent?.type === "folderFile";
    return !!q && fromQueue && q.entries[q.index]?.path === sent.entry.path;
  };
  return {
    active: live,
    canStep: () => (deps.queue()?.entries.length ?? 0) > 1,
    position: () => queuePosition(deps.queue(), "file"),
    step(to) {
      const entry = deps.step(to);
      if (entry) deps.send(entry);
      return !!entry;
    },
  };
}

/** O capítulo do versículo enviado ao ar — da biblioteca ou de um item do programa. */
export function bibleSource(deps: {
  sent: () => ProgramBibleRef | null;
  chapterOf: (ref: ProgramBibleRef) => Promise<BibleChapter | null>;
  send: (ref: ProgramBibleRef) => void;
}): NavigableSource {
  return {
    active: () => !!deps.sent(),
    canStep: () => !!deps.sent()?.version_id,
    async step(to) {
      const ref = deps.sent();
      const chapter = ref ? await deps.chapterOf(ref) : null;
      const verse = ref && chapter ? stepVerse(chapter, ref.verses, to) : null;
      if (!chapter || verse === null) return false;
      deps.send(bibleRefOf(chapter, [verse]));
      return true;
    },
  };
}

/** O momento do programa de onde saiu o arquivo (ou anúncio) no ar: anda entre os filhos dele. */
export function momentSource(deps: {
  sent: () => { itemId: string; childId: string } | null;
  item: (itemId: string) => ProgramItem | null;
  send: (itemId: string, childId: string, to: Step) => void;
}): NavigableSource {
  const current = () => {
    const sent = deps.sent();
    const item = sent ? deps.item(sent.itemId) : null;
    return sent && item ? { item, childId: sent.childId } : null;
  };
  return {
    active: () => !!current(),
    canStep: () => (current()?.item.children?.length ?? 0) > 1,
    position: () => {
      const c = current();
      const i = c ? childIndex(c.item, c.childId) : -1;
      return c && i >= 0
        ? { unit: "file", index: i, total: c.item.children?.length ?? 0 }
        : undefined;
    },
    step(to) {
      const c = current();
      const next = c ? stepChild(c.item, c.childId, to) : null;
      if (c && next) deps.send(c.item.id, next.id, to);
      return !!next;
    },
  };
}
