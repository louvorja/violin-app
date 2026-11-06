import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, Record<string, unknown>>();

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async () => [...rows.values()]),
    rewriteRecords: vi.fn(async (_table: string, rewrite: (value: unknown) => unknown) => {
      let changed = 0;
      for (const [id, value] of rows) {
        const next = rewrite(value);
        if (next !== value) {
          rows.set(id, next as Record<string, unknown>);
          changed++;
        }
      }
      return changed;
    }),
  },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));

const { loadAnnouncements, withBlobMedia } = await import("../storage");

beforeEach(() => rows.clear());

describe("announcements storage", () => {
  it("converts legacy ArrayBuffer media to Blob with its MIME, keeping the other fields", async () => {
    const original = {
      id: "a",
      nome: "Culto",
      ordem: 1,
      imageData: new Uint8Array([1, 2, 3]).buffer,
      imageMime: "image/png",
      videoData: new ArrayBuffer(8),
      style: { bgColor: "#000" },
    };
    const next = withBlobMedia(original) as Record<string, unknown>;
    expect(next).not.toBe(original);
    expect(next.imageData).toBeInstanceOf(Blob);
    expect((next.imageData as Blob).type).toBe("image/png");
    expect((next.imageData as Blob).size).toBe(3);
    expect((next.videoData as Blob).type).toBe("video/mp4");
    expect(next).toMatchObject({ id: "a", nome: "Culto", ordem: 1, style: { bgColor: "#000" } });
  });

  it("leaves records that already store Blob (or no media) untouched", () => {
    const blobRecord = { id: "b", ordem: 1, videoData: new Blob(["v"]) };
    const textOnly = { id: "c", ordem: 2, texto: "Bem-vindos" };
    expect(withBlobMedia(blobRecord)).toBe(blobRecord);
    expect(withBlobMedia(textOnly)).toBe(textOnly);
  });

  it("migrates the stored table once and returns the records sorted by ordem", async () => {
    rows.set("x", { id: "x", ordem: 2, videoData: new ArrayBuffer(4) });
    rows.set("y", { id: "y", ordem: 1 });
    const loaded = await loadAnnouncements<{ id: string; ordem: number; videoData?: Blob }>();
    expect(loaded.map((a) => a.id)).toEqual(["y", "x"]);
    expect(loaded[1].videoData).toBeInstanceOf(Blob);
    expect(rows.get("x")?.videoData).toBeInstanceOf(Blob);
  });
});
