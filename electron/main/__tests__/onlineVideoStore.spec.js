// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const { createStore, PARTIAL_MAX_AGE_MS } = require("../onlineVideo/store.js");

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

let dir;
let store;

function put(id, bytes, usedAtMs) {
  const file = store.pathFor(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  if (usedAtMs != null) {
    const t = new Date(usedAtMs);
    fs.utimesSync(file, t, t);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-store-"));
  store = createStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("pathFor / partialDirFor", () => {
  it("resolve dentro do cache, com o ID como nome", () => {
    expect(store.pathFor(A)).toBe(path.join(dir, `${A}.mp4`));
    expect(store.partialDirFor(A)).toBe(path.join(dir, ".partial", A));
  });

  it("recusa ID que escaparia da pasta", () => {
    for (const bad of ["../../etc/pw", "..", "a/b/c/d/e/f", "", "short"]) {
      expect(() => store.pathFor(bad)).toThrow();
      expect(() => store.partialDirFor(bad)).toThrow();
    }
  });
});

describe("has", () => {
  it("é falso sem arquivo e com arquivo vazio, verdadeiro com conteúdo", () => {
    expect(store.has(A)).toBe(false);
    fs.writeFileSync(store.pathFor(A), "");
    expect(store.has(A)).toBe(false);
    put(A, 10);
    expect(store.has(A)).toBe(true);
  });

  it("é falso para ID inválido em vez de lançar", () => {
    expect(store.has("../x")).toBe(false);
  });
});

describe("list / totalSize", () => {
  it("lista só os MP4 com nome de ID, ignorando parciais e estranhos", async () => {
    put(A, 100);
    put(B, 50);
    fs.mkdirSync(path.join(dir, ".partial", C), { recursive: true });
    fs.writeFileSync(path.join(dir, ".partial", C, `${C}.mp4`), "parcial");
    fs.writeFileSync(path.join(dir, "notas.txt"), "x");
    fs.writeFileSync(path.join(dir, "curto.mp4"), "x");
    fs.writeFileSync(path.join(dir, `${C}.mp4.part`), "x");

    const list = await store.list();
    expect(list.map((v) => v.id).sort()).toEqual([A, B]);
    expect(list.find((v) => v.id === A).size).toBe(100);
    expect(await store.totalSize()).toBe(150);
  });

  it("devolve lista vazia quando a pasta ainda não existe", async () => {
    const vazio = createStore(path.join(dir, "nao-existe"));
    expect(await vazio.list()).toEqual([]);
    expect(await vazio.totalSize()).toBe(0);
  });
});

describe("remove / clear", () => {
  it("remove o vídeo e o parcial dele", async () => {
    put(A, 10);
    fs.mkdirSync(store.partialDirFor(A), { recursive: true });
    fs.writeFileSync(path.join(store.partialDirFor(A), "x.part"), "x");
    await store.remove(A);
    expect(fs.existsSync(store.pathFor(A))).toBe(false);
    expect(fs.existsSync(store.partialDirFor(A))).toBe(false);
  });

  it("remover o que não existe não falha", async () => {
    await expect(store.remove(A)).resolves.toBeUndefined();
  });

  it("clear apaga tudo e diz quantos vídeos eram", async () => {
    put(A, 10);
    put(B, 10);
    fs.mkdirSync(store.partialDirFor(C), { recursive: true });
    expect(await store.clear()).toBe(2);
    expect(await store.list()).toEqual([]);
    expect(fs.existsSync(path.join(dir, ".partial"))).toBe(false);
  });
});

describe("touch + evict (menos usado sai primeiro)", () => {
  const T = Date.parse("2026-01-01T00:00:00Z");

  it("descarta os mais antigos até caber", async () => {
    put(A, 100, T);
    put(B, 100, T + 1000);
    put(C, 100, T + 2000);
    const removed = await store.evict({ maxBytes: 150 });
    expect(removed).toEqual([A, B]);
    expect((await store.list()).map((v) => v.id)).toEqual([C]);
  });

  it("não faz nada quando já cabe, nem sem limite definido", async () => {
    put(A, 100, T);
    expect(await store.evict({ maxBytes: 1000 })).toEqual([]);
    expect(await store.evict({ maxBytes: 0 })).toEqual([]);
    expect(await store.evict({ maxBytes: undefined })).toEqual([]);
    expect(store.has(A)).toBe(true);
  });

  it("nunca descarta o que está protegido, mesmo estourando o limite", async () => {
    put(A, 100, T);
    put(B, 100, T + 1000);
    const removed = await store.evict({ maxBytes: 10, inUse: [A] });
    expect(removed).toEqual([B]);
    expect(store.has(A)).toBe(true);
  });

  it("touch salva o vídeo recém-usado do despejo", async () => {
    put(A, 100, T);
    put(B, 100, T + 1000);
    store.touch(A);
    const removed = await store.evict({ maxBytes: 150 });
    expect(removed).toEqual([B]);
    expect(store.has(A)).toBe(true);
  });

  it("touch em arquivo inexistente ou ID inválido não lança", () => {
    expect(() => store.touch(A)).not.toThrow();
    // touch só roda depois de has(), que já recusa ID inválido; aqui ele apenas não faz nada
    expect(() => store.touch("../x")).not.toThrow();
    expect(fs.existsSync(path.join(dir, "..", "x"))).toBe(false);
  });
});

describe("manter (keep)", () => {
  const T = Date.parse("2026-01-01T00:00:00Z");

  it("só dá para manter o que já está no disco", () => {
    expect(store.keep(A)).toBe(false);
    expect(store.isKept(A)).toBe(false);
    put(A, 100, T);
    expect(store.keep(A)).toBe(true);
    expect(store.isKept(A)).toBe(true);
  });

  it("recusa ID inválido sem tocar em nada fora da pasta", () => {
    expect(store.keep("../x")).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("a listagem diz o que é mantido, e a marca não vira vídeo", async () => {
    put(A, 100, T);
    put(B, 100, T);
    store.keep(A);
    const items = (await store.list()).sort((x, y) => x.id.localeCompare(y.id));
    expect(items.map((v) => [v.id, v.kept])).toEqual([[A, true], [B, false]]);
  });

  it("marca sem o vídeo (apagado por fora) não aparece na listagem", async () => {
    put(A, 100, T);
    store.keep(A);
    fs.rmSync(store.pathFor(A));
    expect(await store.list()).toEqual([]);
  });

  it("o despejo nunca leva um vídeo mantido, e ele não conta na cota", async () => {
    put(A, 400, T); // o mais antigo, mas mantido
    put(B, 100, T + 1000);
    put(C, 100, T + 2000);
    store.keep(A);
    // Sem contar o mantido, o cache automático tem 200 bytes: cabe em 250.
    expect(await store.evict({ maxBytes: 250 })).toEqual([]);
    // Estourando a cota do automático, sai o menos usado dele — nunca o mantido.
    expect(await store.evict({ maxBytes: 150 })).toEqual([B]);
    expect(store.has(A)).toBe(true);
    expect(store.has(C)).toBe(true);
  });

  it("remove apaga o vídeo e a marca; baixar de novo não volta mantido", async () => {
    put(A, 100, T);
    store.keep(A);
    await store.remove(A);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith(A))).toEqual([]);
    put(A, 100, T);
    expect(store.isKept(A)).toBe(false);
  });

  it("clear leva também os mantidos e as marcas", async () => {
    put(A, 100, T);
    put(B, 100, T);
    store.keep(A);
    expect(await store.clear()).toBe(2);
    expect(fs.readdirSync(dir).filter((n) => /\.(mp4|keep)$/.test(n))).toEqual([]);
  });
});

describe("sweepPartials", () => {
  it("apaga só parciais com mais de um dia", async () => {
    const now = Date.now();
    const velho = store.partialDirFor(A);
    const novo = store.partialDirFor(B);
    fs.mkdirSync(velho, { recursive: true });
    fs.mkdirSync(novo, { recursive: true });
    const old = new Date(now - PARTIAL_MAX_AGE_MS - 60_000);
    fs.utimesSync(velho, old, old);

    expect(await store.sweepPartials(now)).toBe(1);
    expect(fs.existsSync(velho)).toBe(false);
    expect(fs.existsSync(novo)).toBe(true);
  });

  it("não falha sem pasta de parciais", async () => {
    expect(await store.sweepPartials()).toBe(0);
  });
});
