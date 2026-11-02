// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: async (table: string, id: string) => records.get(`${table}/${id}`),
    put: async (table: string, row: { id: string }) => records.set(`${table}/${row.id}`, row),
  },
}));

import {
  importAudio,
  importImage,
  resolveAudio,
  resolveImage,
  getAudioBlob,
  getImageBlob,
  revokeUrl,
} from "../AudioLibrary";

describe.each([
  ["audio", DB_TABLE.AUDIO_LIBRARY, importAudio, resolveAudio, getAudioBlob],
  ["image", DB_TABLE.IMAGE_LIBRARY, importImage, resolveImage, getImageBlob],
] as const)("biblioteca de %s", (kind, table, importFile, resolve, getBlob) => {
  beforeEach(() => records.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each([{}, null, "bytes ausentes"])(
    "trata bytes inválidos como mídia indisponível: %j",
    async (blob) => {
      records.set(`${table}/broken`, { id: "broken", blob });
      const create = vi.spyOn(URL, "createObjectURL");
      await expect(resolve(`lib://${kind}/broken.bin`)).resolves.toBeNull();
      await expect(getBlob(`lib://${kind}/broken.bin`)).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
    }
  );

  it("reimportar o arquivo recupera o registro cujos bytes foram perdidos", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 255])], { type: `${kind}/test` });
    const token = await importFile(blob, "original.bin");
    const hash = token
      .split("/")
      .at(-1)!
      .replace(/\.bin$/, "");
    records.set(`${table}/${hash}`, { id: hash, blob: {} });
    expect(await importFile(blob, "original.bin")).toBe(token);
    expect(await getBlob(token)).toBeInstanceOf(Blob);
    const url = await resolve(token);
    expect(url).toMatch(/^blob:/);
    revokeUrl(token);
  });
});
