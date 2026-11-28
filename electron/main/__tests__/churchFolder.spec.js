// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const church = require("../churchFolder.js");

let root;
const programsDir = () => path.join(root, church.BASE, church.DIRS.program);
const doc = (n) => ({ version: 1, savedBy: "PC", program: { date: "2026-10-10", n } });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-church-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("churchFolder", () => {
  it("grava e lê o programa em LouvorJA/programas, criando as pastas", async () => {
    const res = await church.write(root, "program", "2026-10-10", doc(1));
    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(programsDir(), "2026-10-10.json"))).toBe(true);
    const read = await church.read(root, "program", "2026-10-10");
    expect(read).toMatchObject({ ok: true, doc: doc(1) });
    expect(read.mtimeMs).toBe(res.mtimeMs);
  });

  it("arquivo que não existe volta como doc null", async () => {
    expect(await church.read(root, "program", "2026-10-17")).toEqual({ ok: true, doc: null, mtimeMs: null });
    expect(await church.stat(root, "program", "2026-10-17")).toMatchObject({ ok: true, exists: false });
  });

  it("recusa nome, tipo e pasta inválidos — não grava fora de LouvorJA/", async () => {
    expect((await church.write(root, "program", "../../x", doc(1))).ok).toBe(false);
    expect((await church.write(root, "program", "2026-10-10/../a", doc(1))).ok).toBe(false);
    expect((await church.write(root, "other", "x", doc(1))).ok).toBe(false);
    expect((await church.write("relativa", "program", "2026-10-10", doc(1))).ok).toBe(false);
    expect((await church.write(root, "model", "Sábado", doc(1))).ok).toBe(false);
    expect((await church.write(root, "model", "sabado", [1])).ok).toBe(false);
    expect((await church.read(root, "model", "../x")).ok).toBe(false);
  });

  it("pasta da igreja ausente (OneDrive desmontado) não cria nada", async () => {
    const gone = path.join(root, "nao-existe");
    expect(await church.write(gone, "program", "2026-10-10", doc(1))).toEqual({ ok: false, error: "missing_root" });
    expect(fs.existsSync(gone)).toBe(false);
  });

  it("com expectMtime, não sobrescreve o que outro computador gravou", async () => {
    const first = await church.write(root, "program", "2026-10-10", doc(1));
    // Outro computador grava por cima (mtime diferente).
    const file = path.join(programsDir(), "2026-10-10.json");
    fs.writeFileSync(file, JSON.stringify(doc(2)));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const res = await church.write(root, "program", "2026-10-10", doc(3), { expectMtime: first.mtimeMs });
    expect(res).toMatchObject({ ok: false, error: "changed" });
    expect((await church.read(root, "program", "2026-10-10")).doc).toEqual(doc(2));
    // "Não existia" também é uma expectativa.
    expect((await church.write(root, "program", "2026-10-11", doc(4), { expectMtime: null })).ok).toBe(true);
    expect((await church.write(root, "program", "2026-10-11", doc(5), { expectMtime: null })).error).toBe("changed");
  });

  it("acha as cópias em conflito e fica com a escolhida", async () => {
    await church.write(root, "program", "2026-10-10", doc(1));
    fs.writeFileSync(path.join(programsDir(), "2026-10-10-IGREJA-PC.json"), JSON.stringify(doc(2)));
    fs.writeFileSync(path.join(programsDir(), "2026-10-10 (1).json"), JSON.stringify(doc(3)));
    fs.writeFileSync(path.join(programsDir(), "2026-10-17.json"), JSON.stringify(doc(9)));
    const st = await church.stat(root, "program", "2026-10-10");
    expect(st.conflicts.sort()).toEqual(["2026-10-10 (1).json", "2026-10-10-IGREJA-PC.json"]);
    const copies = await church.conflicts(root, "program", "2026-10-10");
    expect(copies.copies.map((c) => c.doc.program.n).sort()).toEqual([2, 3]);

    expect((await church.resolve(root, "program", "2026-10-10", "../x")).ok).toBe(false);
    await church.resolve(root, "program", "2026-10-10", "2026-10-10-IGREJA-PC.json");
    expect((await church.read(root, "program", "2026-10-10")).doc.program.n).toBe(2);
    expect((await church.stat(root, "program", "2026-10-10")).conflicts).toEqual([]);
    // O programa de outra data não é cópia em conflito.
    expect(fs.existsSync(path.join(programsDir(), "2026-10-17.json"))).toBe(true);
  });

  it("lista os nomes válidos, sem cópias nem temporários", async () => {
    await church.write(root, "model", "sabado", { name: "Sábado" });
    await church.write(root, "model", "quarta", { name: "Quarta" });
    const dir = path.join(root, church.BASE, church.DIRS.model);
    fs.writeFileSync(path.join(dir, "sabado-PC.json"), "{}");
    fs.writeFileSync(path.join(dir, "notas.txt"), "x");
    // A cópia do OneDrive ("-PC", maiúsculas) não é nome de modelo; o .txt também não.
    expect((await church.list(root, "model")).names).toEqual(["sabado", "quarta"]);
    expect((await church.list(root, "program")).names).toEqual([]);
  });

  it("documento ilegível (meio sincronizado) volta como erro, não como vazio", async () => {
    fs.mkdirSync(programsDir(), { recursive: true });
    fs.writeFileSync(path.join(programsDir(), "2026-10-10.json"), "{ meio");
    expect(await church.read(root, "program", "2026-10-10")).toEqual({ ok: false, error: "unreadable" });
  });

  it("o nome do computador sai sem o .local do macOS", () => {
    expect(church.computerName()).not.toMatch(/\.local$/i);
  });
});
