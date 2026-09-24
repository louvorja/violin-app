// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const https = require("node:https");
const { HttpQueue } = require("../download/httpQueue.js");
const servers = [];
const dirs = [];

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function destination() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lj-redirect-"));
  dirs.push(dir);
  return path.join(dir, "download.bin");
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HttpQueue redirects", () => {
  it("resolves relative Locations and permits exactly three same-origin redirects", async () => {
    const seen = [];
    const baseUrl = await listen((req, res) => {
      seen.push([req.url, req.headers["api-token"]]);
      const redirects = { "/start": "/one", "/one": "nested/two", "/nested/two": "../file" };
      if (redirects[req.url]) res.writeHead(302, { Location: redirects[req.url] }).end();
      else res.end("content");
    });
    const local = await destination();
    const queue = new HttpQueue({ baseUrl, apiToken: "private-token" });

    await queue._downloadOne(`${baseUrl}/start`, local);

    expect(await readFile(local, "utf8")).toBe("content");
    expect(seen).toEqual([
      ["/start", "private-token"], ["/one", "private-token"],
      ["/nested/two", "private-token"], ["/file", "private-token"],
    ]);
    expect(queue._activeReqs.size).toBe(0);
  });

  it("fails a fourth redirect and cleans up the temporary file", async () => {
    let requests = 0;
    const baseUrl = await listen((_req, res) => {
      requests++;
      res.writeHead(302, { Location: `/hop-${requests}` }).end();
    });
    const local = await destination();
    const queue = new HttpQueue({ baseUrl, concurrency: 1 });
    queue.add([{ remote: "/start", local }]);
    const errors = [];
    queue.on("file-error", ({ error }) => errors.push(error));

    await queue.start();

    expect(requests).toBe(4);
    expect(errors).toEqual([expect.stringMatching(/Limite de 3 redirecionamentos/)]);
    expect(await readdir(path.dirname(local))).toEqual([]);
  });

  it("does not send Api-Token to another origin, including a direct CDN URL", async () => {
    const cdnTokens = [];
    const cdnUrl = await listen((req, res) => {
      cdnTokens.push(req.headers["api-token"]);
      res.end("cdn");
    });
    const baseTokens = [];
    const baseUrl = await listen((req, res) => {
      baseTokens.push(req.headers["api-token"]);
      res.writeHead(302, { Location: `${cdnUrl}/file` }).end();
    });
    const queue = new HttpQueue({ baseUrl, apiToken: "private-token" });

    await queue._downloadOne(`${baseUrl}/start`, await destination());
    await queue._downloadOne(`${cdnUrl}/direct`, await destination());

    expect(baseTokens).toEqual(["private-token"]);
    expect(cdnTokens).toEqual([undefined, undefined]);
  });

  it("rejects a non-http Location and an initial non-http URL", async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(302, { Location: "file:///tmp/secret" }).end();
    });
    const queue = new HttpQueue({ baseUrl });
    const local = await destination();

    await expect(queue._downloadOne(`${baseUrl}/start`, local)).rejects.toThrow(/Protocolo de redirect/);
    await expect(queue._downloadOne("file:///tmp/secret", local)).rejects.toThrow(/Protocolo de download/);
  });

  it("rejects HTTPS to HTTP without starting the downgraded request", async () => {
    const req = new EventEmitter();
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    vi.spyOn(https, "get").mockImplementation((_url, _options, callback) => {
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 302;
        response.headers = { location: "http://127.0.0.1:9/file" };
        callback(response);
        response.end();
        req.emit("close");
      });
      return req;
    });
    const queue = new HttpQueue({ baseUrl: "https://example.test", apiToken: "private-token" });

    await expect(queue._downloadOne("https://example.test/start", await destination())).rejects.toThrow(/HTTPS para HTTP/);
    expect(req.setTimeout).toHaveBeenCalledWith(60000, expect.any(Function));
    expect(queue._activeReqs.size).toBe(0);
  });

  it("cancels an active redirected request and removes its temporary file", async () => {
    let requestStarted;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    const slowUrl = await listen((_req, _res) => requestStarted());
    const baseUrl = await listen((_req, res) => {
      res.writeHead(302, { Location: `${slowUrl}/slow` }).end();
    });
    const local = await destination();
    const queue = new HttpQueue({ baseUrl });
    queue.add([{ remote: "/start", local }]);

    const done = queue.start();
    await started;
    queue.cancel();
    await done;

    expect(await readdir(path.dirname(local))).toEqual([]);
    expect(queue._activeReqs.size).toBe(0);
  });
});
