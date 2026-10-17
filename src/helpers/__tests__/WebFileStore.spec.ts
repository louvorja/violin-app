// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ReliabilityDiagnostics from "../ReliabilityDiagnostics";

const fetchMock = vi.fn();

vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_URL_FILES: "https://api.test/file",
  MEDIA_URL: "https://files.louvorja.com.br",
  LEGACY_MEDIA_PREFIXES: [
    "https://api.louvorja.workers.dev/file",
    "https://api.louvorja.com.br/file",
  ],
}));
vi.mock("@/helpers/Http", () => ({
  NET_TIMEOUT: { MEDIA: 1, QUICK: 1 },
  fetchWithTimeout: (url: string, init: unknown) => fetchMock(url, init),
}));

vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn(), captureException: vi.fn() } }));

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
  async keys() {
    return [...this.items.keys()].map((url) => ({ url }));
  }
}
const stores = new Map<string, FakeCache>();

import {
  AUDIO_CACHE,
  IMAGE_CACHE,
  requestPersistence,
  readDownloadedAudio,
  migrateLegacyMediaKeys,
  webDownload,
  webStorage,
  webStorageUsage,
  type WebFileEntry,
} from "../WebFileStore";

const files = [
  { remote: "/musics/pt/A/one.opus" },
  { remote: "/musics/pt/A/two.mp3" },
  { remote: "/covers/1.jpg" },
];
const url = (r: string) => `https://api.test/file${r}`;

function run(list: WebFileEntry[] = files) {
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

describe("migração das chaves antigas do /file", () => {
  it("troca a URL da API pela do armazenamento, com a query, sem tocar no resto", async () => {
    const audio = new FakeCache();
    const images = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    stores.set(IMAGE_CACHE, images);
    audio.items.set("https://api.louvorja.workers.dev/file/musics/pt/A/x.opus", new Response("a"));
    audio.items.set("https://files.louvorja.com.br/musics/pt/A/ja.opus", new Response("b"));
    images.items.set("https://api.louvorja.com.br/file/covers/1.jpg?v=2", new Response("c"));

    const moved = await migrateLegacyMediaKeys();

    expect(moved).toBe(2);
    expect([...audio.items.keys()].sort()).toEqual([
      "https://files.louvorja.com.br/musics/pt/A/ja.opus",
      "https://files.louvorja.com.br/musics/pt/A/x.opus",
    ]);
    expect([...images.items.keys()]).toEqual(["https://files.louvorja.com.br/covers/1.jpg?v=2"]);
    expect(
      await (await audio.match("https://files.louvorja.com.br/musics/pt/A/x.opus"))!.text()
    ).toBe("a");
  });

  it("não sobrescreve quem já existe na chave nova", async () => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    audio.items.set("https://api.louvorja.com.br/file/musics/pt/A/x.opus", new Response("velho"));
    audio.items.set("https://files.louvorja.com.br/musics/pt/A/x.opus", new Response("novo"));

    await migrateLegacyMediaKeys();

    expect([...audio.items.keys()]).toEqual(["https://files.louvorja.com.br/musics/pt/A/x.opus"]);
    expect(
      await (await audio.match("https://files.louvorja.com.br/musics/pt/A/x.opus"))!.text()
    ).toBe("novo");
  });
});

