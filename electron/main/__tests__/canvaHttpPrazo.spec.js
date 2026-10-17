// @vitest-environment node
/**
 * Prazo CANCELÁVEL do transporte do Canva.
 *
 * A versão anterior usava `AbortSignal.timeout()`, cujo timer NÃO pode ser
 * cancelado: ele sobrevive à resposta e dispara depois dela. Com o poll de
 * exportação (uma requisição por segundo, até 60), isso empilha timers de 15 s
 * que abortam corpos já lidos — e o undici fecha um stream já fechado
 * (`ERR_INVALID_STATE`), num tick, fora do `try/catch` de quem chamou, sem um
 * único quadro do nosso código no stack.
 *
 * O contrato medido aqui: quando a requisição termina, não sobra timer nenhum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { comPrazo, comPrazoJson } = require("../canva/http.js");

const realFetch = globalThis.fetch;

/** Resposta JSON mínima, como o Canva devolve. */
function respostaJson(corpo = { ok: 1 }, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `fetch` que devolve a resposta fabricada. */
function stubFetch(resposta = () => respostaJson()) {
  vi.stubGlobal("fetch", () => Promise.resolve(typeof resposta === "function" ? resposta() : resposta));
}

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("fetch", realFetch);
});

describe("comPrazo: o prazo morre com a requisição", () => {
  it("depois de uma requisição bem-sucedida, nenhum timer sobra", async () => {
    const resultado = await comPrazo(
      "https://api.canva.com/rest/v1/designs",
      {},
      15_000,
      async (res) => ({ status: res.status })
    );

    expect(resultado).toEqual({ status: 200 });
    /* Com AbortSignal.timeout, aqui ainda haveria um timer de 15 s de pé. */
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("o caminho do JSON também não deixa timer", async () => {
    const { json } = await comPrazoJson("https://api.canva.com/rest/v1/exports/j1", {}, 15_000);

    expect(json).toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("o poll de exportação não empilha timers", async () => {
    /* 10 requisições de 1 em 1 segundo: era o que deixava a pilha de timers. */
    for (let i = 0; i < 10; i++) {
      await comPrazoJson("https://api.canva.com/rest/v1/exports/j1", {}, 15_000);
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(vi.getTimerCount()).toBe(0);
  });

  it("o corpo não lido (status de erro) é cancelado em vez de vazar", async () => {
    const resposta = respostaJson({ erro: 1 }, 403);
    const cancelado = vi.fn(() => Promise.resolve());
    vi.spyOn(resposta.body, "cancel").mockImplementation(cancelado);

    stubFetch(() => resposta);
    await expect(
      comPrazo(
        "https://api.canva.com/rest/v1/designs",
        {},
        15_000,
        async (res) => {
          /* Sai por status sem tocar no corpo — como o teto de tamanho do download. */
          if (!res.ok) throw new Error(`Erro ${res.status}`);
        }
      )
    ).rejects.toThrow("Erro 403");

    expect(cancelado).toHaveBeenCalled();
  });

  it("o prazo ainda corta uma requisição que empaca", async () => {
    /*
     * Socket de verdade: um `Response` de mentira não obedece ao sinal, então
     * só um servidor real prova que o prazo derruba a espera.
     */
    const http = require("node:http");
    /* Socket de verdade: o `beforeEach` deixou um `fetch` fabricado no lugar. */
    vi.stubGlobal("fetch", realFetch);
    const servidor = http.createServer(() => {
      /* Cabeçalhos nunca chegam. */
    });
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${servidor.address().port}/lento`;

    try {
      vi.useRealTimers();
      await expect(comPrazoJson(url, {}, 200)).rejects.toThrow(/não respondeu/);
    } finally {
      servidor.closeAllConnections?.();
      servidor.close();
    }
  });

  it("o prazo cobre o corpo, não só os cabeçalhos", async () => {
    /*
     * O caso que o nome promete: status 200 na hora e corpo que nunca termina.
     * Se o prazo cobrisse só os cabeçalhos, a leitura ficaria pendurada para
     * sempre e a conexão ficaria presa.
     */
    const http = require("node:http");
    vi.stubGlobal("fetch", realFetch);
    const servidor = http.createServer((_q, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"a":'); // começa e nunca fecha
    });
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${servidor.address().port}/corpo`;

    try {
      vi.useRealTimers();
      await expect(
        comPrazo(url, {}, 250, async (res) => Buffer.from(await res.arrayBuffer()).length)
      ).rejects.toThrow(/não respondeu/);
    } finally {
      servidor.closeAllConnections?.();
      servidor.close();
    }
  });
});
