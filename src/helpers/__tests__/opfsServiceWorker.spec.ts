// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

class FakeFileHandle {
  kind = "file" as const;
  data: Uint8Array;
  type: string;

  constructor(
    public name: string,
    data: Uint8Array,
    type = "application/octet-stream"
  ) {
    this.data = data;
    this.type = type;
  }

  async getFile(): Promise<File> {
    return new File([this.data as unknown as BlobPart], this.name, { type: this.type });
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
    const file = new FakeFileHandle(name, new Uint8Array());
    this.children.set(name, file);
    return file;
  }
}

function loadWorker(root: FakeDirHandle) {
  const code = fs.readFileSync(path.join(process.cwd(), "public/opfs-sw.js"), "utf8");
  let fetchListener: ((event: unknown) => void) | null = null;
  const self = {
    registration: { scope: "https://app.test/" },
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      if (type === "fetch") fetchListener = cb;
    },
  };
  const navigator = { storage: { getDirectory: async () => root } };
  const context = vm.createContext({
    self,
    navigator,
    Response,
    Headers,
    URL,
    ReadableStream,
    console,
  });
  vm.runInContext(code, context);
  if (!fetchListener) throw new Error("fetch listener não registrado");
  return async (request: Request): Promise<Response> => {
    let result: Promise<Response> | null = null;
    fetchListener?.({
      request,
      respondWith: (value: Promise<Response>) => {
        result = value;
      },
    });
    if (!result) throw new Error("respondWith não chamado");
    return result;
  };
}

function treeWithImage(): FakeDirHandle {
  const root = new FakeDirHandle("root");
  const louvorja = new FakeDirHandle("louvorja");
  const media = new FakeDirHandle("media-library");
  const record = new FakeDirHandle("file_1");
  record.children.set(
    "foto.png",
    new FakeFileHandle("foto.png", new Uint8Array([1, 2, 3, 4, 5]), "image/png")
  );
  media.children.set("file_1", record);
  louvorja.children.set("media-library", media);
  root.children.set("louvorja", louvorja);
  return root;
}

describe("Service Worker OPFS", () => {
  it("serve o arquivo inteiro com MIME e Content-Length", async () => {
    const respond = loadWorker(treeWithImage());
    const response = await respond(
      new Request("https://app.test/__opfs/media-library/file_1/foto.png")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("5");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
  });

  it("responde Range com 206 e Content-Range", async () => {
    const respond = loadWorker(treeWithImage());
    const response = await respond(
      new Request("https://app.test/__opfs/media-library/file_1/foto.png", {
        headers: { Range: "bytes=1-3" },
      })
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-3/5");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4]);
  });

  it("HEAD devolve metadados sem corpo", async () => {
    const respond = loadWorker(treeWithImage());
    const response = await respond(
      new Request("https://app.test/__opfs/media-library/file_1/foto.png", { method: "HEAD" })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(await response.text()).toBe("");
  });

  it("recusa traversal e pasta desconhecida", async () => {
    const respond = loadWorker(treeWithImage());
    expect(
      (await respond(new Request("https://app.test/__opfs/media-library/../foto.png"))).status
    ).toBe(403);
    expect(
      (await respond(new Request("https://app.test/__opfs/outra/file_1/foto.png"))).status
    ).toBe(403);
  });

  it("arquivo ausente devolve 404", async () => {
    const respond = loadWorker(treeWithImage());
    expect(
      (await respond(new Request("https://app.test/__opfs/media-library/file_1/sumiu.png"))).status
    ).toBe(404);
  });
});
