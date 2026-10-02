import { computed, type Ref } from "vue";
import Telemetry from "@/helpers/Telemetry";
import Media from "@/composables/useMedia";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import { childIndex, stepChild } from "../program/moment";
import { bibleRefOf, stepVerse, type BibleChapter } from "../program/bible";
import type { Playable } from "../program/playable";
import type { LibraryEntry } from "./useFileLibrary";

export type Step = "first" | "prev" | "next" | "last";

/**
 * Algo no ar que tem partes para percorrer: os slides da música, a pasta de
 * onde saiu o arquivo, a lista de onde saiu o vídeo, o capítulo do versículo.
 * Anterior/Próximo andam pela primeira fonte ativa.
 */
export interface NavigableSource {
  active: () => boolean;
  /** Há para onde andar. */
  canStep: () => boolean;
  /** Posição para o retorno de palco: "3/12". */
  counter?: () => string | undefined;
  /** Anda uma parte; false quando não há para onde ir. */
  step: (to: Step) => boolean | Promise<boolean>;
}

/**
 * Os passos vão em fila: o segundo toque parte de onde o primeiro deixou,
 * mesmo que o conteúdo novo ainda não tenha voltado do ar. Na última parte —
 * ou sem partes — o Próximo não pula de item: chama `onEnd` (destaca "A seguir").
 */
export function useLiveNavigation(sources: NavigableSource[], locked: Ref<boolean>, onEnd: () => void) {
  const current = computed(() => sources.find((s) => s.active()) ?? null);
  const canNavigate = computed(() => !locked.value && !!current.value?.canStep());
  const counter = computed(() => current.value?.counter?.());

  let queue: Promise<void> = Promise.resolve();
  function navigate(to: Step): void {
    if (locked.value) return;
    queue = queue
      .then(async () => {
        const source = sources.find((s) => s.active());
        const moved = source?.canStep() ? await source.step(to) : false;
        if (!moved && to === "next") onEnd();
      })
      .catch((error: unknown) => {
        Telemetry.captureException(error, { source: "presentation_mode.navigate" });
      });
  }

  return { canNavigate, counter, navigate };
}

export function queueCounter(q: { index: number; entries: unknown[] } | null): string | undefined {
  return q ? `${q.index + 1}/${q.entries.length}` : undefined;
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
    return !!q && sent?.type === "file" && q.entries[q.index]?.path === sent.entry.path;
  };
  return {
    active: live,
    canStep: () => (deps.queue()?.entries.length ?? 0) > 1,
    counter: () => queueCounter(deps.queue()),
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
  send: (itemId: string, childId: string) => void;
}): NavigableSource {
  const current = () => {
    const sent = deps.sent();
    const item = sent ? deps.item(sent.itemId) : null;
    return sent && item ? { item, childId: sent.childId } : null;
  };
  return {
    active: () => !!current(),
    canStep: () => (current()?.item.children?.length ?? 0) > 1,
    counter: () => {
      const c = current();
      const i = c ? childIndex(c.item, c.childId) : -1;
      return c && i >= 0 ? `${i + 1}/${c.item.children?.length ?? 0}` : undefined;
    },
    step(to) {
      const c = current();
      const next = c ? stepChild(c.item, c.childId, to) : null;
      if (c && next) deps.send(c.item.id, next.id);
      return !!next;
    },
  };
}
