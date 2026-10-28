// @vitest-environment node
/**
 * Escolha do instalador na release.
 *
 * No Windows convivem dois instaladores (x64 e arm64). Escolher "o primeiro
 * .exe" entregaria o errado em metade dos casos — e numa máquina ARM o
 * instalador x64 roda por emulação, mas troca a instalação nativa por ela.
 */
import { createRequire } from "node:module";
import Module from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const updaterPath = require.resolve("../updater.js");
const ORIGINAL_LOAD = Module._load;

/*
 * O `updater.js` toca `app.getVersion()` no carregamento do módulo; sem o dublê
 * do Electron ele nem sobe num ambiente node.
 */
Module._load = function (request, ...args) {
  if (request === "electron") {
    return { app: { getVersion: () => "2.0.0", getPath: () => "/tmp" } };
  }
  return ORIGINAL_LOAD.call(this, request, ...args);
};
let escolherAssetDaRelease;
try {
  delete require.cache[updaterPath];
  ({ escolherAssetDaRelease } = require(updaterPath));
} finally {
  Module._load = ORIGINAL_LOAD;
}

afterAll(() => {
  delete require.cache[updaterPath];
});

const EXE_X64 = { name: "LouvorJA.Violin-Setup-2.0.0.exe", size: 1 };
const EXE_ARM = { name: "LouvorJA.Violin-Setup-2.0.0-arm64.exe", size: 2 };
const DMG = { name: "LouvorJA.Violin-2.0.0_universal.dmg", size: 3 };

describe("escolherAssetDaRelease", () => {
  it("Windows x64 ignora o instalador ARM, mesmo que ele venha primeiro", () => {
    expect(escolherAssetDaRelease([EXE_ARM, EXE_X64], "exe", "win32", "x64")).toBe(EXE_X64);
  });

  it("Windows ARM pega o instalador nativo", () => {
    expect(escolherAssetDaRelease([EXE_X64, EXE_ARM], "exe", "win32", "arm64")).toBe(EXE_ARM);
  });

  it("sem o instalador da arquitetura, cai no que existe", () => {
    /* Release antiga, publicada antes do ARM: melhor o x64 emulado que nada. */
    expect(escolherAssetDaRelease([EXE_X64], "exe", "win32", "arm64")).toBe(EXE_X64);
  });

  it("macOS pega o .dmg universal, sem depender da arquitetura", () => {
    expect(escolherAssetDaRelease([DMG], "dmg", "darwin", "arm64")).toBe(DMG);
    expect(escolherAssetDaRelease([DMG], "dmg", "darwin", "x64")).toBe(DMG);
  });

  it("filtra pela extensão da instalação", () => {
    expect(escolherAssetDaRelease([DMG, EXE_X64], "dmg", "darwin", "arm64")).toBe(DMG);
    expect(escolherAssetDaRelease([DMG, EXE_X64], "exe", "win32", "x64")).toBe(EXE_X64);
  });

  it("lista vazia ou inválida devolve undefined", () => {
    expect(escolherAssetDaRelease([], "exe", "win32", "x64")).toBeUndefined();
    expect(escolherAssetDaRelease(null, "exe", "win32", "x64")).toBeUndefined();
    expect(escolherAssetDaRelease([{ size: 1 }, null], "exe", "win32", "x64")).toBeUndefined();
  });
});
