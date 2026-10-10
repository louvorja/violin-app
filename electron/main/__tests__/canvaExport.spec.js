// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

/* Pasta de dados num temporário — mesmo truque dos demais testes do Canva. */
const base = mkdtempSync(join(tmpdir(), "louvorja-canva-export-"));
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { dataDir: () => base },
};

const store = require("../canva/store.js");
const exporter = require("../canva/export.js");

const RAPIDO = { pollMs: 1, maxTentativas: 5 };
/** Escreve arquivo solto dentro de <base>/canva (a pasta já existe). */
const fsWrite = (arquivo, conteudo) => writeFileSync(arquivo, conteudo);
const PDF = "%PDF-1.7\n%%EOF";
const HTML = "<html><body>erro</body></html>";
const URL_DOWNLOAD = "https://export-download.canva.com/x.pdf";

/**
 * Roteia a rede: `api.canva.com` (design/export) e o host de download.
 * `chamadas` devolve a sequência real, que é o que valida o formato da API.
 */
function stubApi({ design, job, download } = {}) {
  const chamadas = [];
  /* Cada chamada de status pode devolver um estado diferente — é o que
     permite simular "pro falhou, regular deu certo" num mesmo caso. */
  let consultas = 0;
  vi.stubGlobal("fetch", (input, init) => {
    const url = String(input?.url ?? input);
    const metodo = (init?.method || "GET").toUpperCase();

    if (!url.startsWith("https://api.canva.com")) {
      chamadas.push({ kind: "download", url });
      return Promise.resolve(new Response(download ?? PDF));
    }
    if (metodo === "POST" && url.endsWith("/exports")) {
      chamadas.push({ kind: "criar", body: JSON.parse(String(init.body)) });
      return Promise.resolve(
        Response.json({ job: { id: "JOB1", status: "in_progress" } })
      );
    }
    if (url.includes("/rest/v1/exports/")) {
      chamadas.push({ kind: "status", url });
      const estado = typeof job === "function" ? job(consultas++) : job;
      return Promise.resolve(
        Response.json(estado ?? { job: { status: "success", urls: [URL_DOWNLOAD] } })
      );
    }
    chamadas.push({ kind: "design", url });
    /* `design` como função deixa o caso responder com o id que foi pedido —
       é o que dois designs distintos no mesmo teste precisam. */
    const payload =
      typeof design === "function"
        ? design(url)
        : (design ?? { design: { id: "D1", title: "Deck", updated_at: 111, page_count: 6 } });
    return Promise.resolve(Response.json(payload));
  });
  return chamadas;
}

const PDF_ESPERADO = join(base, "canva", "D1.pdf");
const META_ESPERADO = join(base, "canva", "D1.json");

