// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeFileHandle {
  kind = "file" as const;
  data = new Uint8Array();
  lastModified = Date.now();

  constructor(public name: string) {}

  async getFile(): Promise<File> {
    return new File([this.data], this.name, { lastModified: this.lastModified });
  }

  async createWritable() {
    const chunks: Uint8Array[] = [];
    const handle = this;
    return {
      write: async (value: Uint8Array) => {
        chunks.push(new Uint8Array(value));
      },
      close: async () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        handle.data = merged;
        handle.lastModified = Date.now();
      },
      abort: async () => {},
    };
  }
}

class FakeDirHandle {
  kind = "directory" as const;
  children = new Map<string, FakeDirHandle | FakeFileHandle>();

  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found instanceof FakeDirHandle) return found;
    if (!options?.create) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    const dir = new FakeDirHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found instanceof FakeFileHandle) return found;
    if (!options?.create) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    const file = new FakeFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    if (!this.children.has(name))
      throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    this.children.delete(name);
  }

  async *entries() {
    for (const entry of this.children.entries()) yield entry;
  }
}

const root = new FakeDirHandle("root");

beforeEach(() => {
  root.children.clear();
  vi.stubGlobal("FileSystemFileHandle", FakeFileHandle);
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => root },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpfsStore", () => {
  it("grava, lê, lista e remove um arquivo de biblioteca", async () => {
    const store = await import("../OpfsStore");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.writeOpfsStream(
      "media-library/file_1/foto.png",
      new Blob([bytes]).stream() as ReadableStream<Uint8Array>,
      bytes.byteLength
    );

    expect(await store.opfsInfo("media-library/file_1/foto.png")).toMatchObject({
      exists: true,
      size: 4,
    });
    const file = await store.readOpfsFile("media-library/file_1/foto.png");
    expect(file && new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

    expect(await store.listOpfs()).toEqual([
      expect.objectContaining({ rel: "media-library/file_1/foto.png", size: 4 }),
    ]);

    expect(await store.removeOpfs("media-library/file_1/foto.png")).toBe(true);
    expect((await store.opfsInfo("media-library/file_1/foto.png")).exists).toBe(false);
  });

  it("recusa tamanho diferente do declarado e apaga o parcial", async () => {
    const store = await import("../OpfsStore");
    await expect(
      store.writeOpfsStream(
        "media-library/file_2/foto.png",
        new Blob([new Uint8Array([1, 2])]).stream() as ReadableStream<Uint8Array>,
        10
      )
    ).rejects.toThrow("incomplete_file");
    expect((await store.opfsInfo("media-library/file_2/foto.png")).exists).toBe(false);
  });

  it("só aceita os caminhos relativos das quatro pastas", async () => {
    const store = await import("../OpfsStore");
    expect(store.isOpfsRel("media-library/id/foto.png")).toBe(true);
    expect(store.isOpfsRel("media-library/id/sub/foto.png")).toBe(false);
    expect(store.isOpfsRel("media-library/../foto.png")).toBe(false);
    expect(store.isOpfsRel("outra/id/foto.png")).toBe(false);
    expect(store.isOpfsRel("liturgy-temp/a.zip")).toBe(true);
    expect(store.isOpfsPath("opfs:background-sound/id/a.mp3")).toBe(true);
  });

  it("URL do Service Worker respeita o BASE_URL", async () => {
    const store = await import("../OpfsStore");
    expect(store.opfsUrl("opfs:media-library/id/foto do culto.png")).toBe(
      "/__opfs/media-library/id/foto%20do%20culto.png"
    );
  });

  it("staging preserva o arquivo antigo para rollback e é removido no fim", async () => {
    const store = await import("../OpfsStore");
    const rel = "media-library/file_3/foto.png";
    const oldBytes = new Uint8Array([9, 9, 9]);
    await store.writeOpfsStream(
      rel,
      new Blob([oldBytes]).stream() as ReadableStream<Uint8Array>,
      oldBytes.byteLength
    );
    const token = "test-token";
    await store.copyOpfsFile(rel, store.stagingRel(token, "rollback", rel));

    const newBytes = new Uint8Array([1, 2, 3]);
    await store.writeOpfsStream(
      rel,
      new Blob([newBytes]).stream() as ReadableStream<Uint8Array>,
      newBytes.byteLength
    );
    await store.copyOpfsFile(store.stagingRel(token, "rollback", rel), rel);

    const restored = await store.readOpfsFile(rel);
    expect(restored && new Uint8Array(await restored.arrayBuffer())).toEqual(oldBytes);

    await store.removeStaging(token);
    expect(await store.readOpfsFile(store.stagingRel(token, "rollback", rel))).toBeNull();
  });

  it("pruneOpfsStaging remove um staging abandonado", async () => {
    const store = await import("../OpfsStore");
    await store.writeOpfsStream(
      store.stagingRel("token-antigo", "restore", "media-library/file_4/foto.png"),
      new Blob([new Uint8Array([1])]).stream() as ReadableStream<Uint8Array>,
      1
    );
    expect(
      await store.readOpfsFile(
        store.stagingRel("token-antigo", "restore", "media-library/file_4/foto.png")
      )
    ).not.toBeNull();
    expect(await store.pruneOpfsStaging()).toBe(true);
    expect(
      await store.readOpfsFile(
        store.stagingRel("token-antigo", "restore", "media-library/file_4/foto.png")
      )
    ).toBeNull();
  });

  it("prune remove temporários antigos e mantém os novos", async () => {
    const store = await import("../OpfsStore");
    const temp = await root
      .getDirectoryHandle("louvorja", { create: true })
      .then((dir) => dir.getDirectoryHandle("liturgy-temp", { create: true }));
    const old = new FakeFileHandle("velho.zip");
    old.lastModified = Date.now() - 48 * 60 * 60 * 1000;
    temp.children.set("velho.zip", old);
    const recent = new FakeFileHandle("novo.zip");
    temp.children.set("novo.zip", recent);

    expect(await store.pruneOpfsTemp(6 * 60 * 60 * 1000)).toBe(1);
    expect(temp.children.has("velho.zip")).toBe(false);
    expect(temp.children.has("novo.zip")).toBe(true);
  });
});
