/**
 * Bridge para a extração de bundles ZIP fora do renderer.
 *
 * O worker devolve um item e espera o "continue" antes de avançar. Isso é
 * importante para a Bíblia: ela grava um capítulo por vez e não acumula os
 * ~15 mil JSONs na memória da janela que abriu a tela bíblica.
 */
export type BundleExtractionKind = "catalog" | "bible";

export interface ExtractedBundleEntry {
  key: string;
  data: unknown;
  current: number;
  total: number;
}

interface WorkerMessage {
  type: "entry" | "done" | "error";
  key?: unknown;
  data?: unknown;
  current?: unknown;
  total?: unknown;
  message?: unknown;
}

export interface ExtractBundleOptions {
  kind: BundleExtractionKind;
  signal?: AbortSignal;
  onEntry: (entry: ExtractedBundleEntry) => void | Promise<void>;
}

function aborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function workerError(message: unknown): Error {
  return new Error(typeof message === "string" && message ? message : "Falha ao extrair bundle");
}

/**
 * Descompacta e interpreta JSON num Worker module. O ArrayBuffer é transferido
 * (não copiado) e o worker é terminado em toda saída, inclusive cancelamento.
 */
export function extractBundleEntries(
  buffer: ArrayBuffer,
  { kind, signal, onEntry }: ExtractBundleOptions
): Promise<void> {
  aborted(signal);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/bundleExtract.worker.ts", import.meta.url), {
      type: "module",
    });
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(signal?.reason ?? new DOMException("Abortado", "AbortError"));

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(workerError(event.message));
    };
    worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") {
        finish(workerError("Resposta inválida do extrator de bundle"));
        return;
      }
      if (message.type === "error") {
        finish(workerError(message.message));
        return;
      }
      if (message.type === "done") {
        finish();
        return;
      }
      const current = message.current;
      const total = message.total;
      if (
        message.type !== "entry" ||
        typeof message.key !== "string" ||
        typeof current !== "number" ||
        typeof total !== "number" ||
        !Number.isInteger(current) ||
        !Number.isInteger(total)
      ) {
        finish(workerError("Entrada inválida do extrator de bundle"));
        return;
      }
      try {
        aborted(signal);
        await onEntry({
          key: message.key,
          data: message.data,
          current,
          total,
        });
        aborted(signal);
        worker.postMessage({ type: "continue" });
      } catch (error) {
        finish(error);
      }
    };

    try {
      worker.postMessage({ type: "extract", kind, buffer }, [buffer]);
    } catch (error) {
      finish(error);
    }
  });
}