beforeEach(async () => {
  /* Cache entre casos: sem limpar, todo o resto leria o PDF do primeiro teste. */
  rmSync(join(base, "canva"), { recursive: true, force: true });
  await store.setToken({
    access_token: "ACESSO",
    refresh_token: "R",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("exportarPdf — o caminho do FreeShow adaptado", () => {
  it("design → job → download, e grava o PDF com a meta do updated_at", async () => {
    const chamadas = stubApi();

    const r = await exporter.exportarPdf("D1", RAPIDO);

    expect(r).toMatchObject({ ok: true, cached: false, title: "Deck", pageCount: 6 });
    expect(r.path).toBe(PDF_ESPERADO);

    expect(existsSync(PDF_ESPERADO)).toBe(true);
    expect(readFileSync(PDF_ESPERADO, "utf8").startsWith("%PDF-")).toBe(true);
    expect(JSON.parse(readFileSync(META_ESPERADO, "utf8")).updatedAt).toBe(111);

    /* Sequência e formato: o POST precisa pedir PDF, não PNG. */
    expect(chamadas.map((c) => c.kind)).toEqual(["design", "criar", "status", "download"]);
    const post = chamadas.find((c) => c.kind === "criar");
    /*
     * `export_quality` é pedido de propósito: sem ele a API assume `regular`
     * em silêncio e o operador não sabe o que está recebendo.
     */
    expect(post.body).toEqual({
      design_id: "D1",
      format: { type: "pdf", export_quality: "regular" },
    });
    expect(r.quality).toBe("regular");
    expect(r.qualityFallback).toBe(false);
    expect(JSON.parse(readFileSync(META_ESPERADO, "utf8"))).toMatchObject({
      exportQuality: "regular",
      qualityUsed: "regular",
    });
  });

  it("segunda vez usa o cache: nenhum job novo", async () => {
    const chamadas = stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    chamadas.length = 0;

    const r = await exporter.exportarPdf("D1", RAPIDO);

    expect(r.cached).toBe(true);
    expect(r.path).toBe(PDF_ESPERADO);
    expect(chamadas.filter((c) => c.kind === "criar")).toHaveLength(0);
    /* Só o `design` é consultado — é ele que traz o updated_at do cache. */
    expect(chamadas.map((c) => c.kind)).toEqual(["design"]);
  });

  it("editou no Canva → updated_at muda → exporta de novo", async () => {
    const primeira = stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    expect(primeira.filter((c) => c.kind === "criar")).toHaveLength(1);

    const segunda = stubApi({
      design: { design: { id: "D1", title: "Deck", updated_at: 222, page_count: 7 } },
    });
    const r = await exporter.exportarPdf("D1", RAPIDO);

    expect(r.cached).toBe(false);
    expect(segunda.filter((c) => c.kind === "criar")).toHaveLength(1);
    expect(JSON.parse(readFileSync(META_ESPERADO, "utf8")).updatedAt).toBe(222);
  });

  it("job falhou → erro legível, nada no disco", async () => {
    stubApi({
      job: { job: { status: "failed", error: { code: "license_required", message: "Elementos premium." } } },
    });

    await expect(exporter.exportarPdf("D1", RAPIDO)).rejects.toMatchObject({
      code: "export_failed",
      message: "Elementos premium.",
    });
    expect(existsSync(PDF_ESPERADO)).toBe(false);
  });

  it("job nunca termina → export_timeout", async () => {
    stubApi({ job: { job: { status: "in_progress" } } });

    await expect(exporter.exportarPdf("D1", { pollMs: 1, maxTentativas: 3 })).rejects.toMatchObject({
      code: "export_timeout",
    });
  });

  it("o Canva devolveu mais de um arquivo → export_shape (não projeta só a 1ª)", async () => {
    stubApi({ job: { job: { status: "success", urls: ["https://x/a.pdf", "https://x/b.pdf"] } } });

    await expect(exporter.exportarPdf("D1", RAPIDO)).rejects.toMatchObject({
      code: "export_shape",
    });
    expect(existsSync(PDF_ESPERADO)).toBe(false);
  });

  it("download que não é PDF não é gravado", async () => {
    stubApi({ download: HTML });

    await expect(exporter.exportarPdf("D1", RAPIDO)).rejects.toMatchObject({
      code: "download_not_pdf",
    });
    expect(existsSync(PDF_ESPERADO)).toBe(false);
  });
});

describe("alvos do design", () => {
  it("sanitiza o id antes de virar nome de arquivo", () => {
    const alvos = exporter.alvosDoDesign("../../etc/passwd");
    const nome = basename(alvos.pdf);
    expect(nome).toBe("______etc_passwd.pdf");
    expect(nome).not.toContain("/");
    expect(alvos.pdf.startsWith(join(base, "canva"))).toBe(true);
  });
});

describe("baixar — fronteira de tamanho e de formato", () => {
  const destino = join(base, "canva", "grande.pdf");

  it("arquivo maior que o teto não é gravado", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(PDF, { headers: { "content-length": String(exporter.MAX_PDF_BYTES + 1) } })
      )
    );

    await expect(exporter.baixar("https://export-download.canva.com/g.pdf", destino)).rejects.toMatchObject({
      code: "download_too_big",
    });
    expect(existsSync(destino)).toBe(false);
  });

  it("PDF dentro do teto é gravado", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(PDF)));

    const bytes = await exporter.baixar("https://export-download.canva.com/o.pdf", destino);

    expect(bytes).toBe(Buffer.byteLength(PDF, "utf8"));
    expect(readFileSync(destino, "utf8").startsWith("%PDF-")).toBe(true);
  });

  it("status HTTP ruim vira código, não exceção solta", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("negado", { status: 403 })));

    await expect(exporter.baixar("https://export-download.canva.com/n.pdf", destino)).rejects.toMatchObject({
      code: "download_403",
    });
    expect(existsSync(destino)).toBe(false);
  });
});

