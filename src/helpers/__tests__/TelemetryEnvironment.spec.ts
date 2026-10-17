import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectEnvironment,
  nativeEnvironment,
  type EnvironmentNavigator,
} from "@/helpers/TelemetryEnvironment";

afterEach(() => vi.useRealTimers());

function web(userAgent: string, userAgentData?: EnvironmentNavigator["userAgentData"]) {
  return collectEnvironment({
    desktop: false,
    platform: null,
    navigatorInfo: { userAgent, userAgentData },
  });
}

describe("TelemetryEnvironment", () => {
  it("rejeita payloads IPC de outra plataforma e campos não reconhecidos", () => {
    expect(nativeEnvironment({ platform: "win32", systemVersion: "10.0.26100" }, "darwin")).toEqual(
      {}
    );
    expect(
      nativeEnvironment(
        {
          platform: "darwin",
          systemVersion: 26,
          processArch: "secret",
          kernelRelease: {},
          hostname: "private",
          token: "secret",
        },
        "darwin"
      )
    ).toEqual({});
    expect(
      nativeEnvironment(
        { platform: "linux", linux: { id: "ubuntu", source: { toString: 1 } } },
        "linux"
      )
    ).toEqual({});
  });

  it("usa a versão Linux da distro e tolera rolling release sem versão", () => {
    const info = {
      platform: "linux",
      kernelRelease: "6.8.0-52-generic",
      linux: {
        id: "ubuntu",
        name: "Ubuntu 24.04 LTS",
        version: "24.04",
        source: "/etc/os-release",
      },
    };
    expect(nativeEnvironment(info, "linux")).toMatchObject({
      linux_distro: "ubuntu",
      linux_distro_version: "24.04",
      os_version: "24.04",
      os_version_source: "os-release",
      os_kernel_version: "6.8.0-52-generic",
    });
    expect(
      nativeEnvironment({ ...info, linux: { id: "arch", source: "/etc/os-release" } }, "linux")
    ).not.toHaveProperty("os_version");
  });

  it("preserva Windows Server mesmo em builds compartilhados com Windows 11", () => {
    expect(
      nativeEnvironment(
        {
          platform: "win32",
          systemVersion: "10.0.26100",
          windowsName: "Windows Server 2025 Standard",
        },
        "win32"
      )
    ).toMatchObject({
      windows_name: "Windows Server 2025 Standard",
      windows_build: "26100",
      windows_version: "10.0.26100",
      os_version_source: "electron",
    });
  });

  it("mantém runtime desktop quando o IPC falha e não usa a versão congelada do UA", async () => {
    const getHighEntropyValues = vi.fn();
    const result = await collectEnvironment({
      desktop: true,
      platform: "darwin",
      api: {
        runtime: { electron: "41.4.0", chrome: "146.0.7680.216", node: "24.14.0" },
        telemetry: {
          systemInfo: async () => {
            throw new Error("IPC unavailable");
          },
        },
      } as unknown as LouvorjaApi,
      navigatorInfo: {
        userAgent: "Mac OS X 10_15_7 Chrome/146.0.0.0",
        userAgentData: { getHighEntropyValues },
      },
    });
    expect(result).toEqual({
      browser_name: "Electron",
      browser_version: "41.4.0",
      browser_version_source: "electron",
      electron_version: "41.4.0",
      chromium_version: "146.0.7680.216",
      node_version: "24.14.0",
    });
    expect(getHighEntropyValues).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Mozilla/5.0 Chrome/146.0.0.0 Safari/537.36 Edg/146.0.3856.62",
      "Microsoft Edge",
      "146.0.3856.62",
    ],
    ["Mozilla/5.0 Version/26.0 Safari/605.1.15", "Safari", "26.0"],
    ["Mozilla/5.0 Firefox/144.0", "Firefox", "144.0"],
    ["Mozilla/5.0 CriOS/146.0.7680.12 Mobile Safari/604.1", "Google Chrome", "146.0.7680.12"],
    ["Mozilla/5.0 Chrome/146.0.0.0 SamsungBrowser/28.0", "Samsung Internet", "28.0"],
    ["Mozilla/5.0 Chrome/146.0.0.0 OPR/120.0.0.0", "Opera", "120.0.0.0"],
  ])(
    "identifica navegador com fallback explícito de UA: %s",
    async (ua, browser_name, browser_version) => {
      expect(await web(ua)).toEqual({
        browser_name,
        browser_version,
        browser_version_source: "user_agent",
      });
    }
  );

  it("prefere a versão completa dos hints e ignora marcas GREASE", async () => {
    const result = await web("Mac OS X 10_15_7 Chrome/146.0.0.0 Safari/537.36", {
      platform: "macOS",
      brands: [{ brand: "Google Chrome", version: "146" }],
      getHighEntropyValues: async () => ({
        platformVersion: "26.0.1",
        architecture: "arm",
        bitness: "64",
        fullVersionList: [
          { brand: "Not/A Brand", version: "99" },
          { brand: "Chromium", version: "146.0.7680.1" },
          { brand: "Google Chrome", version: "146.0.7680.12" },
        ],
        model: "private",
      }),
    });
    expect(result).toMatchObject({
      browser_name: "Google Chrome",
      browser_version: "146.0.7680.12",
      browser_version_source: "client_hints",
      macos_version: "26.0.1",
      os_version_source: "client_hints",
      browser_architecture: "arm",
      browser_bitness: "64",
    });
    expect(result).not.toHaveProperty("model");
  });

  it.each([
    ["10.0.0", "Windows 10"],
    ["13.0.0", "Windows 11 or later"],
    ["0.0.0", undefined],
  ])(
    "não interpreta UniversalApiContract %s como build do Windows",
    async (platformVersion, windowsName) => {
      const result = await web("Windows NT 10.0 Chrome/146.0.0.0", {
        platform: "Windows",
        getHighEntropyValues: async () => ({ platformVersion }),
      });
      expect(result.windows_name).toBe(windowsName);
      expect(result).not.toHaveProperty("windows_build");
      expect(result).not.toHaveProperty("os_version");
    }
  );

  it("API negada preserva navegador sem inventar a versão nativa do macOS", async () => {
    const result = await web("Mac OS X 10_15_7 Version/26.0 Safari/605.1.15", {
      getHighEntropyValues: async () => {
        throw new Error("NotAllowedError");
      },
    });
    expect(result.browser_name).toBe("Safari");
    expect(result).not.toHaveProperty("macos_version");
  });

  it("hints não identificam a distro Linux e não rebaixam Opera para Chrome", async () => {
    const result = await web("X11; Linux x86_64 Chrome/146.0.0.0 OPR/120.0.0.0", {
      platform: "Linux",
      getHighEntropyValues: async () => ({
        platformVersion: "6.8.0",
        fullVersionList: [{ brand: "Google Chrome", version: "146.0.7680.12" }],
      }),
    });
    expect(result.browser_name).toBe("Opera");
    expect(result).not.toHaveProperty("linux_distro");
    expect(result).not.toHaveProperty("os_version");
  });

  it("limita a espera por APIs que nunca respondem", async () => {
    vi.useFakeTimers();
    const pending = web("Firefox/144.0", { getHighEntropyValues: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ browser_name: "Firefox" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
