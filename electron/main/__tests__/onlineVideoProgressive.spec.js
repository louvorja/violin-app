// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const { openSession } = require("../onlineVideo/progressive.js");
const { OnlineVideoError } = require("../onlineVideo/runner.js");

const V = "https://rr1---sn-x.googlevideo.com/videoplayback?kind=video";
const A = "https://rr1---sn-x.googlevideo.com/videoplayback?kind=audio";
const CHUNK = 1000;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-prog-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bytes reconhecíveis: um erro de posição aparece na comparação. */
function source(size, seed = 0) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 7 + seed) % 251;
  return b;
}

/**
 * Servidor falso do YouTube: devolve o pedaço pedido de um arquivo em memória, e anota
 * cada pedido — é assim que se conta quantas conexões e quantos bytes de fato saem.
 */
function fakeServer({ video = source(10_000, 1), audio = source(3_000, 2), delay = 0, failWith } = {}) {
  const files = { [V]: video, [A]: audio };
  const log = [];
  let calls = 0;
  const fetchRange = async (url, start, end, { signal } = {}) => {
    const n = calls++;
    log.push({ kind: url === V ? "video" : "audio", start, end });
    if (delay) await sleep(delay);
    if (signal?.aborted) throw new OnlineVideoError("cancelled", "Cancelado");
    const failure = failWith?.(url, start, end, n);
    if (failure) throw failure;
    const data = files[url].subarray(start, end + 1);
    return { data: Buffer.from(data), total: files[url].length };
  };
  return { fetchRange, log, video, audio };
}

function streams(server, extra = {}) {
  return {
    video: { url: V, size: server.video.length },
    audio: { url: A, size: server.audio.length },
    muxed: false,
    ...extra,
  };
}

async function open(server, extra = {}) {
  return openSession({
    id: "T8YHfGrk3ok",
    streams: streams(server, extra.streams),
    dir,
    fetchRange: server.fetchRange,
    chunkBytes: CHUNK,
    retryDelayMs: 1,
    ...extra.opts,
  });
}

const read = async (served) => Buffer.from(await new Response(served.body).arrayBuffer());
/** Leitura que já nasce com o erro capturado: falhar é o esperado, e não pode virar "rejeição solta". */
const readFailing = (served) => read(served).then(() => null, (error) => error);

describe("baixar as trilhas por inteiro", () => {
  it("baixa vídeo e áudio em pedaços e os arquivos ficam idênticos ao original", async () => {
    const server = fakeServer();
    const session = await open(server);
    await session.done;
    expect(fs.readFileSync(session.files.video).equals(server.video)).toBe(true);
    expect(fs.readFileSync(session.files.audio).equals(server.audio)).toBe(true);
    // pedaços do tamanho combinado: 10 de vídeo e 3 de áudio
    expect(server.log.filter((r) => r.kind === "video")).toHaveLength(10);
    expect(server.log.filter((r) => r.kind === "audio")).toHaveLength(3);
    expect(server.log.every((r) => r.end - r.start + 1 <= CHUNK)).toBe(true);
    await session.dispose();
  });

  it("o progresso só sobe e termina em tudo o que há para baixar", async () => {
    const server = fakeServer();
    const seen = [];
    const session = await open(server, { opts: { onProgress: (p) => seen.push(p) } });
    await session.done;
    const haves = seen.map((p) => p.have);
    expect(haves.length).toBeGreaterThan(5);
    for (let i = 1; i < haves.length; i++) expect(haves[i]).toBeGreaterThanOrEqual(haves[i - 1]);
    expect(seen.at(-1)).toEqual({ have: 13_000, total: 13_000 });
    await session.dispose();
  });

  it("as duas trilhas do mesmo formato: uma só quando o arquivo já traz o som", async () => {
    const server = fakeServer();
    const session = await open(server, { streams: { muxed: true, audio: { url: V, size: 10_000 } } });
    await session.done;
    expect(session.muxed).toBe(true);
    expect(session.files.audio).toBe(session.files.video);
    expect(server.log.every((r) => r.kind === "video")).toBe(true);
    await session.dispose();
  });

  it("tamanho desconhecido: pergunta ao servidor (Content-Range) antes de criar o arquivo", async () => {
    const server = fakeServer();
    const session = await open(server, {
      streams: { video: { url: V, size: null }, audio: { url: A, size: null } },
    });
    await session.done;
    expect(server.log[0]).toMatchObject({ start: 0, end: 0 }); // a sonda
    expect(fs.readFileSync(session.files.video).equals(server.video)).toBe(true);
    await session.dispose();
  });

  it("link que não é do googlevideo (ou não é https) é recusado antes de criar qualquer arquivo", async () => {
    const server = fakeServer();
    for (const bad of ["https://evil.example.com/v", "http://rr1.googlevideo.com/v", "file:///etc/passwd", ""]) {
      await expect(open(server, { streams: { video: { url: bad, size: 10 } } })).rejects.toMatchObject({
        kind: "format",
      });
    }
    expect(server.log).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "video.mp4"))).toBe(false);
  });
});

