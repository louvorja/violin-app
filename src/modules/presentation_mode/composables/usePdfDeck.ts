import { computed, reactive, ref, shallowRef, watch } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { fileProjectionPageFor } from "@/helpers/FileProjectionPage";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import Telemetry from "@/helpers/Telemetry";
import { useLiveContent } from "./useLiveContent";
import { isPowerPoint, POWERPOINT_ENABLED } from "./usePowerPoint";
import type { NavigableSource } from "./useLiveNavigation";

/**
 * O PDF no ar (slides do pregador, também os PowerPoint convertidos): a página
 * atual, o total e as miniaturas das páginas no palco. O módulo abre o PDF por
 * conta própria — a janela de projeção só confirma a página quando está
 * aberta, e o operador precisa ver os slides antes disso.
 */

const THUMB_WIDTH = 320;

/** Arquivo que vira páginas no palco: PDF ou PowerPoint (convertido em PDF). */
export function isDeck(path: string | null): boolean {
  if (!path) return false;
  return /\.pdf$/i.test(path) || (POWERPOINT_ENABLED && isPowerPoint(path));
}

const doc = shallowRef<PDFDocumentProxy | null>(null);
const url = ref<string | null>(null);
const page = ref(1);
const total = ref(0);
/** Página → imagem da miniatura (data URL), desenhada sob demanda. */
const thumbs = reactive(new Map<number, string>());
let installed = false;
/** O próximo PDF a abrir começa no fim (o operador voltou para ele). */
let startAtEnd = false;
let loadSeq = 0;

function install(): void {
  if (installed) return;
  installed = true;
  const live = useLiveContent();

  watch(
    () => (live.current.value === "file" && live.file.value?.type === "pdf" ? live.file.value.url : null),
    async (next) => {
      if (next === url.value) return;
      const seq = ++loadSeq;
      const atEnd = startAtEnd;
      startAtEnd = false;
      url.value = next;
      page.value = 1;
      total.value = 0;
      thumbs.clear();
      void doc.value?.cleanup();
      doc.value = null;
      if (!next) return;
      try {
        const loaded = await loadPdfDocument({ url: next });
        if (seq !== loadSeq) return void loaded.cleanup();
        doc.value = loaded;
        total.value = loaded.numPages;
        if (atEnd) goTo(loaded.numPages);
      } catch (e) {
        Telemetry.captureException(e, { source: "presentation_mode.pdf_deck" });
      }
    },
    { immediate: true }
  );

  // A janela de projeção confirma a página (e corrige se o pedido passou do fim).
  Broadcast.listen((msg) => {
    if (msg.type !== BROADCAST_TYPE.FILE_PROJECTION_PAGE) return;
    const data = fileProjectionPageFor(msg.payload, live.file.value?.playback_id);
    if (data?.source === "projection") page.value = data.page;
  });
}

function goTo(target: number): boolean {
  const live = useLiveContent();
  const playbackId = live.file.value?.playback_id;
  if (!playbackId || !total.value) return false;
  const clamped = Math.max(1, Math.min(total.value, target));
  if (clamped === page.value) return false;
  page.value = clamped;
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_PAGE, {
    playback_id: playbackId,
    page: clamped,
    totalPages: total.value,
    source: "operator",
  });
  return true;
}

/** Desenha a miniatura de uma página na primeira vez que ela aparece. */
async function thumbOf(n: number): Promise<void> {
  const d = doc.value;
  if (!d || thumbs.has(n)) return;
  thumbs.set(n, "");
  try {
    const p = await d.getPage(n);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await p.render({ canvas, viewport }).promise;
    if (doc.value === d) thumbs.set(n, canvas.toDataURL("image/jpeg", 0.75));
  } catch {
    thumbs.delete(n);
  }
}

export function usePdfDeck() {
  install();
  const active = computed(() => !!url.value && total.value > 0);

  /** Anterior/Próximo e o passador viram a página do PDF no ar. */
  const source: NavigableSource = {
    active: () => active.value,
    canStep: () => total.value > 1,
    counter: () => (active.value ? `${page.value}/${total.value}` : undefined),
    step(to) {
      const target = to === "first" ? 1 : to === "last" ? total.value : to === "next" ? page.value + 1 : page.value - 1;
      return goTo(target);
    },
  };

  return { active, page, total, thumbs, thumbOf, goTo, source, openNextAtEnd: () => (startAtEnd = true) };
}
