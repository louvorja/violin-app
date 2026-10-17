// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { collectSystemInfo, parseOsRelease } = require("../telemetryEnvironment.js");

describe("telemetry environment nativo", () => {
  const osInfo = { release: () => "25.0.0", version: () => "Windows 11 Pro" };

  it("usa a versão do produto macOS e mantém o kernel em outro campo", async () => {
    expect(
      await collectSystemInfo({
        processInfo: { platform: "darwin", arch: "arm64", getSystemVersion: () => "26.0.1" },
        osInfo,
      })
    ).toEqual({
      platform: "darwin",
      processArch: "arm64",
      systemVersion: "26.0.1",
      kernelRelease: "25.0.0",
    });
  });

  it.each(["Windows 10 Pro", "Windows 11 Home", "Windows Server 2025 Standard"])(
    "preserva nome/edição nativa (%s) sem deduzir pelo build",
    async (name) => {
      const result = await collectSystemInfo({
        processInfo: { platform: "win32", arch: "x64", getSystemVersion: () => "10.0.26100" },
        osInfo: { release: () => "10.0.26100", version: () => name },
      });
      expect(result).toMatchObject({ systemVersion: "10.0.26100", windowsName: name });
    }
  );

  it.each([
    ['ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"', "ubuntu", "24.04"],
    ["ID=debian\r\nVERSION_ID='12'\r\nNAME=Debian", "debian", "12"],
    [
      'ID=fedora\nVERSION_ID=42\nPRETTY_NAME="Fedora Linux 42 (Workstation Edition)"',
      "fedora",
      "42",
    ],
    ['ID=arch\nNAME="Arch Linux"', "arch", undefined],
  ])("lê distro e versão sem confundi-las com o kernel (%s)", async (release, id, version) => {
    const readRelease = vi.fn(async () => release);
    const result = await collectSystemInfo({
      processInfo: { platform: "linux", arch: "x64" },
      osInfo: { release: () => "6.8.0-52-generic" },
      readRelease,
    });
    expect(result.linux).toMatchObject({ id, version, source: "/etc/os-release" });
    expect(result.kernelRelease).toBe("6.8.0-52-generic");
    expect(result).not.toHaveProperty("systemVersion");
    expect(readRelease.mock.calls).toEqual([["/etc/os-release"]]);
  });

  it("tenta /usr/lib apenas quando /etc está indisponível e tolera ausência dos dois", async () => {
    const readRelease = vi
      .fn()
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce("ID=alpine\nVERSION_ID=3.22");
    const options = { processInfo: { platform: "linux" }, osInfo, readRelease };
    expect((await collectSystemInfo(options)).linux).toMatchObject({
      id: "alpine",
      source: "/usr/lib/os-release",
    });
    readRelease.mockRejectedValue(new Error("EACCES"));
    expect(await collectSystemInfo(options)).not.toHaveProperty("linux");
  });

  it("não executa expansões, não inclui campos arbitrários e limita o arquivo", () => {
    expect(
      parseOsRelease(
        'ID=ubuntu\nVERSION_ID="$(whoami)"\nPRETTY_NAME="`hostname`"\nHOME_URL=https://example.com\nMACHINE_ID=secret'
      )
    ).toEqual({ id: "ubuntu", name: undefined, version: undefined });
    expect(parseOsRelease("ID=ubuntu\n" + "#".repeat(16_384))).toEqual({});
    expect(parseOsRelease('ID="ubuntu')).toEqual({
      id: undefined,
      name: undefined,
      version: undefined,
    });
  });

  it("falhas das APIs nativas preservam um snapshot parcial", async () => {
    const unavailable = () => {
      throw new Error("unavailable");
    };
    const result = await collectSystemInfo({
      processInfo: { platform: "win32", arch: "arbitrary", getSystemVersion: unavailable },
      osInfo: { release: unavailable, version: unavailable },
    });
    expect(result).toEqual({
      platform: "win32",
      processArch: undefined,
      kernelRelease: undefined,
      systemVersion: undefined,
      windowsName: undefined,
    });
  });
});
