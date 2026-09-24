// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import http from "http";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

/**
 * `checkConnection` sonda mídia e API em paralelo: um único host de mídia
 * fora do ar (CDN lenta, manutenção) não pode, sozinho, marcar a internet
 * como caída quando a API principal está saudável.
 */
describe("download.checkConnection", () => {
  let download;
  const servers = [];

  beforeEach(() => {
    download = require("../download/index.js");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  function startServer(statusCode, delayMs = 0) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.statusCode = statusCode;
        const timer = setTimeout(() => res.end(), delayMs);
        res.on("close", () => clearTimeout(timer));
      });
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    });
  }

  it("reporta online quando só o host de arquivos responde", async () => {
    const filesUrl = await startServer(200);
    download.setApiConfig({ filesUrl, apiUrl: "http://127.0.0.1:1" });

    const result = await download.checkConnection();

    expect(result.ok).toBe(true);
  });

  it("reporta online quando o host de arquivos falha mas a API responde", async () => {
    const apiUrl = await startServer(200);
    download.setApiConfig({ filesUrl: "http://127.0.0.1:1", apiUrl });

    const result = await download.checkConnection();

    expect(result.ok).toBe(true);
  });

  it("reporta offline só quando os dois hosts falham", async () => {
    download.setApiConfig({ filesUrl: "http://127.0.0.1:1", apiUrl: "http://127.0.0.1:2" });

    const result = await download.checkConnection();

    expect(result.ok).toBe(false);
  });

  it("trata 5xx como falha mesmo com o servidor respondendo", async () => {
    const filesUrl = await startServer(503);
    download.setApiConfig({ filesUrl, apiUrl: "http://127.0.0.1:1" });

    const result = await download.checkConnection();

    expect(result.ok).toBe(false);
  });

  it("retorna assim que um host responde e cancela o host lento", async () => {
    const filesUrl = await startServer(200, 1000);
    const apiUrl = await startServer(204);
    download.setApiConfig({ filesUrl, apiUrl });

    const startedAt = Date.now();
    const result = await download.checkConnection();

    expect(result.ok).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});

describe("download.startDownload", () => {
  it("reserves the start while asynchronous integrity scanning is pending", async () => {
    const download = require("../download/index.js");
    const integrity = require("../download/integrity.js");
    vi.spyOn(require("../paths.js"), "filesDir").mockReturnValue(path.join(os.tmpdir(), "lj-download-test-files"));
    download.setApiConfig({ filesUrl: "https://example.invalid/files" });
    let finishScan;
    vi.spyOn(integrity, "diff").mockImplementation(() => new Promise((resolve) => {
      finishScan = resolve;
    }));

    const first = download.startDownload([], null);
    await expect(download.startDownload([], null)).rejects.toThrow("Download já em andamento");
    finishScan({ missing: [], damaged: [], ok: [] });
    await expect(first).resolves.toMatchObject({ queued: 0 });
    vi.restoreAllMocks();
  });

  it("rejects unsafe or duplicate IPC entries before filesystem scanning", async () => {
    const download = require("../download/index.js");
    const integrity = require("../download/integrity.js");
    vi.spyOn(require("../paths.js"), "filesDir").mockReturnValue(path.join(os.tmpdir(), "lj-download-test-files"));
    const scan = vi.spyOn(integrity, "diff");
    download.setApiConfig({ filesUrl: "https://api.louvorja.workers.dev/file" });
    const valid = { remote: "/images/capa.jpg", local: "images/capa.jpg", remoteUrl: "https://cdn.louvorja.com/images/capa.jpg" };

    await expect(download.startDownload([{ ...valid, local: "../outside.jpg" }], null)).rejects.toThrow("download files");
    await expect(download.startDownload([valid, valid], null)).rejects.toThrow("destino duplicado");
    expect(scan).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("validates checkFiles with the same boundary as startDownload", async () => {
    const download = require("../download/index.js");
    const integrity = require("../download/integrity.js");
    vi.spyOn(require("../paths.js"), "filesDir").mockReturnValue(path.join(os.tmpdir(), "lj-download-test-files"));
    download.setApiConfig({ filesUrl: "https://api.louvorja.workers.dev/file" });
    const scan = vi.spyOn(integrity, "diff").mockResolvedValue({ missing: [], damaged: [], ok: [] });

    await expect(download.checkFiles([{ remote: "/images/capa.jpg", local: "images/capa.jpg", remoteUrl: "https://cdn.louvorja.com/images/capa.jpg" }])).resolves.toMatchObject({ ok: [] });
    expect(scan).toHaveBeenCalledOnce();
    expect(() => download.checkFiles([{ remote: "/images/capa.jpg", local: "../outside.jpg" }])).toThrow("download files");
    expect(scan).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("hands a validated absolute snapshot to the isolated utility queue", async () => {
    const download = require("../download/index.js");
    const integrity = require("../download/integrity.js");
    const { UtilityQueue } = require("../download/utilityQueue.js");
    const filesDir = path.join(os.tmpdir(), "lj-download-test-files");
    vi.spyOn(require("../paths.js"), "filesDir").mockReturnValue(filesDir);
    vi.spyOn(integrity, "diff").mockImplementation(async (files) => ({ missing: files, damaged: [], ok: [] }));
    let queue;
    vi.spyOn(UtilityQueue.prototype, "start").mockImplementation(function () {
      queue = this;
      this.running = true;
      return Promise.resolve();
    });
    download.setApiConfig({ filesUrl: "https://api.louvorja.workers.dev/file" });
    const entry = { remote: "/images/capa.jpg", local: "images/capa.jpg", remoteUrl: "https://cdn.louvorja.com/images/capa.jpg" };

    await expect(download.startDownload([entry], null)).resolves.toEqual({ queued: 1 });

    expect(queue.config).toMatchObject({ filesDir, baseUrl: "https://api.louvorja.workers.dev/file" });
    expect(queue.queue).toEqual([{ ...entry, local: path.join(filesDir, entry.local) }]);
    queue.emit("queue-done", { downloaded: 1, failed: 0 });
    expect(download.isDownloading()).toBe(false);
    vi.restoreAllMocks();
  });
});
