// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createFileAccess, realPathDeep } = require("../fileAccess.js");

/**
 * Allowlist do IPC de arquivos: só o que está dentro de uma raiz escolhida
 * pelo operador pode ser lido, renomeado ou apagado pelo renderer.
 */
describe("fileAccess", () => {
  let root = "";
  let outside = "";

  beforeAll(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-fileaccess-"));
    root = path.join(base, "biblioteca");
    outside = path.join(base, "fora");
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(root, "foto.jpg"), "x");
    await fs.writeFile(path.join(root, "sub", "video.mp4"), "x");
    await fs.writeFile(path.join(outside, "segredo.txt"), "x");
  });

  afterAll(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("aceita a raiz e o que está dentro dela", async () => {
    const access = createFileAccess();
    expect(await access.allowRoot(root)).toBe(true);
    expect(await access.isAllowed(root)).toBe(true);
    expect(await access.isAllowed(path.join(root, "sub"))).toBe(true);
    expect(await access.isAllowed(path.join(root, "sub", "video.mp4"))).toBe(true);
  });

  it("nega fora da raiz e caminhos relativos/inválidos", async () => {
    const access = createFileAccess();
    await access.allowRoot(root);
    expect(await access.isAllowed(outside)).toBe(false);
    expect(await access.isAllowed(path.join(outside, "segredo.txt"))).toBe(false);
    expect(await access.isAllowed("foto.jpg")).toBe(false);
    expect(await access.isAllowed("")).toBe(false);
    expect(await access.isAllowed(null)).toBe(false);
    expect(await access.isAllowed(`${root}\0/foto.jpg`)).toBe(false);
  });

  it("nega `..` que escapa da raiz", async () => {
    const access = createFileAccess();
    await access.allowRoot(root);
    expect(await access.isAllowed(path.join(root, "..", "fora", "segredo.txt"))).toBe(false);
  });

  it("symlink para fora é negado; para dentro é aceito", async () => {
    const access = createFileAccess();
    await access.allowRoot(root);
    const foraLink = path.join(root, "atalho-fora");
    const dentroLink = path.join(root, "atalho-dentro");
    await fs.symlink(outside, foraLink);
    await fs.symlink(path.join(root, "sub"), dentroLink);

    expect(await access.isAllowed(path.join(foraLink, "segredo.txt"))).toBe(false);
    expect(await access.isAllowed(path.join(dentroLink, "video.mp4"))).toBe(true);
  });

  it("sem raiz registrada, nada é permitido", async () => {
    const access = createFileAccess();
    expect(await access.isAllowed(root)).toBe(false);
  });

  it("isSamePath compara o caminho real, não o texto", async () => {
    const access = createFileAccess();
    const link = path.join(path.dirname(root), "atalho-biblioteca");
    await fs.symlink(root, link);
    expect(await access.isSamePath(link, root)).toBe(true);
    expect(await access.isSamePath(root, outside)).toBe(false);
    expect(await access.isSamePath(root, "")).toBe(false);
  });

  it("no Windows a comparação ignora maiúsculas/minúsculas", async () => {
    // O módulo real roda no SO atual; aqui simulamos a plataforma do Windows.
    const access = createFileAccess({ platform: "win32" });
    const windowsRoot = "C:\\Igreja\\Midia";
    // `allowRoot` resolve o caminho real; o que ainda não existe fica léxico.
    await access.allowRoot(windowsRoot);
    expect(await access.isAllowed("c:\\igreja\\midia\\foto.jpg")).toBe(true);
    expect(await access.isAllowed("C:\\Igreja\\Outra\\foto.jpg")).toBe(false);
  });

  it("realPathDeep resolve o ancestral existente de um caminho novo", async () => {
    const novo = path.join(root, "ainda", "nao", "existe.jpg");
    expect(await realPathDeep(novo)).toBe(await fs.realpath(root).then((r) => path.join(r, "ainda", "nao", "existe.jpg")));
  });
});
