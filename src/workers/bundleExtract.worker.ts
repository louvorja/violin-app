import { unzipSync, type UnzipFileInfo } from "fflate";

import { validateBundleManifest, isBibleFile } from "@/helpers/BundleManifest";
import { sha256Hex } from "@/helpers/Sha256";
import { BUNDLE_MANIFEST_FILE, type BundleKind } from "@/types/Bundle";

interface ExtractRequest {
  type: "extract";
  kind: BundleKind;
  buffer: ArrayBuffer;
}

/** Um lote limita as idas e voltas com a janela sem acumular a Bíblia inteira nela. */
const BATCH_MAX_FILES = 256;
const BATCH_MAX_BYTES = 1024 * 1024;

interface BundleExtractWorkerScope {
  onmessage: ((_event: MessageEvent<ExtractRequest | { type: "continue" }>) => void) | null;
  postMessage(_message: unknown): void;
}

/** Installs the worker protocol on its scope; exported for exercising the real worker logic. */
export function installBundleExtractWorker(scope: BundleExtractWorkerScope): void {
  let resume: (() => void) | null = null;

  function waitForContinue(): Promise<void> {
    return new Promise((resolve) => {
      resume = resolve;
    });
  }

  async function extract({ kind, buffer }: ExtractRequest): Promise<void> {
    const zip = new Uint8Array(buffer);
    // A primeira passada só lê o diretório e o manifesto: nada mais é descompactado antes de validar.
    const listed: UnzipFileInfo[] = [];
    const descriptor = unzipSync(zip, {
      filter: (file) => {
        listed.push(file);
        return file.name === BUNDLE_MANIFEST_FILE;
      },
    })[BUNDLE_MANIFEST_FILE];
    if (!descriptor) throw new Error("Bundle inválido: manifesto ausente");
    const isEntry = (name: string) => !name.endsWith("/") && name !== BUNDLE_MANIFEST_FILE;
    // Os nomes chegam crus do ZIP: um ../ ou subpasta não bate com os nomes que o manifesto aceita.
    const entries = listed.map((file) => file.name).filter(isEntry);
    const manifest = validateBundleManifest(
      JSON.parse(new TextDecoder().decode(descriptor)),
      kind,
      entries
    );
    const hashes = new Map(manifest.files.map((file) => [file.name, file]));
    // O fflate não passa do tamanho declarado; conferido aqui, ele limita a memória da segunda passada.
    for (const file of listed) {
      if (isEntry(file.name) && file.originalSize !== hashes.get(file.name)!.bytes)
        throw new Error(`Bundle inválido: integridade de ${file.name}`);
    }
    // Sem CRC: cada arquivo confere tamanho e SHA-256 do manifesto logo abaixo.
    const files = unzipSync(zip, { filter: (file) => isEntry(file.name) });
    let batch: Array<{ key: string; data: unknown; current: number }> = [];
    let batchBytes = 0;
    const flush = async () => {
      scope.postMessage({ type: "entries", entries: batch, total: entries.length });
      batch = [];
      batchBytes = 0;
      await waitForContinue();
    };
    for (let index = 0; index < entries.length; index++) {
      const path = entries[index];
      const key = path.replace(/\.json$/, "");
      const bytes = files[path];
      // Solta os bytes à medida que os lotes saem, em vez de segurar o pacote inteiro até o fim.
      delete files[path];
      const file = hashes.get(path)!;
      const sha256 = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);
      if (bytes.byteLength !== file.bytes || sha256 !== file.sha256)
        throw new Error(`Bundle inválido: integridade de ${path}`);
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        isBibleFile(path) &&
        (!data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          !Object.keys(data).length ||
          Object.entries(data).some(
            ([verse, text]) => !/^[1-9]\d*$/.test(verse) || typeof text !== "string"
          ))
      ) {
        throw new Error(`Bundle inválido: capítulo ${path}`);
      }
      batch.push({ key, data, current: index + 1 });
      batchBytes += bytes.byteLength;
      if (batch.length >= BATCH_MAX_FILES || batchBytes >= BATCH_MAX_BYTES) await flush();
    }
    if (batch.length) await flush();
    scope.postMessage({ type: "done" });
  }

  scope.onmessage = (event) => {
    if (event.data.type === "continue") {
      const next = resume;
      resume = null;
      next?.();
      return;
    }
    void extract(event.data).catch((error) => {
      scope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };
}

if (typeof document === "undefined") {
  installBundleExtractWorker(self);
}
