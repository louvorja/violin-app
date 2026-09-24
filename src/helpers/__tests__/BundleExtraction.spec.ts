import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { extractBundleEntries } from "@/helpers/BundleExtraction";
import { installBundleExtractWorker } from "@/workers/bundleExtract.worker";

class FakeWorker {
  static latest: FakeWorker | null = null;
  onmessage: ((_event: MessageEvent) => void) | null = null;
  onerror: ((_event: ErrorEvent) => void) | null = null;
  readonly posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;
  private workerScope: {
    onmessage: ((_event: MessageEvent) => void) | null;
    postMessage: (_message: unknown) => void;
  };

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.latest = this;
    this.workerScope = {
      onmessage: null,
      postMessage: (message) => {
        if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent);
      },
    };
    installBundleExtractWorker(this.workerScope);
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
    this.workerScope.onmessage?.({ data: message } as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.latest = null;
});

describe("extractBundleEntries", () => {
  it("extrai ZIP real no worker, reporta progresso e espera cada entrada ser consumida", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const onEntry = vi.fn(
      async (_entry: { key: string; data: unknown; current: number; total: number }) => {}
    );
    const zip = new JSZip();
    zip.file("lang/pt/modules.json", JSON.stringify({ title: "Louvor" }));
    zip.file("music_1.json", JSON.stringify({ id_music: 1 }));
    zip.file("music_manifest.json", JSON.stringify({ files: ["music_1.json"] }));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const extraction = extractBundleEntries(buffer, { kind: "catalog", onEntry });
    const worker = FakeWorker.latest!;

    expect(worker.posted[0].message).toMatchObject({ type: "extract", kind: "catalog", buffer });
    expect(worker.posted[0].transfer).toEqual([buffer]);

    await extraction;
    expect(onEntry.mock.calls.map(([entry]) => entry)).toEqual([
      { key: "pt_modules", data: { title: "Louvor" }, current: 1, total: 2 },
      { key: "music_1", data: { id_music: 1 }, current: 2, total: 2 },
    ]);
    expect(
      worker.posted.filter(({ message }) => (message as { type?: string }).type === "continue")
    ).toHaveLength(2);
    expect(worker.terminated).toBe(true);
  });

  it("cancela uma extração ZIP em andamento depois do primeiro item", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const zip = new JSZip();
    zip.file("bible_1_1_1.json", JSON.stringify({ verse: 1 }));
    zip.file("bible_1_1_2.json", JSON.stringify({ verse: 2 }));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const controller = new AbortController();
    const onEntry = vi.fn(async () => controller.abort(new Error("cancelado")));
    const extraction = extractBundleEntries(buffer, {
      kind: "bible",
      signal: controller.signal,
      onEntry,
    });

    await expect(extraction).rejects.toThrow("cancelado");
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(FakeWorker.latest?.terminated).toBe(true);
  });

  it("termina o worker no cancelamento sem entregar mais entradas", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const extraction = extractBundleEntries(new ArrayBuffer(1), {
      kind: "catalog",
      signal: controller.signal,
      onEntry: vi.fn(),
    });
    const worker = FakeWorker.latest!;

    controller.abort(new Error("cancelado"));
    await expect(extraction).rejects.toThrow("cancelado");
    expect(worker.terminated).toBe(true);
  });

  it("repassa erro de validação/JSON do worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const extraction = extractBundleEntries(new ArrayBuffer(1), {
      kind: "catalog",
      onEntry: vi.fn(),
    });
    FakeWorker.latest!.emit({ type: "error", message: "JSON inválido" });

    await expect(extraction).rejects.toThrow("JSON inválido");
  });
});