describe("escopo do export", () => {
  it("token sem design:content:read falha antes de criar o job", async () => {
    /* É o caso reportado: o portal tinha a caixa marcada, mas a URL de
       consentimento nunca pediu o escopo, então o token não o tem. */
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read design:meta:read profile:read",
    });
    const chamadas = stubApi();

    await expect(exporter.exportarPdf("D1", RAPIDO)).rejects.toMatchObject({
      code: "missing_scope",
    });

    /*
     * O `design` acontece antes — é ele que traz o `updated_at` do cache, e
     * esse endpoint pede design:meta:read, que o token TEM. O que não pode
     * acontecer é o job.
     */
    expect(chamadas.map((c) => c.kind)).toEqual(["design"]);
    expect(existsSync(PDF_ESPERADO)).toBe(false);
  });

  it("com o escopo concedido segue normal", async () => {
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read design:content:read design:meta:read profile:read",
    });
    stubApi();

    const r = await exporter.exportarPdf("D1", RAPIDO);
    expect(r.ok).toBe(true);
  });

  it("token que não declara `scope` deixa o Canva decidir (não bloqueamos)", async () => {
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    stubApi();

    const r = await exporter.exportarPdf("D1", RAPIDO);
    expect(r.ok).toBe(true);
  });

  it("PDF já em cache não gasta export — nem precisa do escopo", async () => {
    /* 1) token COM o escopo: exporta e grava o cache. */
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read design:content:read",
    });
    const primeiro = stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    expect(primeiro.filter((c) => c.kind === "criar")).toHaveLength(1);

    /* 2) token trocado por um SEM o escopo: o disco resolve, nenhum job. */
    await store.setToken({
      access_token: "B",
      refresh_token: "R2",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read",
    });
    const segundo = stubApi();
    const r = await exporter.exportarPdf("D1", RAPIDO);

    expect(r.cached).toBe(true);
    expect(segundo.filter((c) => c.kind === "criar")).toHaveLength(0);
    expect(r.path).toBe(PDF_ESPERADO);
  });
});

describe("qualidade do export", () => {
  it("sem preferência pede `regular`; com `pro` pede `pro`", async () => {
    const um = stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    expect(um.find((c) => c.kind === "criar").body.format.export_quality).toBe("regular");

    rmSync(join(base, "canva"), { recursive: true, force: true });
    const dois = stubApi();
    await exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" });
    expect(dois.find((c) => c.kind === "criar").body.format.export_quality).toBe("pro");
  });

  it("pro recusado por licença → refaz em regular e sinaliza o fallback", async () => {
    const chamadas = stubApi({
      job: (n) =>
        n === 0
          ? {
              job: {
                status: "failed",
                error: { code: "license_required", message: "Elementos premium." },
              },
            }
          : { job: { status: "success", urls: [URL_DOWNLOAD] } },
    });

    const r = await exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" });

    expect(r.ok).toBe(true);
    expect(r.quality).toBe("regular");
    expect(r.qualityFallback).toBe(true);
    expect(chamadas.filter((c) => c.kind === "criar").map((c) => c.body.format.export_quality))
      .toEqual(["pro", "regular"]);
    /*
     * A meta guarda a PEDIDA (é ela que decide a validade do cache) e a usada
     * (é ela que explica ao operador o que ele está vendo).
     */
    expect(JSON.parse(readFileSync(META_ESPERADO, "utf8"))).toMatchObject({
      exportQuality: "pro",
      qualityUsed: "regular",
    });
  });

  it("falha que não é de licença não gera segunda tentativa", async () => {
    const chamadas = stubApi({
      job: { job: { status: "failed", error: { code: "internal_failure", message: "ops" } } },
    });

    await expect(
      exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" })
    ).rejects.toMatchObject({ code: "export_failed" });

    expect(chamadas.filter((c) => c.kind === "criar")).toHaveLength(1);
    expect(existsSync(PDF_ESPERADO)).toBe(false);
  });

  it("em `regular` não há o que reprocessar", async () => {
    const chamadas = stubApi({
      job: { job: { status: "failed", error: { code: "license_required", message: "x" } } },
    });

    await expect(exporter.exportarPdf("D1", RAPIDO)).rejects.toMatchObject({ code: "export_failed" });
    expect(chamadas.filter((c) => c.kind === "criar")).toHaveLength(1);
  });

  it("trocar a qualidade invalida o cache", async () => {
    const chamadas = stubApi();
    await exporter.exportarPdf("D1", RAPIDO);

    const r = await exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" });

    expect(r.cached).toBe(false);
    expect(chamadas.filter((c) => c.kind === "criar").map((c) => c.body.format.export_quality))
      .toEqual(["regular", "pro"]);
  });

  it("o cache devolve a qualidade com que aquele PDF saiu", async () => {
    stubApi();
    await exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" });

    const r = await exporter.exportarPdf("D1", { ...RAPIDO, exportQuality: "pro" });

    expect(r.cached).toBe(true);
    expect(r.quality).toBe("pro");
    expect(r.qualityFallback).toBeFalsy();
  });
});

