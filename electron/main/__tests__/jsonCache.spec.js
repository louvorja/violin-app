// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import http from "node:http";
import { mkdtempSync, rmSync, utimesSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const base = mkdtempSync(join(tmpdir(), "louvorja-jsoncache-"));
let cacheRoot = base;

// `paths` fala com o Electron, que não existe aqui.
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { jsonCacheDir: () => join(cacheRoot, "json_db") },
};

const netHealth = require("../netHealth.js");
const jsonCache = require("../jsonCache.js");

/**
 * O que separa "a rede falhou" de "o servidor respondeu mal" decide duas coisas
 * que o operador vê: se o app se declara offline e se aparece um diálogo. O
 * servidor é de verdade (porta local) porque é o único jeito de exercitar o
 * `https.get` sem trocar o módulo por um dublê que concordaria com tudo.
 */
describe("jsonCache — falha de rede × resposta ruim", () => {
  let server;
  let baseUrl;
  let resposta;
  let portaMorta;

  beforeAll(async () => {
    server = http.createServer((req, res) => resposta(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/json_db`;

    // Porta que já foi de alguém e foi devolvida: conectar nela dá ECONNREFUSED.
    const efemero = http.createServer();
    await new Promise((resolve) => efemero.listen(0, "127.0.0.1", resolve));
    portaMorta = `http://127.0.0.1:${efemero.address().port}/json_db`;
    await new Promise((resolve) => efemero.close(resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    cacheRoot = base;
    netHealth._reset();
    for (const metodo of ["log", "warn", "error"]) {
      vi.spyOn(console, metodo).mockImplementation(() => {});
    }
  });

  afterEach(() => vi.restoreAllMocks());

  const responde = (status, corpo = "{}") => {
    resposta = (_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(corpo);
    };
  };

  it("uma resposta em curso grava na pasta escolhida durante a espera da rede", async () => {
    let send;
    resposta = (_req, res) => { send = () => { res.writeHead(200); res.end('{"current":true}'); }; };
    const response = jsonCache.fetchJson("/folder_changed", baseUrl);
    await vi.waitFor(() => expect(send).toBeTypeOf("function"));
    cacheRoot = join(base, "chosen");
    send();
    expect(await response).toMatchObject({ status: 200, fromCache: false });
    expect(existsSync(join(cacheRoot, "json_db", "folder_changed.json"))).toBe(true);
    expect(existsSync(join(base, "json_db", "folder_changed.json"))).toBe(false);
  });

  it("resposta 5xx sem cache propaga o status e não é falha de rede", async () => {
    responde(500, "{}");

    const erro = await jsonCache.fetchJson("/pt_a", baseUrl).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("HTTP 500");
    expect(erro.networkFailure).toBeUndefined();
    expect(netHealth.status().online).toBe(true);
  });

  it("fresh ignora o JSON ainda dentro das 24 horas e conserva o anterior se a rede cair", async () => {
    responde(200, '{"version":1}');
    await jsonCache.fetchJson("/fresh_test", baseUrl);
    responde(200, '{"version":2}');
    const cached = await jsonCache.fetchJson("/fresh_test", baseUrl);
    expect(JSON.parse(cached.body)).toEqual({ version: 1 });
    const fresh = await jsonCache.fetchJson("/fresh_test", baseUrl, {}, { fresh: true });
    expect(JSON.parse(fresh.body)).toEqual({ version: 2 });
    expect(fresh.fromCache).toBe(false);
    const offline = await jsonCache.fetchJson("/fresh_test", portaMorta, {}, { fresh: true });
    expect(JSON.parse(offline.body)).toEqual({ version: 2 });
  });

  it("um 500 não adianta a queda: só a segunda falha de rede seguida declara offline", async () => {
    responde(500, "{}");
    await jsonCache.fetchJson("/pt_b", baseUrl).catch(() => {});

    await jsonCache.fetchJson("/pt_c", portaMorta).catch(() => {});
    expect(netHealth.status().online).toBe(true);

    await jsonCache.fetchJson("/pt_d", portaMorta).catch(() => {});
    expect(netHealth.status().online).toBe(false);
  });

  it("sem resposta nenhuma o erro sai marcado como falha de rede", async () => {
    const erro = await jsonCache.fetchJson("/pt_e", portaMorta).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.networkFailure).toBe(true);
  });

  it("sem rede e com cache velho, serve o cache em vez de falhar", async () => {
    responde(200, JSON.stringify([{ id: 1 }]));
    await jsonCache.fetchJson("/pt_f", baseUrl);
    const arquivo = join(base, "json_db", "pt_f.json");
    expect(existsSync(arquivo)).toBe(true);
    const antigo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(arquivo, antigo, antigo);

    const resultado = await jsonCache.fetchJson("/pt_f", portaMorta);

    expect(resultado.fromCache).toBe(true);
    expect(resultado.status).toBe(200);
    expect(JSON.parse(resultado.body.toString("utf-8"))).toEqual([{ id: 1 }]);
  });
});

describe("jsonCache — preservação offline quando o app é atualizado", () => {
  const { mkdirSync, writeFileSync, readdirSync, readFileSync } = require("node:fs");

  function novoCache() {
    cacheRoot = mkdtempSync(join(tmpdir(), "louvorja-purge-"));
    const dir = join(cacheRoot, "json_db");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("primeira execução com cache antigo: expira sem apagar e registra a versão", async () => {
    const dir = novoCache();
    writeFileSync(join(dir, "music_1.json"), "{}");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "album_1.json"), "{}");

    const result = await jsonCache.expireOnAppUpdate("2.0.0-beta.17");

    expect(result).toEqual({ expired: 2 });
    expect(readdirSync(dir).sort()).toEqual([".app-version", "music_1.json", "sub"]);
    expect(statSync(join(dir, "music_1.json")).mtimeMs).toBe(0);
    expect(readFileSync(join(dir, "sub", "album_1.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(dir, ".app-version"), "utf8")).toBe("2.0.0-beta.17");
  });

  it("mesma versão: não mexe no cache", async () => {
    const dir = novoCache();
    writeFileSync(join(dir, ".app-version"), "2.0.0-beta.17");
    writeFileSync(join(dir, "music_1.json"), "{}");

    const result = await jsonCache.expireOnAppUpdate("2.0.0-beta.17");

    expect(result).toEqual({ expired: 0 });
    expect(readdirSync(dir).sort()).toEqual([".app-version", "music_1.json"]);
  });

  it("versão nova: expira de novo e atualiza o registro", async () => {
    const dir = novoCache();
    writeFileSync(join(dir, ".app-version"), "2.0.0-beta.16");
    writeFileSync(join(dir, "music_1.json"), "{}");

    const result = await jsonCache.expireOnAppUpdate("2.0.0-beta.17");

    expect(result).toEqual({ expired: 1 });
    expect(readFileSync(join(dir, ".app-version"), "utf8")).toBe("2.0.0-beta.17");
  });

  it("pasta ainda inexistente: cria e registra, sem erro", async () => {
    cacheRoot = mkdtempSync(join(tmpdir(), "louvorja-purge-"));

    const result = await jsonCache.expireOnAppUpdate("2.0.0-beta.17");

    expect(result).toEqual({ expired: 0 });
    expect(existsSync(join(cacheRoot, "json_db", ".app-version"))).toBe(true);
  });
});
