// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/config/Api", () => ({ API_URL: "https://api.test", API_URL_FILES: "https://api.test/file" }));
vi.mock("@/helpers/Http", () => ({
  NET_TIMEOUT: { MEDIA: 1, QUICK: 1 },
  fetchWithTimeout: (url: string, init: unknown) => fetchMock(url, init),
}));

class FakeCache {
  items = new Map<string, Response>();
  async match(url: string) {
    return this.items.get(url)?.clone();
  }
  async put(url: string, r: Response) {
    this.items.set(url, r);
  }
  async delete(url: string) {
    return this.items.delete(url);
  }
}
const stores = new Map<string, FakeCache>();

import {
  AUDIO_CACHE,
  IMAGE_CACHE,
  requestPersistence,
  webDownload,
  webStorage,
  webStorageUsage,
} from "../WebFileStore";

const files = [
  { remote: "/musics/pt/A/one.opus" },
  { remote: "/musics/pt/A/two.mp3" },
  { remote: "/covers/1.jpg" },
];
const url = (r: string) => `https://api.test/file${r}`;

function run(list = files) {
  return new Promise<{ downloaded: number; failed: number }>((resolve) => {
    const off = webDownload.onQueueDone((r) => {
      off();
      resolve(r);
    });
    void webDownload.start(list);
  });
}

beforeEach(() => {
  stores.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("audio-bytes", { status: 200 }));
  vi.stubGlobal("window", {});
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name);
    },
    delete: async (name: string) => stores.delete(name),
  });
  vi.stubGlobal("navigator", { storage: { persist: async () => true } });
});

describe("WebFileStore", () => {
  it("separa áudio (inclui .opus) de imagem nos caches do service worker", async () => {
    const result = await run();
    expect(result).toEqual({ downloaded: 3, failed: 0 });
    expect([...stores.get(AUDIO_CACHE)!.items.keys()].sort()).toEqual(
      [url("/musics/pt/A/one.opus"), url("/musics/pt/A/two.mp3")].sort()
    );
    expect([...stores.get(IMAGE_CACHE)!.items.keys()]).toEqual([url("/covers/1.jpg")]);
  });

  it("checkLocal reflete o que está guardado", async () => {
    await run();
    const local = await webStorage.checkLocal([...files.map((f) => f.remote), "/covers/9.jpg"]);
    expect(local).toEqual({
      "/musics/pt/A/one.opus": "own",
      "/musics/pt/A/two.mp3": "own",
      "/covers/1.jpg": "own",
      "/covers/9.jpg": false,
    });
  });

  it("start devolve queued 0 e não baixa nada quando já está tudo guardado", async () => {
    await run();
    fetchMock.mockClear();
    expect(await webDownload.start(files)).toEqual({ queued: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa 206, conta falha e emite file-error sem gravar o arquivo", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      u.endsWith("one.opus") ? new Response("p", { status: 206 }) : new Response("x", { status: 200 })
    );
    const errors: string[] = [];
    const off = webDownload.onFileError((e) => errors.push(e.file));
    const result = await run();
    off();
    expect(result).toEqual({ downloaded: 2, failed: 1 });
    expect(errors).toEqual(["/musics/pt/A/one.opus"]);
    expect((await webStorage.checkLocal(["/musics/pt/A/one.opus"]))["/musics/pt/A/one.opus"]).toBe(false);
  });

  it("repete uma vez antes de contar a falha", async () => {
    let first = true;
    fetchMock.mockImplementation(async () => {
      if (first) {
        first = false;
        throw new Error("rede");
      }
      return new Response("x", { status: 200 });
    });
    expect(await run([files[0]])).toEqual({ downloaded: 1, failed: 0 });
  });

  it("cancelar emite queue-cancelled e não emite queue-done", async () => {
    fetchMock.mockImplementation(async (_u: string, init: { signal: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 5));
      if (init.signal.aborted) throw new DOMException("x", "AbortError");
      return new Response("x", { status: 200 });
    });
    const done = vi.fn();
    const offDone = webDownload.onQueueDone(done);
    const cancelled = new Promise<void>((resolve) => {
      const off = webDownload.onQueueCancelled(() => {
        off();
        resolve();
      });
    });
    await webDownload.start(files);
    await webDownload.cancel();
    await cancelled;
    offDone();
    expect(done).not.toHaveBeenCalled();
  });

  it("removeFiles apaga e sizeOfPaths soma o que sobrou", async () => {
    await run();
    expect(await webStorage.sizeOfPaths(files.map((f) => f.remote))).toEqual({
      bytes: 3 * "audio-bytes".length,
      count: 3,
    });
    await webStorage.removeFiles(["/covers/1.jpg"]);
    expect(await webStorage.sizeOfPaths(files.map((f) => f.remote))).toMatchObject({ count: 2 });
  });

  it("clearFiles apaga áudio e imagens baixados", async () => {
    await run();
    await webStorage.clearFiles();
    expect(await webStorage.sizeOfPaths(files.map((f) => f.remote))).toEqual({ bytes: 0, count: 0 });
  });

  it("webStorageUsage lê uso, limite e proteção do navegador", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ usage: 10, quota: 100 }),
        persisted: async () => false,
      },
    });
    expect(await webStorageUsage()).toEqual({ usage: 10, quota: 100, persisted: false });
  });

  it("requestPersistence devolve false sem a API e não lança", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal("navigator", {
      storage: {
        persisted: async () => false,
        persist: async () => {
          throw new Error("negado");
        },
      },
    });
    expect(await requestPersistence()).toBe(false);
  });
});
