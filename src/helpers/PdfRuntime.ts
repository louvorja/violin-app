import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfRuntime = typeof import("pdfjs-dist");
type PdfSource = Parameters<PdfRuntime["getDocument"]>[0];

let runtimePromise: Promise<PdfRuntime> | null = null;

/**
 * Carrega PDF.js e o worker somente quando uma projeção realmente recebe um
 * PDF. Imagens, vídeos e slides deixam de pagar parse/compilação desse runtime
 * grande ao abrir a janela auxiliar.
 */
export function loadPdfRuntime(): Promise<PdfRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
  }
  return runtimePromise;
}

export async function loadPdfDocument(
  source: PdfSource
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfRuntime();
  return pdfjs.getDocument(source).promise;
}

export type { PDFDocumentProxy };
