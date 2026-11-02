import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createPresentationConverter, isPowerPoint } = require("../presentationConvert.js");

let root;
let src;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-pptx-"));
  src = path.join(root, "Pregação.pptx");
  await fs.writeFile(src, "slides");
});
afterEach(() => fs.remove(root));

/** Execução falsa: grava o "PDF" onde o comando mandaria e registra a chamada. */
function fakeExec(calls, { fail = false } = {}) {
  return (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    if (fail) return setImmediate(() => cb(new Error("boom"), "", "PowerPoint não abriu"));
    const out = cmd === "osascript" ? args[3] : opts.env.LJ_OUT;
    fs.writeFile(out, "%PDF").then(() => cb(null, "", ""));
  };
}

describe("presentationConvert", () => {
  it("reconhece as extensões do PowerPoint", () => {
    expect(isPowerPoint("/a/b.PPTX")).toBe(true);
    expect(isPowerPoint("/a/b.ppsx")).toBe(true);
    expect(isPowerPoint("/a/b.pdf")).toBe(false);
  });

  it("no Windows usa o PowerPoint por COM, com os caminhos em variáveis de ambiente", async () => {
    const calls = [];
    const conv = createPresentationConverter({ cacheDir: path.join(root, "cache"), platform: "win32", execImpl: fakeExec(calls) });
    const res = await conv.toPdf(src);
    expect(res).toMatchObject({ ok: true, cached: false });
    expect(await fs.readFile(res.pdf, "utf8")).toBe("%PDF");
    expect(calls[0].cmd).toBe("powershell.exe");
    expect(calls[0].opts.env.LJ_SRC).toBe(src);
    expect(calls[0].args.join(" ")).not.toContain(src);
  });

  it("no macOS grava no contêiner do PowerPoint e move o PDF para o cache", async () => {
    const calls = [];
    const macContainer = path.join(root, "container");
    const conv = createPresentationConverter({ cacheDir: path.join(root, "cache"), platform: "darwin", macContainer, execImpl: fakeExec(calls) });
    const res = await conv.toPdf(src);
    expect(res.ok).toBe(true);
    expect(calls[0].args[2]).toBe(src);
    expect(path.dirname(calls[0].args[3])).toBe(macContainer);
    expect(await fs.pathExists(calls[0].args[3])).toBe(false);
    expect(await fs.pathExists(res.pdf)).toBe(true);
  });

  it("usa o cache até o arquivo mudar, e pedidos simultâneos convertem uma vez", async () => {
    const calls = [];
    const conv = createPresentationConverter({ cacheDir: path.join(root, "cache"), platform: "win32", execImpl: fakeExec(calls) });
    const [a, b] = await Promise.all([conv.toPdf(src), conv.toPdf(src)]);
    expect(a.pdf).toBe(b.pdf);
    expect(calls).toHaveLength(1);
    expect(await conv.toPdf(src)).toMatchObject({ ok: true, cached: true });

    await fs.writeFile(src, "slides editados");
    const changed = await conv.toPdf(src);
    expect(changed).toMatchObject({ ok: true, cached: false });
    expect(changed.pdf).not.toBe(a.pdf);
    expect(calls).toHaveLength(2);
  });

  it("falhas viram erros que a interface sabe explicar", async () => {
    const cacheDir = path.join(root, "cache");
    const failing = createPresentationConverter({ cacheDir, platform: "win32", execImpl: fakeExec([], { fail: true }) });
    expect(await failing.toPdf(src)).toEqual({ ok: false, error: "conversion_failed" });
    const linux = createPresentationConverter({ cacheDir, platform: "linux", execImpl: fakeExec([]) });
    expect(await linux.toPdf(src)).toEqual({ ok: false, error: "unsupported" });
    expect(await failing.toPdf("relativo.pptx")).toEqual({ ok: false, error: "invalid_path" });
    expect(await failing.toPdf(path.join(root, "sumiu.pptx"))).toEqual({ ok: false, error: "not_found" });
  });
});
