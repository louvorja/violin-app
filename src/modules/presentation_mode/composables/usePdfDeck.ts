import { computed, reactive, ref, shallowRef, watch } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { fileProjectionPageFor } from "@/helpers/FileProjectionPage";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import Telemetry from "@/helpers/Telemetry";
import { useLiveContent } from "./useLiveContent";
import { isPowerPoint, POWERPOINT_ENABLED } from "./usePowerPoint";
import type { NavigableSource } from "./useLiveNavigation";
import { usePptxNative } from "./usePptxNative";

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
/** O próximo PDF a abrir começa nesta página (o mesmo PowerPoint, gerado de novo). */
let startAtPage = 0;
let loadSeq = 0;

function install(): void {
  if (installed) return;
  installed = true;
  const live = useLiveContent();

  watch(
    () =>
      live.current.value === "file" && live.file.value?.type === "pdf" ? live.file.value.url : null,
    async (next) => {
      if (next === url.value) return;
      const seq = ++loadSeq;
      const atEnd = startAtEnd;
      const atPage = startAtPage;
      startAtEnd = false;
      startAtPage = 0;
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
        if (atEnd) moveTo(loaded.numPages);
        else if (atPage > 1) moveTo(Math.min(atPage, loaded.numPages));
      } catch (e) {
        Telemetry.captureException(e, { source: "presentation_mode.pdf_deck" });
      }
    },
    { immediate: true }
  );

  /*
   * PowerPoint com animações por cima do PA: a página do PDF segue o slide em
   * que ele está (retorno e grade certos). Trocou o que está no ar, ele sai.
   */
  const native = usePptxNative();
  watch(
    () => (native.active.value ? (native.state.value.index ?? 0) + 1 : null),
    (n) => {
      if (n) moveTo(n);
    }
  );
  watch(url, (next, prev) => {
    if (prev && next !== prev && native.active.value) void native.end();
  });

  // A janela de projeção confirma a página (e corrige se o pedido passou do fim).
  Broadcast.listen((msg) => {
    if (msg.type !== BROADCAST_TYPE.FILE_PROJECTION_PAGE) return;
    const data = fileProjectionPageFor(msg.payload, live.file.value?.playback_id);
    if (data?.source === "projection") page.value = data.page;
  });
}

/** Clique na grade: com o PowerPoint apresentando, quem vai ao slide é ele. */
function goTo(target: number): boolean {
  const native = usePptxNative();
  if (native.active.value) {
    if (target >= 1 && target <= total.value) void native.goto(target - 1);
    return true;
  }
  return moveTo(target);
}

function moveTo(target: number): boolean {
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
    position: () =>
      active.value ? { unit: "page", index: page.value - 1, total: total.value } : undefined,
    step(to) {
      // PowerPoint apresentando: o passador anda nos efeitos dele (cada animação é um passo).
      const native = usePptxNative();
      if (native.active.value) {
        if (to === "next") void native.next();
        else if (to === "prev") void native.prev();
        else void native.goto(to === "first" ? 0 : Math.max(0, total.value - 1));
        return true;
      }
      const target =
        to === "first"
          ? 1
          : to === "last"
            ? total.value
            : to === "next"
              ? page.value + 1
              : page.value - 1;
      return moveTo(target);
    },
  };

  return {
    active,
    page,
    total,
    thumbs,
    thumbOf,
    goTo,
    source,
    openNextAtEnd: () => (startAtEnd = true),
    openNextAtPage: (n: number) => (startAtPage = n),
  };
}
