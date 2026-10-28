// @vitest-environment node
// Contrato com o electron-updater real: apontado para a pasta de uma release do
// GitHub, ele precisa pedir o mesmo latest*.yml que o workflow publica e baixar o
// instalador da mesma pasta, em todas as plataformas.
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { GenericProvider } = require("electron-updater/out/providers/GenericProvider.js");
const { HttpError } = require("builder-util-runtime");
const { SemVer } = require("semver");

const BASE = "https://github.com/louvorja/violin-app/releases/download/v2.0.0-rc.1";

function provider(platform) {
  const pedidos = [];
  const executor = {
    request: async (opts) => {
      const url = `${opts.protocol}//${opts.hostname}${opts.path}`;
      pedidos.push(url);
      if (!/\/latest(-mac|-linux|-linux-arm64)?\.yml$/.test(url)) throw new HttpError(404, "Not Found");
      return [
        "version: 2.0.0-rc.1",
        "files:",
        "  - url: LouvorJA.Violin-Setup-2.0.0-rc.1.exe",
        "    sha512: abc",
        "    size: 1",
        "path: LouvorJA.Violin-Setup-2.0.0-rc.1.exe",
        "sha512: abc",
        "releaseDate: '2026-10-19T00:00:00.000Z'",
      ].join("\n");
    },
  };
  const updater = { allowPrerelease: true, channel: null, currentVersion: new SemVer("2.0.0-beta.18") };
  const p = new GenericProvider({ provider: "generic", url: BASE, useMultipleRangeRequest: false }, updater, {
    executor,
    platform,
    isUseMultipleRangeRequest: false,
  });
  return { p, pedidos };
}

afterEach(() => {
  delete process.env.TEST_UPDATER_ARCH;
});

describe("feed genérico na pasta da release", () => {
  for (const [platform, arch, arquivo] of [
    ["win32", "x64", "latest.yml"],
    ["darwin", "arm64", "latest-mac.yml"],
    ["linux", "x64", "latest-linux.yml"],
    ["linux", "arm64", "latest-linux-arm64.yml"],
  ]) {
    it(`${platform} ${arch} lê ${arquivo} e baixa da mesma pasta`, async () => {
      process.env.TEST_UPDATER_ARCH = arch;
      const { p, pedidos } = provider(platform);
      const info = await p.getLatestVersion();
      expect(info.version).toBe("2.0.0-rc.1");
      expect(pedidos).toEqual([`${BASE}/${arquivo}`]);
      const [file] = p.resolveFiles(info);
      expect(file.url.href).toBe(`${BASE}/LouvorJA.Violin-Setup-2.0.0-rc.1.exe`);
    });
  }
});
