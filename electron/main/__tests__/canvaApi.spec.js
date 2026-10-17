// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const base = mkdtempSync(join(tmpdir(), "louvorja-canva-api-"));
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { dataDir: () => base },
};

const store = require("../canva/store.js");
const api = require("../canva/api.js");

const realFetch = globalThis.fetch;

/** Grava a requisição e devolve a resposta fabricada. */
function stubApi(handler) {
  const chamadas = [];
  vi.stubGlobal("fetch", (input, init) => {
    const url = String(input?.url ?? input);
    if (!url.startsWith("https://api.canva.com")) return realFetch(input, init);
    const { status = 200, resposta } = handler(url, init);
    chamadas.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(resposta), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("normalização de itens de pasta", () => {
  it("reconhece pasta, design e imagem", () => {
    expect(
      api.normalizeFolderItem({ type: "folder", folder: { id: "F1", name: "Cultos" } })
    ).toEqual({ type: "folder", id: "F1", name: "Cultos", thumb: null });

    expect(
      api.normalizeFolderItem({
        type: "design",
        design: { id: "D1", title: "Slide Páscoa", page_count: "4" },
      })
    ).toEqual({ type: "design", id: "D1", name: "Slide Páscoa", thumb: null, pageCount: 4 });

    const imagem = api.normalizeFolderItem({
      type: "image",
      image: { id: "I1", name: "Fundo", thumbnail: { url: "https://document-export.canva.com/a.png" } },
    });
    expect(imagem).toMatchObject({ type: "image", id: "I1", name: "Fundo" });
    /* Sem view_url própria: quem abre é o thumbnail. */
    expect(imagem.url).toBe(imagem.thumb);
  });

  it("descarta o que não tem forma de item", () => {
    const invalidos = [
      null,
      undefined,
      42,
      "design",
      {},
      { type: "design" },
      { type: "design", design: {} },
      { type: "design", design: { title: "sem id" } },
      { type: "unknown", folder: { id: "F" } },
    ];
    for (const bruto of invalidos) expect(api.normalizeFolderItem(bruto)).toBeNull();
    expect(api.normalizeItems(invalidos, api.normalizeFolderItem)).toEqual([]);
  });

  it("nome vazio cai no fallback e nome gigante é cortado", () => {
    expect(api.normalizeFolderItem({ type: "folder", folder: { id: "F", name: "  " } }).name).toBe(
      "Pasta sem nome"
    );
    expect(
      api.normalizeFolderItem({ type: "folder", folder: { id: "F", name: "x".repeat(500) } }).name
    ).toHaveLength(200);
    expect(
      api.normalizeFolderItem({ type: "folder", folder: { id: "F", name: 12345 } }).name
    ).toBe("Pasta sem nome");
  });

  it("só aceita thumbnail https", () => {
    expect(
      api.normalizeFolderItem({
        type: "design",
        design: { id: "D", thumbnail: { url: "http://inseguro.com/x.png" } },
      }).thumb
    ).toBeNull();
    expect(
      api.normalizeFolderItem({
        type: "design",
        design: { id: "D", thumbnail: { url: "javascript:alert(1)" } },
      }).thumb
    ).toBeNull();
    expect(
      api.normalizeFolderItem({
        type: "design",
        design: { id: "D", thumbnail: { url: "https://document-export.canva.com/x.png" } },
      }).thumb
    ).toBe("https://document-export.canva.com/x.png");
  });
});

describe("limites de consulta", () => {
  it("clampLimit respeita 1..100", () => {
    expect(api.clampLimit(undefined)).toBe(100);
    expect(api.clampLimit("abc")).toBe(100);
    expect(api.clampLimit(0)).toBe(1);
    expect(api.clampLimit(-5)).toBe(1);
    expect(api.clampLimit(500)).toBe(100);
    expect(api.clampLimit(37.9)).toBe(37);
  });

  it("ownedOwnership só aceita os três valores do Canva", () => {
    expect(api.ownedOwnership("any")).toBe("any");
    expect(api.ownedOwnership("owned")).toBe("owned");
    expect(api.ownedOwnership("shared")).toBe("shared");
    expect(api.ownedOwnership("todos")).toBe("any");
    expect(api.ownedOwnership(undefined)).toBe("any");
  });
});

describe("listagem", () => {
  it("raiz usa root e manda os item_types que o portal espera", async () => {
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const chamadas = stubApi(() => ({
      resposta: { items: [{ type: "folder", folder: { id: "F1", name: "A" } }] },
    }));

    const resultado = await api.listFolderItems({ limit: 25 });

    expect(chamadas[0].url).toContain("/rest/v1/folders/root/items");
    const url = new URL(chamadas[0].url);
    expect(url.searchParams.get("item_types")).toBe("design,folder,image");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("sort_by")).toBe("title_ascending");
    expect(chamadas[0].init.headers.Authorization).toBe("Bearer ACESSO");
    expect(resultado).toEqual({
      items: [{ type: "folder", id: "F1", name: "A", thumb: null }],
      continuation: null,
    });
  });

  it("continuação e designs compartilhados chegam na query", async () => {
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const chamadas = stubApi(() => ({
      resposta: { items: [{ id: "D1", title: "Compartilhado" }], continuation: "TOKEN-2" },
    }));

    const resultado = await api.listDesigns({ ownership: "shared", continuation: "TOKEN-1" });

    const url = new URL(chamadas[0].url);
    expect(url.pathname).toBe("/rest/v1/designs");
    expect(url.searchParams.get("ownership")).toBe("shared");
    expect(url.searchParams.get("continuation")).toBe("TOKEN-1");
    expect(resultado.continuation).toBe("TOKEN-2");
    expect(resultado.items).toEqual([
      { type: "design", id: "D1", name: "Compartilhado", thumb: null, pageCount: 0 },
    ]);
  });

  it("resposta 403 vira código de erro legível", async () => {
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    stubApi(() => ({ status: 403, resposta: { message: "Escopo ausente" } }));

    await expect(api.listFolderItems({})).rejects.toMatchObject({
      code: "canva_403",
      message: "Escopo ausente",
    });
  });
});

describe("view_url", () => {
  const tokenValido = () =>
    store.setToken({
      access_token: "ACESSO",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

  it("pede o design de novo — o da lista expira", async () => {
    await tokenValido();
    const chamadas = stubApi(() => ({
      resposta: { design: { id: "D9", urls: { view_url: "https://www.canva.com/design/D9/view" } } },
    }));

    const { url } = await api.getDesignViewUrl("D9");

    expect(chamadas[0].url).toContain("/rest/v1/designs/D9");
    expect(url).toBe("https://www.canva.com/design/D9/view");
  });

  it("sem link de visualização, erro em vez de URL vazia", async () => {
    await tokenValido();
    stubApi(() => ({ resposta: { design: { id: "D9", urls: {} } } }));

    await expect(api.getDesignViewUrl("D9")).rejects.toMatchObject({ code: "no_view_url" });
  });

  it("id vazio nem sai do main", async () => {
    await tokenValido();
    const chamadas = stubApi(() => ({ resposta: {} }));

    await expect(api.getDesignViewUrl("  ")).rejects.toMatchObject({ code: "invalid_id" });
    expect(chamadas).toHaveLength(0);
  });
});
