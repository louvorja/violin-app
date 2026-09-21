// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { EventEmitter } from "events";

const require = createRequire(import.meta.url);

// `progressive.js` é carregado via `createRequire` (módulo CJS nativo do Node), fora
// do pipeline de módulos do Vitest — então `vi.mock("https")` não o alcançaria. Em vez
// disso, espiamos `https.request` no próprio objeto do módulo nativo (o mesmo singleton
// que `progressive.js` obtém com `require("https")`), sem TLS real.
//
// O CDN do googlevideo às vezes responde um pedido de pedaço com um redirecionamento
// (301/302/303/307/308) em vez do próprio pedaço — foi o que causava "HTTP 302" e
// derrubava a trilha. Este teste exercita só a lógica de `httpsRange`: seguir o
// redirecionamento, respeitar o limite, e recusar uma `Location` ausente ou inválida.
const https = require("https");
const { httpsRange } = require("../onlineVideo/progressive.js");

const URL_BASE = "https://rr1---sn-x.googlevideo.com/videoplayback?kind=video";

function fakeResponse({ statusCode, headers = {}, body = Buffer.alloc(0) }) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = vi.fn();
  queueMicrotask(() => {
    if (body.length) res.emit("data", body);
    res.emit("end");
  });
  return res;
}

function fakeRequest() {
  const req = new EventEmitter();
  req.end = vi.fn();
  req.setTimeout = vi.fn();
  req.destroy = vi.fn((err) => {
    if (err) req.emit("error", err);
  });
  return req;
}

/** Cada chamada a `https.request` devolve a próxima resposta da lista (a última se acabar). */
function mockResponses(responses) {
  let call = 0;
  https.request.mockImplementation((_url, _opts, cb) => {
    const def = responses[Math.min(call, responses.length - 1)];
    call++;
    const req = fakeRequest();
    queueMicrotask(() => cb(fakeResponse(def)));
    return req;
  });
}

let requestSpy;

beforeEach(() => {
  requestSpy = vi.spyOn(https, "request");
});

afterEach(() => {
  requestSpy.mockRestore();
});

describe("httpsRange segue redirecionamentos do CDN do googlevideo", () => {
  it("um 302 com Location: busca o pedaço de novo no host novo e entrega os bytes", async () => {
    mockResponses([
      { statusCode: 302, headers: { location: "https://rr2---sn-y.googlevideo.com/videoplayback?kind=video" } },
      { statusCode: 206, headers: { "content-range": "bytes 0-9/100" }, body: Buffer.from("0123456789") },
    ]);
    const result = await httpsRange(URL_BASE, 0, 9);
    expect(result.data.equals(Buffer.from("0123456789"))).toBe(true);
    expect(result.total).toBe(100);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(https.request.mock.calls[1][0]).toBe("https://rr2---sn-y.googlevideo.com/videoplayback?kind=video");
  });

  it("Location relativa é resolvida contra a URL original", async () => {
    mockResponses([
      { statusCode: 307, headers: { location: "/videoplayback?kind=video&redirected=1" } },
      { statusCode: 206, headers: { "content-range": "bytes 0-2/10" }, body: Buffer.from("abc") },
    ]);
    const result = await httpsRange(URL_BASE, 0, 2);
    expect(result.data.equals(Buffer.from("abc"))).toBe(true);
    expect(https.request.mock.calls[1][0]).toBe("https://rr1---sn-x.googlevideo.com/videoplayback?kind=video&redirected=1");
  });

  it("vários redirecionamentos em sequência ainda resolvem, dentro do limite", async () => {
    mockResponses([
      { statusCode: 302, headers: { location: "https://rr2---sn-y.googlevideo.com/v?hop=1" } },
      { statusCode: 302, headers: { location: "https://rr3---sn-z.googlevideo.com/v?hop=2" } },
      { statusCode: 206, headers: { "content-range": "bytes 0-1/5" }, body: Buffer.from("xy") },
    ]);
    const result = await httpsRange(URL_BASE, 0, 1);
    expect(result.data.equals(Buffer.from("xy"))).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(3);
  });

  it("estoura o limite de redirecionamentos: falha com erro de rede, sem loop infinito", async () => {
    https.request.mockImplementation((_url, _opts, cb) => {
      const req = fakeRequest();
      queueMicrotask(() =>
        cb(fakeResponse({ statusCode: 302, headers: { location: "https://rr9---sn-loop.googlevideo.com/v" } }))
      );
      return req;
    });
    await expect(httpsRange(URL_BASE, 0, 9, { maxRedirects: 2 })).rejects.toMatchObject({ kind: "network" });
    expect(https.request).toHaveBeenCalledTimes(3); // a tentativa original + 2 redirecionamentos
  });

  it("redirecionamento sem Location vira erro de HTTP normal, sem seguir para lugar nenhum", async () => {
    mockResponses([{ statusCode: 302, headers: {} }]);
    await expect(httpsRange(URL_BASE, 0, 9)).rejects.toMatchObject({ kind: "network", message: "HTTP 302" });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("Location inválida é recusada em vez de travar a busca do pedaço", async () => {
    // Host IPv6 malformado: `new URL()` sempre lança para isso, sem depender de
    // interpretações ambíguas de uma string relativa qualquer.
    mockResponses([{ statusCode: 302, headers: { location: "http://[invalid" } }]);
    await expect(httpsRange(URL_BASE, 0, 9)).rejects.toMatchObject({ kind: "network" });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("206 direto, sem redirecionamento, continua funcionando como antes", async () => {
    mockResponses([{ statusCode: 206, headers: { "content-range": "bytes 0-3/50" }, body: Buffer.from("data") }]);
    const result = await httpsRange(URL_BASE, 0, 3);
    expect(result.data.equals(Buffer.from("data"))).toBe(true);
    expect(result.total).toBe(50);
    expect(https.request).toHaveBeenCalledTimes(1);
  });
});