describe("tocar enquanto baixa (Range)", () => {
  it("responde 206 com o trecho certo, mesmo antes de o resto chegar", async () => {
    const server = fakeServer({ delay: 5 });
    const session = await open(server);
    const served = session.serve("video", "bytes=100-1499");
    expect(served.status).toBe(206);
    expect(served.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Length": "1400",
      "Content-Range": "bytes 100-1499/10000",
    });
    expect((await read(served)).equals(server.video.subarray(100, 1500))).toBe(true);
    await session.dispose();
  });

  it("só depois da primeira leitura a cópia consta como lida (um pré-download que ninguém tocou nunca foi lida)", async () => {
    const server = fakeServer();
    const session = await open(server);
    await session.done;
    expect(session.everRead).toBe(false);
    await read(session.serve("audio", "bytes=0-9"));
    expect(session.everRead).toBe(true);
    await session.dispose();
  });

  it("o áudio sai como audio/mp4, da trilha de áudio", async () => {
    const server = fakeServer();
    const session = await open(server);
    const served = session.serve("audio", "bytes=0-99");
    expect(served.headers["Content-Type"]).toBe("audio/mp4");
    expect((await read(served)).equals(server.audio.subarray(0, 100))).toBe(true);
    await session.dispose();
  });

  it("Range aberto (o que o <video> pede primeiro) vai até o fim do arquivo", async () => {
    const server = fakeServer();
    const session = await open(server);
    const served = session.serve("video", "bytes=9000-");
    expect(served.status).toBe(206);
    expect(served.headers["Content-Range"]).toBe("bytes 9000-9999/10000");
    expect((await read(served)).equals(server.video.subarray(9000))).toBe(true);
    await session.dispose();
  });

  it("sem Range devolve o arquivo inteiro com 200", async () => {
    const server = fakeServer();
    const session = await open(server);
    const served = session.serve("video", null);
    expect(served.status).toBe(200);
    expect(served.headers["Content-Length"]).toBe("10000");
    expect((await read(served)).equals(server.video)).toBe(true);
    await session.dispose();
  });

  it("Range além do fim é 416, sem corpo", async () => {
    const server = fakeServer();
    const session = await open(server);
    const served = session.serve("video", "bytes=20000-");
    expect(served.status).toBe(416);
    expect(served.headers["Content-Range"]).toBe("bytes */10000");
    expect(served.body).toBeNull();
    await session.dispose();
  });

  it("Range no fim do arquivo é cortado no tamanho", async () => {
    const server = fakeServer();
    const session = await open(server);
    const served = session.serve("video", "bytes=9990-99999");
    expect(served.headers["Content-Range"]).toBe("bytes 9990-9999/10000");
    expect((await read(served)).length).toBe(10);
    await session.dispose();
  });

  it("uma trilha muda de tamanho em relação à outra: cada uma responde pelo seu", async () => {
    const server = fakeServer();
    const session = await open(server);
    expect(session.serve("video", "bytes=0-0").headers["Content-Range"]).toBe("bytes 0-0/10000");
    expect(session.serve("audio", "bytes=0-0").headers["Content-Range"]).toBe("bytes 0-0/3000");
    await session.done;
    await session.dispose();
  });
});

describe("uma cópia só para todas as janelas", () => {
  it("quatro leitores do mesmo trecho não geram nenhum pedido a mais ao YouTube", async () => {
    const server = fakeServer({ delay: 3 });
    const session = await open(server);
    const readers = await Promise.all(
      [1, 2, 3, 4].map(() => read(session.serve("video", "bytes=0-9999")))
    );
    for (const r of readers) expect(r.equals(server.video)).toBe(true);
    await session.done;
    // 10 pedaços de vídeo, e só: quatro janelas leram e ninguém buscou de novo
    expect(server.log.filter((r) => r.kind === "video")).toHaveLength(10);
    await session.dispose();
  });

  it("nenhum byte é buscado duas vezes, mesmo com saltos no meio", async () => {
    const server = fakeServer({ delay: 2 });
    const session = await open(server);
    const jump = read(session.serve("video", "bytes=7000-7999"));
    const start = read(session.serve("video", "bytes=0-999"));
    await Promise.all([jump, start]);
    await session.done;
    const fetched = server.log.filter((r) => r.kind === "video").map((r) => `${r.start}-${r.end}`);
    expect(new Set(fetched).size).toBe(fetched.length);
    await session.dispose();
  });
});

