import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { extractBundleEntries } from "@/helpers/BundleExtraction";
import {
  catalogFiles,
  zipWithManifest,
  TestBundleWorker,
  useTestBundleWorker,
} from "./fixtures/bundle";

beforeEach(useTestBundleWorker);
afterEach(() => vi.unstubAllGlobals());

describe("extractBundleEntries", () => {
  it("extrai ZIP validado no worker, transfere buffer e espera consumo", async () => {
    const onEntry = vi.fn(async () => {});
    const buffer = await zipWithManifest(
      {
        ...catalogFiles(),
        "config.json": { version_number: 185 },
        "music_1.json": { id_music: 1 },
      },
      "catalog"
    );
    await extractBundleEntries(buffer, { kind: "catalog", onEntry });
    const worker = TestBundleWorker.latest!;
    expect(worker.posted[0].transfer).toEqual([buffer]);
    expect(onEntry).toHaveBeenCalledTimes(12);
    expect(
      worker.posted.filter(({ message }) => (message as { type: string }).type === "continue")
    ).toHaveLength(12);
    expect(worker.terminated).toBe(true);
  });
  it("recusa um ZIP com apenas um capítulo sem manifesto antes de gravar", async () => {
    const zip = new JSZip().file("bible_1_1_1.json", '{"1":"Texto"}');
    const onEntry = vi.fn();
    await expect(
      extractBundleEntries(await zip.generateAsync({ type: "arraybuffer" }), {
        kind: "bible",
        onEntry,
      })
    ).rejects.toThrow(/manifesto ausente/);
    expect(onEntry).not.toHaveBeenCalled();
  });
  it("recusa arquivos faltantes, extras e alteração com CRC recalculado", async () => {
    const buffer = await zipWithManifest(
      { "bible_1_1_1.json": { 1: "Texto" }, "bible_1_1_2.json": { 1: "Texto" } },
      "bible"
    );
    for (const change of ["missing", "extra", "changed"]) {
      const zip = await JSZip.loadAsync(buffer);
      if (change === "missing") zip.remove("bible_1_1_2.json");
      if (change === "extra") zip.file("bible_1_1_3.json", '{"1":"Texto"}');
      if (change === "changed") zip.file("bible_1_1_1.json", '{"1":"Outro"}');
      await expect(
        extractBundleEntries(await zip.generateAsync({ type: "arraybuffer" }), {
          kind: "bible",
          onEntry: vi.fn(),
        })
      ).rejects.toThrow(/Bundle inválido/);
    }
  });
  it("recusa CRC incorreto mesmo quando o JSON continua válido", async () => {
    const buffer = await zipWithManifest({ "bible_1_1_1.json": { 1: "Texto" } }, "bible");
    const bytes = new Uint8Array(buffer);
    const needle = new TextEncoder().encode("Texto");
    const offset = bytes.findIndex((_, i) => needle.every((n, j) => bytes[i + j] === n));
    expect(offset).toBeGreaterThan(0);
    bytes[offset] = 66;
    await expect(extractBundleEntries(buffer, { kind: "bible", onEntry: vi.fn() })).rejects.toThrow(
      /CRC32/
    );
  });
  it("não aceita catálogo no lugar do pacote completo", async () => {
    const buffer = await zipWithManifest(
      { ...catalogFiles(), "config.json": { version_number: 185 } },
      "catalog"
    );
    await expect(extractBundleEntries(buffer, { kind: "full", onEntry: vi.fn() })).rejects.toThrow(
      /incompleto/
    );
  });
  it("cancela depois do primeiro capítulo e termina o worker", async () => {
    const buffer = await zipWithManifest(
      { "bible_1_1_1.json": { 1: "Texto" }, "bible_1_1_2.json": { 1: "Texto" } },
      "bible"
    );
    const controller = new AbortController();
    const onEntry = vi.fn(async () => controller.abort(new Error("cancelado")));
    await expect(
      extractBundleEntries(buffer, { kind: "bible", signal: controller.signal, onEntry })
    ).rejects.toThrow("cancelado");
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(TestBundleWorker.latest?.terminated).toBe(true);
  });
});
