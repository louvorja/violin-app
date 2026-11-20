// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const shared = require("../../shared/presentationExtensions.json");
const { PPT_EXT } = require("../pptx/index.js");

/**
 * Contrato das extensões de apresentação: o main e o renderer
 * (`src/constants/FileTypes.ts`) leem o mesmo JSON. Se alguém voltar a
 * duplicar a lista, este teste avisa.
 */
describe("extensões de apresentação", () => {
  it("o main aceita exatamente a lista compartilhada", () => {
    expect(PPT_EXT).toEqual(shared.powerPoint.map((e) => `.${e}`));
  });

  it("as listas compartilhadas são coerentes", () => {
    expect(shared.powerPoint).toEqual([...new Set(shared.powerPoint)]);
    for (const ext of shared.macroEnabled) expect(shared.powerPoint).toContain(ext);
    for (const ext of shared.ooxml) expect(shared.powerPoint).toContain(ext);
    // O que não é OOXML não pode ser lido como ZIP.
    expect(shared.ooxml).not.toContain("odp");
  });

  it("o JSON fica no pacote do Electron", () => {
    // `electron/**` entra no asar; um arquivo fora dele sumiria no build.
    const rel = path.relative(path.join(process.cwd(), "electron"), require.resolve("../../shared/presentationExtensions.json"));
    expect(rel.startsWith("..")).toBe(false);
  });
});
