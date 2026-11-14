// @vitest-environment node
import { createRequire } from "node:module";
import Module from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const updaterPath = require.resolve("../updater.js");
let directory, originalLoad, updater, requests, asset;

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "lj-update-download-"));
  const ext = process.platform === "darwin" ? "dmg" : process.platform === "win32" ? "exe" : "AppImage";
  asset = { name: `app-9.0.0-${process.arch}.${ext}`, size: 10, browser_download_url: "https://github.com/release/installer" };
  requests = [];
  originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => "1.0.0", getPath: () => directory } };
    if (request === "https") return { get: (url, _options, callback) => {
      const req = new EventEmitter();
      req.destroyed = false;
      req.setTimeout = () => req;
      req.destroy = vi.fn((error) => {
        req.destroyed = true;
        if (error) queueMicrotask(() => req.emit("error", error));
        return req;
      });
      if (url.includes("api.github.com")) {
        queueMicrotask(() => {
          const res = new PassThrough();
          res.statusCode = 200; res.headers = {};
          callback(res);
          res.end(JSON.stringify([{ tag_name: "v9.0.0", assets: [asset] }]));
        });
      } else requests.push({ req, callback });
      return req;
    } };
    return originalLoad.call(this, request, ...args);
  };
  delete require.cache[updaterPath];
  updater = require(updaterPath);
  await updater.checkGithubAndSetState();
});

afterEach(() => {
  Module._load = originalLoad;
  delete require.cache[updaterPath];
  vi.restoreAllMocks();
  fs.removeSync(directory);
});

function respond(index = 0) {
  const res = new PassThrough();
  res.statusCode = 200; res.headers = { "content-length": "10" };
  requests[index].callback(res);
  return res;
}

describe("download manual da atualização", () => {
  it("cancela a requisição antes dos headers e descarta resposta tardia sem lançar", async () => {
    const result = updater.downloadPackage().catch((error) => error);
    updater.cancelDownload();
    expect((await result).message).toBe("cancelled");
    expect(requests[0].req.destroy).toHaveBeenCalled();
    expect(() => respond()).not.toThrow();
    expect(updater.status().status).toBe("available");
  });

  it("cancela a transferência e fecha a escrita antes de remover o temporário", async () => {
    const result = updater.downloadPackage().catch((error) => error);
    const res = respond();
    res.write("12345");
    await new Promise((resolve) => setImmediate(resolve));
    updater.cancelDownload();
    expect((await result).message).toBe("cancelled");
    expect(res.destroyed).toBe(true);
    expect(fs.existsSync(path.join(directory, asset.name))).toBe(false);
    expect(fs.existsSync(path.join(directory, `${asset.name}.tmp`))).toBe(false);
    expect(updater.status().status).toBe("available");
  });

  it("publica apenas download completo e compartilha chamadas simultâneas", async () => {
    const first = updater.downloadPackage();
    const second = updater.downloadPackage();
    expect(second).toBe(first);
    expect(requests).toHaveLength(1);
    respond().end("1234567890");
    await expect(first).resolves.toEqual({ ok: true, path: path.join(directory, asset.name) });
    expect(fs.readFileSync(path.join(directory, asset.name), "utf8")).toBe("1234567890");
    expect(updater.status().status).toBe("downloaded");
  });

  it("rejeita conteúdo menor que o asset da release sem substituir o pacote anterior", async () => {
    fs.writeFileSync(path.join(directory, asset.name), "previous package");
    const result = updater.downloadPackage().catch((error) => error);
    respond().end("12345");
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(path.join(directory, asset.name), "utf8")).toBe("previous package");
    expect(fs.existsSync(path.join(directory, `${asset.name}.tmp`))).toBe(false);
  });

  it("falha de conexão durante o corpo encerra a transferência sem publicar o parcial", async () => {
    const result = updater.downloadPackage().catch((error) => error);
    const res = respond();
    res.write("12345");
    await new Promise((resolve) => setImmediate(resolve));
    res.destroy(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
    expect((await result).code).toBe("ECONNRESET");
    expect(updater.status()).toMatchObject({ status: "error", errorKind: "network" });
    expect(fs.existsSync(path.join(directory, asset.name))).toBe(false);
    expect(fs.existsSync(path.join(directory, `${asset.name}.tmp`))).toBe(false);
  });
});