describe("WebFileStore", () => {
  it("reprodução lê a mesma cópia antiga reconhecida pelo scan, sem buscar na rede", async () => {
    const remote = "/musics/pt/A/one.opus";
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    audio.items.set(`https://api.louvorja.com.br/file${remote}`, new Response("local audio"));
    expect(await webStorage.checkLocal([remote])).toEqual({ [remote]: "own" });
    expect(
      await (await readDownloadedAudio(`https://files.louvorja.com.br${remote}`))!.text()
    ).toBe("local audio");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reprodução distingue arquivo ausente de cópia local vazia", async () => {
    expect(await readDownloadedAudio(url(files[0].remote))).toBeNull();
    stores.get(AUDIO_CACHE)!.items.set(url(files[0].remote), new Response(""));
    await expect(readDownloadedAudio(url(files[0].remote))).rejects.toThrow("salvo está vazio");
  });

  it("reconhece após o download as URLs públicas do catálogo ao conferir pelos caminhos relativos", async () => {
    const remote = "/musics/pt/A/one.opus";
    const remoteUrl = `https://files.louvorja.com.br${remote}`;
    expect(await run([{ remote, remoteUrl }])).toEqual({ downloaded: 1, failed: 0 });
    expect(await webStorage.checkLocal([remote])).toEqual({ [remote]: "own" });
    expect(await webStorage.sizeOfPaths([remote])).toEqual({ bytes: 11, count: 1 });
    expect(await webDownload.start([{ remote, remoteUrl }])).toEqual({ queued: 0 });
    await webStorage.removeFiles([remote]);
    expect(await webStorage.checkLocal([remote])).toEqual({ [remote]: false });
  });
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

  it("verifica um acervo grande com poucas leituras simultâneas e mantém o áudio no cache", async () => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    const remotes = Array.from({ length: 1000 }, (_, i) => `/musics/pt/A/${i}.opus`);
    audio.items.set(url(remotes[0]), new Response("áudio preservado"));
    let active = 0;
    let peak = 0;
    const originalMatch = audio.match.bind(audio);
    vi.spyOn(audio, "match").mockImplementation(async (remote) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      try {
        return await originalMatch(remote);
      } finally {
        active--;
      }
    });

    const local = await webStorage.checkLocal(remotes);

    expect(local[remotes[0]]).toBe("own");
    expect(local[remotes[999]]).toBe(false);
    expect(Object.keys(local)).toHaveLength(1000);
    expect(peak).toBeLessThanOrEqual(4);
    expect(await (await originalMatch(url(remotes[0])))!.text()).toBe("áudio preservado");
  });

  it("descarta o corpo da resposta usada somente para verificar existência", async () => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(audio, "match").mockResolvedValue({
      body: { locked: false, cancel },
      bodyUsed: false,
    } as unknown as Response);

    expect(await webStorage.checkLocal([files[0].remote])).toEqual({ [files[0].remote]: "own" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("start devolve queued 0 e não baixa nada quando já está tudo guardado", async () => {
    await run();
    fetchMock.mockClear();
    expect(await webDownload.start(files)).toEqual({ queued: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("baixa sem reaproveitar a cópia que o navegador guardou ao exibir o arquivo", async () => {
    await run([{ remote: "/covers/1.jpg" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      url("/covers/1.jpg"),
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("recusa 206, conta falha e emite file-error sem gravar o arquivo", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      u.endsWith("one.opus")
        ? new Response("p", { status: 206 })
        : new Response("x", { status: 200 })
    );
    const errors: string[] = [];
    const off = webDownload.onFileError((e) => errors.push(e.file));
    const result = await run();
    off();
    expect(result).toEqual({ downloaded: 2, failed: 1 });
    expect(errors).toEqual(["/musics/pt/A/one.opus"]);
    expect((await webStorage.checkLocal(["/musics/pt/A/one.opus"]))["/musics/pt/A/one.opus"]).toBe(
      false
    );
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

  it("falta de espaço interrompe a fila, preserva os anteriores e registra a causa original", async () => {
    const reportFailure = vi
      .spyOn(ReliabilityDiagnostics, "reportReliabilityFailure")
      .mockImplementation(() => {});
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    audio.items.set(url(files[0].remote), new Response("saved"));
    vi.spyOn(audio, "put").mockRejectedValue(
      new DOMException("Quota reached", "QuotaExceededError")
    );
    const many = Array.from({ length: 30 }, (_, i) => ({ remote: `/musics/pt/A/new-${i}.mp3` }));
    expect(await run(many)).toEqual({ downloaded: 0, failed: 30 });
    expect(fetchMock.mock.calls.length).toBeLessThan(30);
    expect(await (await audio.match(url(files[0].remote)))!.text()).toBe("saved");
    expect(reportFailure).toHaveBeenCalledWith(
      "web_download_file_failed",
      expect.objectContaining({ name: "QuotaExceededError", message: "Quota reached" }),
      expect.objectContaining({
        stage: "persist",
      })
    );
    reportFailure.mockRestore();
  });

  it("não declara sucesso quando os arquivos desaparecem antes da conferência final", async () => {
    const reportEvent = vi
      .spyOn(ReliabilityDiagnostics, "reportReliabilityEvent")
      .mockImplementation(() => {});
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    vi.spyOn(audio, "put").mockResolvedValue(undefined);
    expect(await run([files[0]])).toEqual({ downloaded: 0, failed: 1 });
    expect(reportEvent).toHaveBeenCalledWith(
      "web_download_storage_verified",
      expect.objectContaining({ requested: 1, missing: 1 })
    );
    reportEvent.mockRestore();
  });

  it("queda de rede pausa a fila e retoma sem contar falha quando a conexão volta", async () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal("window", {
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => {},
    });
    let offline = true;
    fetchMock.mockImplementation(async () => {
      if (offline) throw new TypeError("Load failed");
      return new Response("x", { status: 200 });
    });
    const errors: string[] = [];
    const off = webDownload.onFileError((e) => errors.push(e.file));
    const many = Array.from({ length: 12 }, (_, i) => ({ remote: `/musics/pt/A/${i}.mp3` }));
    const finished = run(many);
    await vi.waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    expect(errors).toEqual([]);
    offline = false;
    listeners.forEach((cb) => cb());
    expect(await finished).toEqual({ downloaded: 12, failed: 0 });
    off();
    expect(errors).toEqual([]);
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

  it("remove uma seleção grande sem enfileirar todas as exclusões ao mesmo tempo", async () => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    const remotes = Array.from({ length: 1000 }, (_, i) => `/musics/pt/A/${i}.opus`);
    let active = 0;
    let peak = 0;
    vi.spyOn(audio, "delete").mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return true;
    });

    await webStorage.removeFiles(remotes);

    // Remove as quatro chaves equivalentes sem elevar a concorrência.
    expect(audio.delete).toHaveBeenCalledTimes(4000);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("mede mídia legada sem Content-Length lendo chunks sem clone nem corpo inteiro", async () => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    let remaining = 64;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (remaining-- > 0) controller.enqueue(new Uint8Array(32 * 1024));
          else controller.close();
        },
      })
    );
    vi.spyOn(audio, "match").mockResolvedValue(response);
    const clone = vi.spyOn(response, "clone");
    const blob = vi.spyOn(response, "blob");
    const arrayBuffer = vi.spyOn(response, "arrayBuffer");

    expect(await webStorage.sizeOfPaths([files[0].remote])).toEqual({
      bytes: 2 * 1024 * 1024,
      count: 1,
    });
    expect(clone).not.toHaveBeenCalled();
    expect(blob).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it.each([0, 2048])("usa Content-Length %i sem ler o corpo", async (bytes) => {
    const audio = new FakeCache();
    stores.set(AUDIO_CACHE, audio);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const getReader = vi.fn();
    vi.spyOn(audio, "match").mockResolvedValue({
      headers: new Headers({ "content-length": String(bytes) }),
      body: { locked: false, cancel, getReader },
      bodyUsed: false,
    } as unknown as Response);

    expect(await webStorage.sizeOfPaths([files[0].remote])).toEqual({ bytes, count: 1 });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("clearFiles apaga áudio e imagens baixados", async () => {
    await run();
    await webStorage.clearFiles();
    expect(await webStorage.sizeOfPaths(files.map((f) => f.remote))).toEqual({
      bytes: 0,
      count: 0,
    });
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
