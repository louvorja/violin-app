import JSZip from "jszip";

import { validateBundleManifest, isBibleFile } from "@/helpers/BundleManifest";
import { BUNDLE_MANIFEST_FILE, type BundleKind } from "@/types/Bundle";

interface ExtractRequest {
  type: "extract";
  kind: BundleKind;
  buffer: ArrayBuffer;
}

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
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const descriptor = zip.file(BUNDLE_MANIFEST_FILE);
    if (!descriptor) throw new Error("Bundle inválido: manifesto ausente");
    const entries = Object.keys(zip.files).filter(
      (path) => !zip.files[path].dir && path !== BUNDLE_MANIFEST_FILE
    );
    // Reject sanitized paths too; JSZip otherwise hides ../ paths from consumers.
    for (const path of entries) {
      const original = (zip.files[path] as { unsafeOriginalName?: string }).unsafeOriginalName;
      if (original && original !== path) throw new Error("Bundle inválido: caminho inseguro");
    }
    const manifest = validateBundleManifest(
      JSON.parse(await descriptor.async("text")),
      kind,
      entries
    );
    const hashes = new Map(manifest.files.map((file) => [file.name, file]));
    for (let index = 0; index < entries.length; index++) {
      const path = entries[index];
      const key = path.replace(/\.json$/, "");
      const bytes = await zip.files[path].async("uint8array");
      const file = hashes.get(path)!;
      const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
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
      scope.postMessage({ type: "entry", key, data, current: index + 1, total: entries.length });
      await waitForContinue();
    }
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
