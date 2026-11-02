// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { splitWindowsArguments, candidateFromShortcut, winePrefixes, discoverShortcuts } = require("../classicDiscovery.js");
const temp = [];
afterEach(async () => { for (const dir of temp.splice(0)) await fs.remove(dir); });

describe("Classic shortcut contract", () => {
  it("preserva argumento vazio e usa somente ParamStr(2), como o Delphi", () => {
    expect(splitWindowsArguments('"" "dir_config=config es;lang=es"')).toEqual(["", "dir_config=config es;lang=es"]);
    expect(candidateFromShortcut({ target: "D:\\Louvor JA\\LouvorJA.exe", args: '"" "dir_config=config es;lang=es"' })).toEqual({
      dir: "D:\\Louvor JA", configDir: "D:\\Louvor JA\\config es", translationFile: "D:\\Louvor JA\\lang\\es.txt",
    });
    expect(candidateFromShortcut({ target: "D:\\Louvor JA\\LouvorJA.exe", args: '"dir_config=ignored"' }).configDir).toBe("D:\\Louvor JA\\config");
  });

  it("não confunde Violin ou atalhos genéricos com Classic", () => {
    for (const target of ["C:\\App\\LouvorJA Violin.exe", "C:\\cmd.exe", "LouvorJA.exe"]) {
      expect(candidateFromShortcut({ target })).toBeNull();
    }
  });

  it("resolve o dir_config relativo sem aceitar caminhos absolutos inválidos para o Delphi", () => {
    expect(candidateFromShortcut({ target: "D:\\Apps\\LouvorJA.exe", args: '"" "dir_config=..\\Acervo"' }).configDir).toBe("D:\\Acervo");
    expect(candidateFromShortcut({ target: "D:\\Apps\\LouvorJA.exe", args: '"" "dir_config=C:\\Acervo"' })).toBeNull();
    expect(candidateFromShortcut({ target: "D:\\Apps\\LouvorJA.exe", args: '"" "lang=..\\secrets"' })).toBeNull();
  });

  it("inspeciona atalhos sem executar nem seguir links", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "classic-links-")); temp.push(root);
    await fs.outputFile(path.join(root, "Programas", "Classic.lnk"), "shortcut");
    await fs.outputFile(path.join(root, "Programas", "Violin.lnk"), "shortcut");
    const calls = [];
    const found = discoverShortcuts({ directories: [root], readShortcutLink: (file) => {
      calls.push(file);
      return { target: file.endsWith("Classic.lnk") ? "D:\\LouvorJA.exe" : "D:\\LouvorJA Violin.exe", args: '"" "lang=es"' };
    } });
    expect(calls).toHaveLength(2);
    expect(found).toHaveLength(1);
    expect(found[0].translationFile).toBe("D:\\lang\\es.txt");
  });

  it("descobre bottles reais e respeita WINEPREFIX", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "classic-wine-")); temp.push(home);
    const bottle = path.join(home, "Library", "Application Support", "CrossOver", "Bottles", "Igreja");
    await fs.ensureDir(bottle);
    expect(winePrefixes({ home, env: { WINEPREFIX: "/custom/wine" } })).toEqual(expect.arrayContaining(["/custom/wine", bottle]));
  });
});
