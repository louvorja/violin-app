import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { flushPromises } from "@vue/test-utils";
import { translateText, translateMusic, translateBibleChapter } from "@/helpers/Libras";
import { TRANSLATE_URL } from "@/config/Libras";

const mocks = vi.hoisted(() => ({
  enabled: true,
  fetch: vi.fn(),
  log: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/helpers/IndexedDB", () => ({ default: { get: mocks.get, put: mocks.put } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { isEnabled: () => mocks.enabled, log: mocks.log },
}));
vi.mock("@/helpers/Http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/Http")>()),
  fetchWithTimeout: mocks.fetch,
}));

const context = {
  operation: "live_music" as const,
  part: "slide" as const,
  musicId: 42,
  slideIndex: 2,
};
const attributes = () =>
  mocks.log.mock.calls.map(([, , value]) => value as Record<string, unknown>);
async function waitForLogs(count = 1) {
  await flushPromises();
  await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(count));
}

describe("diagnóstico de tradução Libras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.log.mockReset();
    mocks.enabled = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("crypto", webcrypto);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserva payload, timeout e resultado de sucesso sem logs novos ou efeitos no cache", async () => {
    mocks.fetch.mockResolvedValue(new Response("  GLOSS TRADUZIDO  ", { status: 200 }));
    expect(await translateText("  Texto\noriginal  ", context)).toBe("GLOSS TRADUZIDO");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      TRANSLATE_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Texto\noriginal" }),
        timeout: 15000,
        source: "libras-translate",
        thirdParty: true,
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP500 inclui erro do serviço, referência da entrada e fingerprint exato sem retry", async () => {
    const text = "Meu texto de música\nsegunda linha";
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Translation Core Unavailable", secret: "never-send" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      )
    );
    expect(await translateText(text, context)).toBeNull();
    await waitForLogs();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(
      "warn",
      "libras translation failed",
      expect.objectContaining({
        operation: "live_music",
        part: "slide",
        music_id: 42,
        slide_index: 2,
        request_id: expect.any(String),
        operation_id: expect.any(String),
        failure_kind: "http_server",
        http_status: 500,
        duration_ms: expect.any(Number),
        response_content_type: "application/json",
        response_error_read: "ok",
        provider_error: "Translation Core Unavailable",
        input_preview: text.replace("\n", " "),
        input_chars: text.length,
        input_bytes: new TextEncoder().encode(text).byteLength,
        input_lines: 2,
        input_fingerprint: "sha256:" + createHash("sha256").update(text).digest("hex"),
      })
    );
    expect(JSON.stringify(attributes())).not.toContain("never-send");
  });

  it("HTTP422 extrai somente validação de text e mantém referências bíblicas", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: [{ text: "Text too short" }, { api_token: "never-send" }],
          body: { text: "arbitrary" },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      )
    );
    expect(
      await translateText("Versículo", {
        operation: "live_bible",
        part: "verse",
        bibleVersion: "NVI",
        bibleBookId: 43,
        bibleChapter: 3,
        bibleVerses: [16],
      })
    ).toBeNull();
    await waitForLogs();
    expect(attributes()[0]).toMatchObject({
      failure_kind: "http_client",
      http_status: 422,
      provider_error: "Text too short",
      bible_version: "NVI",
      bible_book_id: 43,
      bible_chapter: 3,
      bible_verses: [16],
    });
    expect(JSON.stringify(attributes())).not.toMatch(/never-send|arbitrary/);
  });

  it("limita a leitura da resposta e sanitiza credenciais em erro e preview de entrada", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            "token=provider-secret Bearer bearer-secret https://provider.test/?secret=private " +
              "x".repeat(5000)
          )
        );
      },
      cancel,
    });
    mocks.fetch.mockResolvedValue(
      new Response(stream, {
        status: 500,
        headers: {
          "Content-Type": "text/plain; token=header-secret",
          "Set-Cookie": "cookie-secret",
        },
      })
    );
    expect(
      await translateText(
        "token=input-secret https://input.test/?key=input-url-secret " + "x".repeat(1000),
        context
      )
    ).toBeNull();
    await waitForLogs();
    expect(cancel).toHaveBeenCalledOnce();
    expect(attributes()[0]).toMatchObject({
      response_content_type: "text/plain",
      response_body_truncated: true,
      input_preview_truncated: true,
    });
    expect(String(attributes()[0].provider_error).length).toBeLessThanOrEqual(512);
    expect(String(attributes()[0].input_preview).length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(attributes())).not.toMatch(
      /provider-secret|bearer-secret|input-secret|header-secret|cookie-secret|input-url-secret|private/
    );
  });

  it("não aguarda uma resposta de erro sem fim e registra timeout do diagnóstico", async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(await translateText("Texto", context)).toBeNull();
    expect(mocks.log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await waitForLogs();
    expect(attributes()[0]).toMatchObject({
      failure_kind: "http_server",
      http_status: 500,
      response_error_read: "timeout",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("distingue falha de transporte da falha de leitura após HTTP200", async () => {
    mocks.fetch.mockRejectedValueOnce(
      new TypeError("Failed to fetch https://provider.test/?token=private")
    );
    expect(await translateText("Texto", context)).toBeNull();
    const response = new Response("", { status: 200, headers: { "Content-Type": "text/plain" } });
    vi.spyOn(response, "text").mockRejectedValue(new Error("Body stream failed"));
    mocks.fetch.mockResolvedValueOnce(response);
    expect(await translateText("Texto", context)).toBeNull();
    await waitForLogs(2);
    expect(attributes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failure_kind: "transport",
          transport_kind: "network",
          error_name: "TypeError",
        }),
        expect.objectContaining({
          failure_kind: "response_body",
          http_status: 200,
          error_message: "Body stream failed",
        }),
      ])
    );
    expect(attributes().find((value) => value.failure_kind === "transport")).not.toHaveProperty(
      "http_status"
    );
    expect(JSON.stringify(attributes())).not.toContain("private");
  });

  it("correlaciona falhas da mesma operação mantendo request ids distintos e hash estável", async () => {
    mocks.fetch.mockImplementation(
      async () =>
        new Response("Translation failed", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        })
    );
    const operation = { ...context, operationId: "same-operation" };
    expect(
      await Promise.all([
        translateText("Mesmo texto", operation),
        translateText("Mesmo texto", operation),
      ])
    ).toEqual([null, null]);
    await waitForLogs(2);
    expect(new Set(attributes().map((value) => value.request_id)).size).toBe(2);
    expect(new Set(attributes().map((value) => value.input_fingerprint)).size).toBe(1);
    expect(attributes().every((value) => value.operation_id === "same-operation")).toBe(true);
  });

  it("com opt-in desligado preserva falha sem ler body nem enviar diagnóstico", async () => {
    mocks.enabled = false;
    const response = new Response("Translation Core Unavailable", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    const reader = vi.spyOn(response.body!, "getReader");
    mocks.fetch.mockResolvedValue(response);
    expect(await translateText("Texto", context)).toBeNull();
    await flushPromises();
    expect(reader).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("falha no logger não altera retorno nem produz rejeição pendente", async () => {
    mocks.log.mockImplementation(() => {
      throw new Error("Logger unavailable");
    });
    mocks.fetch.mockResolvedValue(
      new Response("Service failed", { status: 500, headers: { "Content-Type": "text/plain" } })
    );
    expect(await translateText("Texto", context)).toBeNull();
    await waitForLogs();
  });

  it("um download mantém a correlação entre seus slides e respeita cancelamento antes dos bundles", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const text = JSON.parse(init.body as string).text as string;
      if (text.includes("\n")) return new Response("FULL GLOSS", { status: 200 });
      if (text === "Segundo") controller.abort();
      return new Response(JSON.stringify({ error: "Translation Core Unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    expect(
      await translateMusic(
        42,
        {
          id_music: 42,
          name: "Música",
          duration: "03:00",
          lyric: [
            { lyric: "Primeiro", order: 1, show_slide: 1 },
            { lyric: "Segundo", order: 2, show_slide: 1 },
          ],
        },
        "pt",
        undefined,
        "BR",
        controller.signal
      )
    ).toBeNull();
    await waitForLogs(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(new Set(attributes().map((value) => value.operation_id)).size).toBe(1);
    expect(new Set(attributes().map((value) => value.request_id)).size).toBe(2);
    expect(attributes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "download_music",
          music_id: 42,
          part: "slide",
          slide_index: 0,
        }),
        expect.objectContaining({
          operation: "download_music",
          music_id: 42,
          part: "slide",
          slide_index: 1,
        }),
      ])
    );
  });

  it("um download bíblico registra versão, livro, capítulo e versículo da entrada que falhou", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const text = JSON.parse(init.body as string).text as string;
      if (text.includes("\n")) return new Response("FULL GLOSS", { status: 200 });
      if (text === "Versículo 17") controller.abort();
      return new Response(JSON.stringify({ error: "Translation Core Unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    expect(
      await translateBibleChapter(
        "NVI",
        { id_bible_book: 43, name: "João", chapters: 21 },
        3,
        { "16": "Versículo 16", "17": "Versículo 17" },
        "pt",
        undefined,
        "BR",
        controller.signal
      )
    ).toBeNull();
    await waitForLogs(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(new Set(attributes().map((value) => value.operation_id)).size).toBe(1);
    expect(attributes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "download_bible",
          bible_version: "NVI",
          bible_book_id: 43,
          bible_chapter: 3,
          part: "verse",
          bible_verses: [16],
        }),
        expect.objectContaining({ operation: "download_bible", bible_verses: [17] }),
      ])
    );
  });

  it("HTML de proxy só fornece título e binário não é lido nem registrado", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("<html><title>502 Bad Gateway</title><body>token=private-secret</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })
    );
    expect(await translateText("Texto", context)).toBeNull();
    const binary = new Response("private-secret", {
      status: 500,
      headers: { "Content-Type": "application/octet-stream" },
    });
    const reader = vi.spyOn(binary.body!, "getReader");
    mocks.fetch.mockResolvedValueOnce(binary);
    expect(await translateText("Texto", context)).toBeNull();
    await waitForLogs(2);
    expect(attributes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_error: "502 Bad Gateway",
          response_content_type: "text/html",
        }),
        expect.objectContaining({ response_error_read: "unsupported_content_type" }),
      ])
    );
    expect(reader).not.toHaveBeenCalled();
    expect(JSON.stringify(attributes())).not.toContain("private-secret");
  });

  it("distingue timeout da requisição e conserva null sem novas tentativas", async () => {
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const request = translateText("Texto", context);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await request).toBeNull();
    await waitForLogs();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(attributes()[0]).toMatchObject({
      failure_kind: "transport",
      transport_kind: "timeout",
      error_name: "AbortError",
    });
  });

  it("sanitiza variantes de credenciais plain e JSON em input, resposta e erro de transporte", async () => {
    const secrets = [
      'api_token=fixture-one apiToken=fixture-two "api_key":"fixture-three" clientSecret=fixture-four',
      "Authorization: Basic Zml4dHVyZS1maXZl",
      "cookie: a=fixture-six b=fixture-seven",
      '{"Authorization":"Basic Zml4dHVyZS1laWdodA==","cookie":"a=fixture-nine b=fixture-ten"}',
    ].join("\n");
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: secrets }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(await translateText(secrets, context)).toBeNull();
    mocks.fetch.mockRejectedValueOnce(new Error(secrets));
    expect(await translateText(secrets, context)).toBeNull();
    await waitForLogs(2);
    expect(JSON.stringify(attributes())).not.toMatch(
      /fixture-(?:one|two|three|four|six|seven|nine|ten)|Zml4dHVyZS1maXZl|Zml4dHVyZS1laWdodA==/
    );
    expect(attributes().every((value) => String(value.input_preview).includes("[REDACTED]"))).toBe(
      true
    );
    expect(attributes().find((value) => value.provider_error)?.provider_error).toContain(
      "[REDACTED]"
    );
    expect(attributes().find((value) => value.error_message)?.error_message).toContain(
      "[REDACTED]"
    );
  });

  it("registra apenas o ID de correlação do provedor exposto e válido, sem headers novos", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("Service failed", {
        status: 500,
        headers: {
          "Content-Type": "text/plain",
          "x-request-id": "provider-request-42",
          Authorization: "private-secret",
        },
      })
    );
    expect(await translateText("Texto", context)).toBeNull();
    mocks.fetch.mockResolvedValueOnce(
      new Response("Service failed", {
        status: 500,
        headers: { "Content-Type": "text/plain", "x-request-id": "token=private-secret" },
      })
    );
    expect(await translateText("Texto", context)).toBeNull();
    await waitForLogs(2);
    expect(attributes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_request_id_available: true,
          provider_request_id: "provider-request-42",
          provider_request_id_header: "x-request-id",
        }),
        expect.objectContaining({ provider_request_id_available: false }),
      ])
    );
    expect(
      mocks.fetch.mock.calls.every(
        ([, init]) =>
          JSON.stringify(init.headers) === JSON.stringify({ "Content-Type": "application/json" })
      )
    ).toBe(true);
    expect(JSON.stringify(attributes())).not.toContain("private-secret");
  });

  it("reporta o avanço de cada slide durante a tradução", async () => {
    const controller = new AbortController();
    const progresso: Array<[string, number, number]> = [];
    mocks.fetch.mockResolvedValue(new Response("GLOSS", { status: 200 }));

    expect(
      await translateMusic(
        77,
        {
          id_music: 77,
          name: "Música",
          duration: "03:00",
          lyric: [
            { lyric: "Primeiro", order: 1, show_slide: 1 },
            { lyric: "Segundo", order: 2, show_slide: 1 },
          ],
        },
        "pt",
        (stage, done, total) => {
          progresso.push([stage, done, total]);
          // Aborta antes dos bundles: o teste olha só a fase de tradução.
          if (stage === "download") controller.abort();
        },
        "BR",
        controller.signal
      )
    ).toBeNull();

    expect(progresso).toEqual([
      ["translate", 0, 3],
      ["translate", 1, 3],
      ["translate", 2, 3],
      ["translate", 3, 3],
      ["download", 0, 1],
    ]);
  });

  it("reporta o avanço de cada versículo durante a tradução", async () => {
    const controller = new AbortController();
    const progresso: Array<[string, number, number]> = [];
    mocks.fetch.mockResolvedValue(new Response("GLOSS", { status: 200 }));

    expect(
      await translateBibleChapter(
        "NVI",
        { id_bible_book: 43, name: "João", chapters: 21 },
        3,
        { "16": "Dezesseis", "17": "Dezessete" },
        "pt",
        (stage, done, total) => {
          progresso.push([stage, done, total]);
          if (stage === "download") controller.abort();
        },
        "BR",
        controller.signal
      )
    ).toBeNull();

    expect(progresso).toEqual([
      ["translate", 0, 3],
      ["translate", 1, 3],
      ["translate", 2, 3],
      ["translate", 3, 3],
      ["download", 0, 1],
    ]);
  });
});
