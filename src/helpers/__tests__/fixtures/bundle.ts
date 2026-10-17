import JSZip from "jszip";
import { createHash, webcrypto } from "node:crypto";
import { vi } from "vitest";
import type { BundleKind } from "@/types/Bundle";
import { installBundleExtractWorker } from "@/workers/bundleExtract.worker";

export function catalogFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const lang of ["pt", "es"]) {
    for (const table of ["musics", "categories", "hymnal", "bible_version", "bible_book"])
      files[`${lang}_${table}.json`] = [];
  }
  return files;
}
export async function zipWithManifest(
  files: Record<string, unknown>,
  kind: BundleKind
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const entries = Object.entries(files).map(([name, value]) => {
    const body = JSON.stringify(value);
    zip.file(name, body);
    return {
      name,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  });
  zip.file("_bundle_manifest.json", JSON.stringify({ schema_version: 1, kind, files: entries }));
  return zip.generateAsync({ type: "arraybuffer" });
}
export class TestBundleWorker {
  static latest: TestBundleWorker | null = null;
  onmessage: ((_event: MessageEvent) => void) | null = null;
  onerror: ((_event: ErrorEvent) => void) | null = null;
  readonly posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;
  private scope: {
    onmessage: ((_event: MessageEvent) => void) | null;
    postMessage: (_message: unknown) => void;
  };
  constructor() {
    TestBundleWorker.latest = this;
    this.scope = {
      onmessage: null,
      postMessage: (message) => {
        if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent);
      },
    };
    installBundleExtractWorker(this.scope);
  }
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
    this.scope.onmessage?.({ data: message } as MessageEvent);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}
export function useTestBundleWorker(): void {
  vi.stubGlobal("Worker", TestBundleWorker);
  vi.stubGlobal("crypto", webcrypto);
}
