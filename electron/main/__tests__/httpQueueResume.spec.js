// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { HttpQueue } = require("../download/httpQueue.js");

const servers = [];
const dirs = [];
const PAYLOAD = Buffer.from(Array.from({ length: 6000 }, (_, i) => i % 251));
const ETAG = '"v1"';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function workdir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lj-resume-"));
  dirs.push(dir);
  return dir;
}

/** Servidor com Range e ETag; `cutFirstAt` derruba a primeira conexão no meio do arquivo. */
function mediaServer({ cutFirstAt = null, ignoreRange = false, status = null } = {}) {
  const seen = [];
  let calls = 0;
  const handler = (req, res) => {
    calls += 1;
    seen.push({ range: req.headers.range ?? null, ifRange: req.headers["if-range"] ?? null });
    if (status) {
      res.writeHead(status);
      res.end();
      return;
    }
    const wanted = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (wanted && !ignoreRange && req.headers["if-range"] === ETAG) {
      const start = Number(wanted[1]);
      res.writeHead(206, {
        ETag: ETAG,
        "Content-Length": PAYLOAD.length - start,
        "Content-Range": `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      });
      res.end(PAYLOAD.subarray(start));
      return;
    }
    res.writeHead(200, { ETag: ETAG, "Content-Length": PAYLOAD.length });
    if (cutFirstAt !== null && calls === 1) {
      res.write(PAYLOAD.subarray(0, cutFirstAt));
      setTimeout(() => req.socket.destroy(), 20);
      return;
    }
    res.end(PAYLOAD);
  };
  return { handler, seen };
}

async function run(baseUrl, filesDir, options = {}) {
  const queue = new HttpQueue({ baseUrl, filesDir, concurrency: 1, retryDelaysMs: [0, 0], ...options });
  queue.add([{ remote: "/musics/pt/a.opus", local: "musics/pt/a.opus" }]);
  const events = { done: [], error: [] };
  queue.on("file-done", (e) => events.done.push(e));
  queue.on("file-error", (e) => events.error.push(e));
  const result = new Promise((resolve) => queue.on("queue-done", resolve));
  await queue.start();
  return { summary: await result, events };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HttpQueue — retomada de download interrompido", () => {
  it("conexão que cai no meio é retomada com Range e o arquivo final fica íntegro", async () => {
    const server = mediaServer({ cutFirstAt: 2500 });
    const base = await listen(server.handler);
    const dir = await workdir();

    const { summary, events } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 1, failed: 0 });
    expect(events.error).toEqual([]);
    expect(await readFile(path.join(dir, "musics/pt/a.opus"))).toEqual(PAYLOAD);

    // 1º pedido inteiro; 2º só o resto, com o validador do que já tinha chegado.
    expect(server.seen).toHaveLength(2);
    expect(server.seen[0].range).toBeNull();
    expect(server.seen[1].range).toMatch(/^bytes=\d+-$/);
    expect(Number(/(\d+)/.exec(server.seen[1].range)[1])).toBeGreaterThan(0);
    expect(server.seen[1].ifRange).toBe(ETAG);
    expect(await readdir(path.join(dir, "musics/pt"))).toEqual(["a.opus"]);
  });

  it("servidor que ignora o Range devolve o arquivo inteiro e o resultado continua correto", async () => {
    const server = mediaServer({ cutFirstAt: 1000, ignoreRange: true });
    const base = await listen(server.handler);
    const dir = await workdir();

    const { summary } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 1, failed: 0 });
    expect(await readFile(path.join(dir, "musics/pt/a.opus"))).toEqual(PAYLOAD);
  });

  it("parcial deixado por uma execução anterior é retomado, sem baixar tudo de novo", async () => {
    const server = mediaServer();
    const base = await listen(server.handler);
    const dir = await workdir();
    const target = path.join(dir, "musics/pt");
    await (await import("node:fs/promises")).mkdir(target, { recursive: true });
    await writeFile(path.join(target, "a.opus.tmp"), PAYLOAD.subarray(0, 4000));
    await writeFile(path.join(target, "a.opus.tmp.meta"), JSON.stringify({ etag: ETAG, total: 6000 }));

    const { summary } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 1, failed: 0 });
    expect(server.seen).toEqual([{ range: "bytes=4000-", ifRange: ETAG }]);
    expect(await readFile(path.join(target, "a.opus"))).toEqual(PAYLOAD);
  });

  it("parcial com ETag diferente é descartado e o arquivo novo é baixado inteiro", async () => {
    const server = mediaServer();
    const base = await listen(server.handler);
    const dir = await workdir();
    const target = path.join(dir, "musics/pt");
    await (await import("node:fs/promises")).mkdir(target, { recursive: true });
    await writeFile(path.join(target, "a.opus.tmp"), Buffer.from("lixo de outra versão"));
    await writeFile(path.join(target, "a.opus.tmp.meta"), JSON.stringify({ etag: '"antigo"' }));

    const { summary } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 1, failed: 0 });
    expect(await readFile(path.join(target, "a.opus"))).toEqual(PAYLOAD);
  });

  it("erro definitivo (404) não deixa temporário nem tenta de novo", async () => {
    const server = mediaServer({ status: 404 });
    const base = await listen(server.handler);
    const dir = await workdir();

    const { summary, events } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 0, failed: 1 });
    expect(events.error[0].error).toBe("HTTP 404");
    expect(server.seen).toHaveLength(1);
    const left = await readdir(path.join(dir, "musics/pt")).catch(() => []);
    expect(left).toEqual([]);
  });

  it("falha de servidor esgota as tentativas e guarda o parcial para a próxima vez", async () => {
    let calls = 0;
    const base = await listen((req, res) => {
      calls += 1;
      res.writeHead(200, { ETag: ETAG, "Content-Length": PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, 1500));
      setTimeout(() => req.socket.destroy(), 10);
    });
    const dir = await workdir();

    const { summary, events } = await run(base, dir);

    expect(summary).toEqual({ downloaded: 0, failed: 1 });
    expect(events.error).toHaveLength(1);
    expect(calls).toBe(3);
    const partial = path.join(dir, "musics/pt/a.opus.tmp");
    expect((await stat(partial)).size).toBeGreaterThan(0);
    await expect(stat(path.join(dir, "musics/pt/a.opus"))).rejects.toThrow();
  });
});
