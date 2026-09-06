import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchWithTimeout,
  setNetworkReporter,
  classifyNetworkError,
  ehRemota,
  NET_TIMEOUT,
} from "@/helpers/Http";

/**
 * Este helper decide duas coisas que erram em silêncio e só aparecem na igreja:
 * quando desistir de uma requisição, e o que conta como "a internet caiu".
 */
describe("fetchWithTimeout", () => {
  let relatos: Array<[boolean, string]>;

  beforeEach(() => {
    relatos = [];
    setNetworkReporter((ok, source) => relatos.push([ok, source]));
  });

  afterEach(() => {
    setNetworkReporter(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("não corta a transferência depois que a resposta chegou", async () => {
    // O caso que motivou a regra: numa 3G de igreja, um áudio de alguns
    // megabytes leva mais que o prazo. Abortar o corpo no meio deixaria a
    // música sem tocar — pior que o problema que o prazo evita.
    let sinalCapturado: AbortSignal | null = null;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      sinalCapturado = init.signal as AbortSignal;
      return Promise.resolve(new Response("ok", { status: 200 }));
    });

    await fetchWithTimeout("https://exemplo.test/audio.opus", { timeout: 50 });
    await new Promise((r) => setTimeout(r, 120));

    expect(sinalCapturado!.aborted).toBe(false);
  });

  it("desiste quando a resposta não chega no prazo", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("Timeout", "TimeoutError"))
        );
      })
    );

    await expect(
      fetchWithTimeout("https://exemplo.test/lento", { timeout: 30 })
    ).rejects.toThrow();
    expect(relatos).toContainEqual([false, "fetch"]);
  });

  it("qualquer resposta HTTP conta como rede viva, inclusive erro do servidor", () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 500 })));
    return fetchWithTimeout("https://exemplo.test/x", { source: "teste" }).then(() => {
      expect(relatos).toEqual([[true, "teste"]]);
    });
  });

  it("falha em arquivo local não vira falha de internet", async () => {
    // No desktop quase tudo passa por `louvorja://`. Contar isso como rede fora
    // acendia o aviso de "sem conexão" com a internet perfeita.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(
      fetchWithTimeout("louvorja://files/musics/pt/A/B.opus", { source: "file" })
    ).rejects.toThrow();
    expect(relatos).toEqual([]);
  });

  it("cancelamento nosso não é falha de rede", async () => {
    const externo = new AbortController();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })
    );

    const p = fetchWithTimeout("https://exemplo.test/x", { signal: externo.signal });
    externo.abort();
    await expect(p).rejects.toThrow();
    expect(relatos).toEqual([]);
  });

  it("erro de rede em URL remota é reportado", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchWithTimeout("https://exemplo.test/x", { source: "db" })).rejects.toThrow();
    expect(relatos).toEqual([[false, "db"]]);
  });

  it("serviço de terceiro: o sucesso conta, a falha não", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(
      fetchWithTimeout("https://youtube.test/oembed", { thirdParty: true, source: "yt" })
    ).rejects.toThrow();
    expect(relatos).toEqual([]);
  });
});

describe("classifyNetworkError", () => {
  it("separa falta de rede de resposta ruim do servidor", () => {
    expect(classifyNetworkError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyNetworkError(new DOMException("x", "TimeoutError"))).toBe("network");
    expect(classifyNetworkError(new Error("HTTP 404"))).toBe("http");
    expect(classifyNetworkError(new Error("JSON inválido"))).toBe("other");
  });
});

describe("ehRemota", () => {
  it("só http e https saem da máquina", () => {
    expect(ehRemota("https://api.test/x")).toBe(true);
    expect(ehRemota("http://api.test/x")).toBe(true);
    expect(ehRemota("louvorja://files/x.opus")).toBe(false);
    expect(ehRemota("file:///Users/x/y.mp3")).toBe(false);
  });
});

describe("NET_TIMEOUT", () => {
  it("o prazo de transferência inteira é bem maior que o de resposta", () => {
    expect(NET_TIMEOUT.STALLED).toBeGreaterThan(NET_TIMEOUT.MEDIA * 2);
  });
});
