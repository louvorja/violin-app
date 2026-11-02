// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { DB_TABLE } from "@/constants/DbTables";

const h = vi.hoisted(() => ({
  rows: new Map<string, { id: string; [key: string]: unknown }[]>(),
  clear: vi.fn(),
}));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: async (table: string) => h.rows.get(table) ?? [],
    clear: async (table: string) => {
      h.clear(table);
      h.rows.delete(table);
    },
    put: async (table: string, row: { id: string }) =>
      h.rows.set(table, [...(h.rows.get(table) ?? []), row]),
  },
}));
import DatabaseBackup from "../DatabaseBackup";

let exported: Blob;
beforeEach(() => {
  h.rows.clear();
  h.clear.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    exported = blob as Blob;
    return "blob:backup";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("backup com mídia", () => {
  it("restaura os bytes e tipos de imagens, áudio e arquivos, inclusive campos aninhados", async () => {
    const bytes = new Uint8Array([0, 10, 128, 255]);
    h.rows.set(DB_TABLE.IMAGE_LIBRARY, [
      { id: "cover", blob: new Blob([bytes], { type: "image/png" }) },
    ]);
    h.rows.set(DB_TABLE.AUDIO_LIBRARY, [
      { id: "song", blob: new Blob([bytes], { type: "audio/mpeg" }) },
    ]);
    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      { id: "file", data: bytes.buffer, nested: [{ preview: new Blob(["preview"]) }] },
    ]);
    await DatabaseBackup.exportAll();
    await DatabaseBackup.importAll(new File([exported], "backup.zip"));
    for (const table of [DB_TABLE.IMAGE_LIBRARY, DB_TABLE.AUDIO_LIBRARY]) {
      const blob = h.rows.get(table)![0].blob as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
      expect(blob.type).toBe(table === DB_TABLE.IMAGE_LIBRARY ? "image/png" : "audio/mpeg");
    }
    const row = h.rows.get(DB_TABLE.MEDIA_LIBRARY)![0];
    expect(row.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(row.data as ArrayBuffer)).toEqual(bytes);
    expect(await (row.nested as { preview: Blob }[])[0].preview.text()).toBe("preview");
  });

  it("continua lendo backups versão 1 de dados JSON", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: "louvorja-violin-db",
        version: 1,
        tables: [{ name: DB_TABLE.SETTINGS }],
      })
    );
    zip.file(`${DB_TABLE.SETTINGS}.json`, JSON.stringify([{ id: "theme", value: "dark" }]));
    await DatabaseBackup.importAll(
      new File([await zip.generateAsync({ type: "arraybuffer" })], "v1.zip")
    );
    expect(h.rows.get(DB_TABLE.SETTINGS)).toEqual([{ id: "theme", value: "dark" }]);
  });

  it("preserva File e somente o intervalo de bytes de uma view", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      {
        id: "typed",
        file: new File([bytes], "foto.png", { type: "image/png", lastModified: 1234 }),
        view: new Uint8Array(bytes.buffer, 1, 2),
      },
    ]);
    await DatabaseBackup.exportAll();
    await DatabaseBackup.importAll(new File([exported], "backup.zip"));
    const row = h.rows.get(DB_TABLE.MEDIA_LIBRARY)![0];
    expect(row.file).toBeInstanceOf(File);
    expect(row.file).toMatchObject({ name: "foto.png", type: "image/png", lastModified: 1234 });
    expect(row.view).toBeInstanceOf(Uint8Array);
    expect(row.view).toEqual(new Uint8Array([1, 2]));
  });

  it.each([
    { kind: "Unknown" },
    { size: 999 },
    { __louvorja_binary__: "../image.bin" },
    { mime: 7 },
    { kind: "File", name: 42 },
  ])("recusa referência binária inválida antes de limpar tabelas: %j", async (patch) => {
    h.rows.set(DB_TABLE.IMAGE_LIBRARY, [{ id: "cover", blob: new Blob(["image"]) }]);
    await DatabaseBackup.exportAll();
    const zip = await JSZip.loadAsync(await exported.arrayBuffer());
    const name = `${DB_TABLE.IMAGE_LIBRARY}.json`;
    const rows = JSON.parse(await zip.file(name)!.async("text"));
    Object.assign(rows[0].blob, patch);
    zip.file(name, JSON.stringify(rows));
    await expect(
      DatabaseBackup.importAll(
        new File([await zip.generateAsync({ type: "arraybuffer" })], "invalid.zip")
      )
    ).rejects.toThrow();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("recusa backup sem os bytes referenciados antes de apagar dados locais", async () => {
    h.rows.set(DB_TABLE.IMAGE_LIBRARY, [{ id: "cover", blob: new Blob(["image"]) }]);
    await DatabaseBackup.exportAll();
    const zip = await JSZip.loadAsync(await exported.arrayBuffer());
    for (const name of Object.keys(zip.files)) if (name.startsWith("binary/")) zip.remove(name);
    await expect(
      DatabaseBackup.importAll(
        new File([await zip.generateAsync({ type: "arraybuffer" })], "broken.zip")
      )
    ).rejects.toThrow();
    expect(h.clear).not.toHaveBeenCalled();
  });
});
