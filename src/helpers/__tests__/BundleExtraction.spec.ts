import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBundleEntries } from "@/helpers/BundleExtraction";

class FakeWorker {
  static latest: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.latest = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
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
  it("transfere o ZIP, espera persistir cada entrada e só então libera a próxima", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const onEntry = vi.fn(async () => {});
    const buffer = new ArrayBuffer(8);
    const extraction = extractBundleEntries(buffer, { kind: "bible", onEntry });
    const worker = FakeWorker.latest!;

    expect(worker.posted[0].message).toMatchObject({ type: "extract", kind: "bible", buffer });
    expect(worker.posted[0].transfer).toEqual([buffer]);

    worker.emit({ type: "entry", key: "bible_1_1_1", data: { verse: 1 }, current: 1, total: 2 });
    await vi.waitFor(() => expect(onEntry).toHaveBeenCalledTimes(1));
    expect(worker.posted.at(-1)?.message).toEqual({ type: "continue" });

    worker.emit({ type: "done" });
    await extraction;
    expect(worker.terminated).toBe(true);
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
