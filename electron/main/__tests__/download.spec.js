// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import http from "http";

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
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  function startServer(statusCode) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.statusCode = statusCode;
        res.end();
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
});
