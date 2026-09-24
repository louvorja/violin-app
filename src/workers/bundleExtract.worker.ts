import JSZip from "jszip";

type BundleKind = "catalog" | "bible";

interface ExtractRequest {
  type: "extract";
  kind: BundleKind;
  buffer: ArrayBuffer;
}

function catalogKey(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts.at(-1) || "";
  if (!fileName.endsWith(".json")) return "";
  const base = fileName.replace(/\.json$/, "");
  const langIndex = parts.indexOf("lang");
  return langIndex >= 0 && parts[langIndex + 1] ? `${parts[langIndex + 1]}_${base}` : base;
}

function isBibleEntry(filePath: string): boolean {
  return /^bible_\d+_\d+_\d+\.json$/.test(filePath.split("/").at(-1) || "");
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
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).filter((path) => {
      if (zip.files[path].dir) return false;
      return kind === "bible"
        ? isBibleEntry(path)
        : path.endsWith(".json") && !path.endsWith("_manifest.json");
    });
    const seen = new Set<string>();

    for (let index = 0; index < entries.length; index++) {
      const path = entries[index];
      const key =
        kind === "bible"
          ? path
              .split("/")
              .at(-1)!
              .replace(/\.json$/, "")
          : catalogKey(path);
      if (!key) continue;
      if (seen.has(key)) throw new Error(`Bundle inválido: chave duplicada ${key}`);
      seen.add(key);
      const raw = await zip.files[path].async("text");
      const data = JSON.parse(raw) as unknown;
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
