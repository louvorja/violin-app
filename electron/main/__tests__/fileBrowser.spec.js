// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { listDir } = require("../fileBrowser.js");

describe("fileBrowser.listDir", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-files-"));
    fs.writeFileSync(path.join(dir, "Boas-vindas.PNG"), "img");
    fs.writeFileSync(path.join(dir, ".DS_Store"), "x");
    fs.writeFileSync(path.join(dir, "Thumbs.db"), "x");
    fs.mkdirSync(path.join(dir, "Anúncios"));
    fs.writeFileSync(path.join(dir, "Anúncios", "dentro.jpg"), "img");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lista um nível, com pastas, extensão em minúsculas e tamanho", async () => {
    const result = await listDir(dir);
    expect(result.ok).toBe(true);
    const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));

    expect(Object.keys(byName).sort()).toEqual(["Anúncios", "Boas-vindas.PNG"]);
    expect(byName["Anúncios"]).toMatchObject({ isDir: true, ext: "", size: 0 });
    expect(byName["Boas-vindas.PNG"]).toMatchObject({
      isDir: false,
      ext: "png",
      size: 3,
      path: path.join(dir, "Boas-vindas.PNG"),
    });
    expect(byName["Boas-vindas.PNG"].mtimeMs).toBeGreaterThan(0);
  });

  it("recusa caminho relativo ou vazio e informa pasta inexistente", async () => {
    expect(await listDir("relativo/pasta")).toEqual({ ok: false, error: "invalid_path" });
    expect(await listDir("")).toEqual({ ok: false, error: "invalid_path" });
    expect(await listDir(42)).toEqual({ ok: false, error: "invalid_path" });
    expect(await listDir(path.join(dir, "nao-existe"))).toEqual({ ok: false, error: "not_found" });
  });
});