describe("cache de PDF (selo da lista)", () => {
  it("sem pasta ainda devolve mapa vazio", async () => {
    await expect(exporter.listarCachePdf()).resolves.toEqual({});
  });

  it("depois de exportar, devolve o id e o updatedAt do meta", async () => {
    stubApi();
    await exporter.exportarPdf("D1", RAPIDO);

    expect(await exporter.listarCachePdf()).toEqual({ D1: 111 });
  });

  it("meta órfão não é cache: sem o .pdf não há o que selar", async () => {
    stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    /* Download que morreu no meio deixa o meta sozinho. */
    rmSync(PDF_ESPERADO, { force: true });

    expect(await exporter.listarCachePdf()).toEqual({});
  });

  it("id desconhecido devolve mapa vazio, não erro", async () => {
    stubApi();
    await exporter.exportarPdf("D1", RAPIDO);

    expect(await exporter.listarCachePdf()).toEqual({ D1: 111 });
    expect(await exporter.listarCachePdf()).not.toHaveProperty("OUTRO");
  });

  it("limpar apaga o .pdf e o .json, e some do mapa", async () => {
    stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    expect(existsSync(PDF_ESPERADO)).toBe(true);

    await expect(exporter.limparCachePdf("D1")).resolves.toEqual({ ok: true });

    expect(existsSync(PDF_ESPERADO)).toBe(false);
    expect(existsSync(META_ESPERADO)).toBe(false);
    expect(await exporter.listarCachePdf()).toEqual({});
  });

  it("limpar sem cache nenhum segue ok — apagar duas vezes não é erro", async () => {
    await expect(exporter.limparCachePdf("D1")).resolves.toEqual({ ok: true });
  });

  it("id não-string ou longo demais é recusado antes de tocar em arquivo", async () => {
    await expect(exporter.limparCachePdf(undefined)).resolves.toMatchObject({
      ok: false,
      code: "invalid_id",
    });
    await expect(exporter.limparCachePdf(null)).resolves.toMatchObject({
      ok: false,
      code: "invalid_id",
    });
    await expect(exporter.limparCachePdf("x".repeat(101))).resolves.toMatchObject({
      ok: false,
      code: "invalid_id",
    });
  });

  it("id com pontos e barras não escapa da pasta do Canva", async () => {
    /*
     * `nomeSeguro` neutraliza (`/` e `.` viram `_`) — é a mesma proteção que
     * o `exportarPdf` usa ao gravar. O alvo segue DENTRO de <dados>/canva.
     */
    const alvos = exporter.alvosDoDesign("../outra-pasta");

    expect(alvos.pdf.startsWith(exporter.pastaCanva() + sep)).toBe(true);
    expect(basename(alvos.pdf)).not.toContain("..");

    await expect(exporter.limparCachePdf("../outra-pasta")).resolves.toEqual({ ok: true });
  });
});

describe("limpar todo o cache", () => {
  /* O id do design ecoa a URL: `/v1/designs/D2` devolve o design D2. */
  const design = (url) => ({
    design: { id: url.split("/").pop(), title: "Deck", updated_at: 111, page_count: 6 },
  });

  it("some com os PDFs e os metas, e conta quantos eram cache", async () => {
    stubApi({ design });
    await exporter.exportarPdf("D1", RAPIDO);
    await exporter.exportarPdf("D2", RAPIDO);
    expect(Object.keys(await exporter.listarCachePdf())).toEqual(["D1", "D2"]);

    const r = await exporter.limparTodoCachePdf();

    /* Conta o PDF, não o arquivo: meta é metade de um cache só. */
    expect(r).toEqual({ ok: true, removidos: 2 });
    expect(await exporter.listarCachePdf()).toEqual({});
    expect(existsSync(PDF_ESPERADO)).toBe(false);
    expect(existsSync(META_ESPERADO)).toBe(false);
  });

  it("meta órfão também sai — não é cache, mas não fica para ninguém", async () => {
    stubApi();
    await exporter.exportarPdf("D1", RAPIDO);
    rmSync(PDF_ESPERADO, { force: true });

    await expect(exporter.limparTodoCachePdf()).resolves.toEqual({ ok: true, removidos: 0 });

    expect(existsSync(META_ESPERADO)).toBe(false);
  });

  it("pasta que não existe é cache vazio, não erro", async () => {
    rmSync(join(base, "canva"), { recursive: true, force: true });

    await expect(exporter.limparTodoCachePdf()).resolves.toEqual({ ok: true, removidos: 0 });
  });

  it("arquivo de fora do cache fica onde está — só .pdf e .json saem", async () => {
    mkdirSync(join(base, "canva"), { recursive: true });
    const alheio = join(base, "canva", "notas.txt");
    fsWrite(alheio, "não me apaga");

    await expect(exporter.limparTodoCachePdf()).resolves.toEqual({ ok: true, removidos: 0 });

    expect(existsSync(alheio)).toBe(true);
  });
});