describe("saltar para um ponto que ainda não chegou (seek)", () => {
  it("o próximo pedaço vem de onde o leitor pediu, sem esperar o resto na fila", async () => {
    const server = fakeServer({ delay: 15 });
    const session = await open(server);
    const served = session.serve("video", "bytes=8000-8999");
    const got = await read(served);
    expect(got.equals(server.video.subarray(8000, 9000))).toBe(true);
    const videoFetches = server.log.filter((r) => r.kind === "video");
    // o pedido em voo é o do começo; o seguinte já é o do ponto pedido
    expect(videoFetches[0].start).toBe(0);
    expect(videoFetches[1].start).toBe(8000);
    await session.dispose();
  });

  it("depois do salto continua dali até o fim e volta para preencher o começo", async () => {
    const server = fakeServer({ delay: 2 });
    const session = await open(server);
    await read(session.serve("video", "bytes=6000-6999"));
    await session.done;
    expect(fs.readFileSync(session.files.video).equals(server.video)).toBe(true);
    const order = server.log.filter((r) => r.kind === "video").map((r) => r.start);
    const afterJump = order.slice(order.indexOf(6000));
    expect(afterJump.slice(0, 4)).toEqual([6000, 7000, 8000, 9000]); // continua adiante
    expect(afterJump.slice(4)).toContain(1000); // e depois volta aos buracos
    await session.dispose();
  });

  it("saltos seguidos vão sempre para o último ponto pedido", async () => {
    const server = fakeServer({ delay: 10 });
    const session = await open(server);
    const a = read(session.serve("video", "bytes=3000-3499"));
    const b = read(session.serve("video", "bytes=9000-9499"));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.equals(server.video.subarray(3000, 3500))).toBe(true);
    expect(rb.equals(server.video.subarray(9000, 9500))).toBe(true);
    await session.dispose();
  });
});

describe("quando algo dá errado", () => {
  it("falha passageira: tenta de novo e o vídeo chega inteiro", async () => {
    let failures = 0;
    const server = fakeServer({
      failWith: (url, start) => (start === 3000 && failures++ < 2 ? new OnlineVideoError("network", "caiu") : null),
    });
    const session = await open(server);
    await session.done;
    expect(failures).toBe(3); // duas falhas e a que deu certo
    expect(fs.readFileSync(session.files.video).equals(server.video)).toBe(true);
    await session.dispose();
  });

  it("link vencido (403): não insiste, a sessão falha e quem espera recebe o erro", async () => {
    const server = fakeServer({
      failWith: (url, start) => (start >= 2000 ? new OnlineVideoError("forbidden", "HTTP 403") : null),
    });
    const session = await open(server);
    const waiting = readFailing(session.serve("video", "bytes=5000-5999"));
    await expect(session.done).rejects.toMatchObject({ kind: "forbidden" });
    expect(await waiting).toBeTruthy();
    expect(server.log.filter((r) => r.start >= 2000 && r.kind === "video").length).toBeLessThanOrEqual(2);
    await session.dispose();
  });

  it("falha que persiste depois das tentativas vira erro de rede", async () => {
    const server = fakeServer({ failWith: () => new OnlineVideoError("network", "sem rede") });
    const session = await open(server);
    await expect(session.done).rejects.toMatchObject({ kind: "network" });
    await session.dispose();
  });

  it("quando uma trilha cai, a outra também para (sozinha não serve para nada)", async () => {
    const server = fakeServer({
      delay: 5,
      failWith: (url) => (url === A ? new OnlineVideoError("forbidden", "HTTP 403") : null),
    });
    const session = await open(server);
    await expect(session.done).rejects.toMatchObject({ kind: "forbidden" });
    const before = server.log.length;
    await sleep(60);
    expect(server.log.length).toBe(before); // ninguém mais busca nada
    await session.dispose();
  });

  it("abort() cancela o download, acorda quem espera e não busca mais nada", async () => {
    const server = fakeServer({ delay: 20 });
    const session = await open(server);
    const waiting = readFailing(session.serve("video", "bytes=9000-9999"));
    session.abort();
    await expect(session.done).rejects.toMatchObject({ kind: "cancelled" });
    expect(await waiting).toBeTruthy();
    const before = server.log.length;
    await sleep(80);
    expect(server.log.length).toBe(before);
    await session.dispose();
  });

  it("um leitor que desiste (a janela fechou) não derruba o download nem deixa leitor pendurado", async () => {
    const server = fakeServer({ delay: 10 });
    const session = await open(server);
    const controller = new AbortController();
    const served = session.serve("video", "bytes=9000-9999", controller.signal);
    const reading = read(served).then(() => null, (error) => error);
    await sleep(5);
    expect(session.readers).toBe(1);
    controller.abort();
    expect(await reading).toBeTruthy();
    await sleep(5);
    expect(session.readers).toBe(0);
    await session.done; // o download segue
    expect(fs.readFileSync(session.files.video).equals(server.video)).toBe(true);
    await session.dispose();
  });

  it("dispose apaga os arquivos e a pasta, e leitores pendentes recebem erro", async () => {
    const server = fakeServer({ delay: 30 });
    const session = await open(server);
    const waiting = readFailing(session.serve("video", "bytes=9000-9999"));
    await sleep(5);
    await session.dispose();
    expect(await waiting).toBeTruthy();
    expect(fs.existsSync(session.files.video)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("disco: o arquivo de cada trilha nasce do tamanho final (o resto é preenchido depois)", async () => {
    const server = fakeServer({ delay: 50 });
    const session = await open(server);
    expect(fs.statSync(session.files.video).size).toBe(10_000);
    expect(fs.statSync(session.files.audio).size).toBe(3_000);
    session.abort();
    await session.dispose();
  });
});
