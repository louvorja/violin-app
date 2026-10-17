import type { EnvironmentProperties } from "@/types/TelemetryEnvironment";

const NUMERIC_VERSION = /^\d{1,6}(?:\.\d{1,6}){0,3}$/;
const RELEASE = /^[a-zA-Z0-9._+-]+$/;
const LABEL = /^[\p{L}\p{N} ._()+/-]+$/u;
const PROCESS_ARCH = /^(?:arm|arm64|ia32|x64|riscv64|ppc64|s390x|loong64|mips|mipsel)$/;
const ENVIRONMENT_TIMEOUT_MS = 500;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, pattern: RegExp, limit = 128): string | undefined {
  return typeof value === "string" && value.length <= limit && pattern.test(value)
    ? value
    : undefined;
}

/** Apenas campos reconhecidos atravessam a fronteira IPC. */
export function nativeEnvironment(value: unknown, platform: string | null): EnvironmentProperties {
  const info = record(value);
  if (info.platform !== platform || !["darwin", "win32", "linux"].includes(platform ?? ""))
    return {};
  const result: EnvironmentProperties = {};
  const arch = text(info.processArch, PROCESS_ARCH);
  const kernel = text(info.kernelRelease, RELEASE);
  if (arch) result.process_arch = arch;
  if (kernel) result.os_kernel_version = kernel;

  if (platform === "linux") {
    const linux = record(info.linux);
    const id = text(linux.id, /^[a-z0-9._-]+$/, 64);
    if (
      !id ||
      typeof linux.source !== "string" ||
      !["/etc/os-release", "/usr/lib/os-release"].includes(linux.source)
    )
      return result;
    result.linux_distro = id;
    const name = text(linux.name, LABEL);
    const version = text(linux.version, /^[a-zA-Z0-9._-]+$/, 64);
    if (name) result.linux_distro_name = name;
    if (version) {
      result.linux_distro_version = result.os_version = version;
      result.os_version_source = "os-release";
    }
  } else {
    const version = text(info.systemVersion, NUMERIC_VERSION);
    if (version) {
      result.os_version = version;
      result.os_version_source = "electron";
      if (platform === "darwin") result.macos_version = version;
      else {
        result.windows_version = version;
        const build = version.split(".")[2];
        if (build) result.windows_build = build;
      }
    }
    if (platform === "win32") {
      const name = text(info.windowsName, /^Windows [a-zA-Z0-9 .()+-]+$/);
      if (name) {
        result.windows_name = name;
        result.windows_name_source = "node_os";
      }
    }
  }
  return result;
}

const UA_BROWSERS: Array<[string, RegExp]> = [
  ["Microsoft Edge", /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],
  ["Opera", /(?:OPR|OPiOS)\/([\d.]+)/],
  ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
  ["Safari", /Version\/([\d.]+).*Safari\//],
];

function browserFromUA(userAgent: string): EnvironmentProperties {
  for (const [name, pattern] of UA_BROWSERS) {
    const version = text(pattern.exec(userAgent.slice(0, 2048))?.[1], NUMERIC_VERSION);
    if (version)
      return { browser_name: name, browser_version: version, browser_version_source: "user_agent" };
  }
  return {};
}

// A lista ignora as marcas GREASE aleatórias. A ordem prefere o produto ao motor.
const BRANDS = [
  "Microsoft Edge",
  "Opera",
  "Brave",
  "Samsung Internet",
  "Google Chrome",
  "Chromium",
];

function browserFromBrands(value: unknown, fallback: EnvironmentProperties): EnvironmentProperties {
  if (!Array.isArray(value)) return {};
  const brands = value.slice(0, 12).map(record);
  for (const brand of BRANDS) {
    const version = text(brands.find((entry) => entry.brand === brand)?.version, NUMERIC_VERSION);
    if (!version) continue;
    // Um navegador derivado pode expor só a marca do motor.
    if (
      ["Google Chrome", "Chromium"].includes(brand) &&
      fallback.browser_name &&
      !["Google Chrome", "Chromium"].includes(fallback.browser_name)
    )
      return {};
    return {
      browser_name: brand,
      browser_version: version,
      browser_version_source: "client_hints",
    };
  }
  return {};
}

interface UserAgentDataLike {
  brands?: unknown;
  platform?: unknown;
  getHighEntropyValues?: (_hints: string[]) => Promise<unknown>;
}

export interface EnvironmentNavigator {
  userAgent: string;
  userAgentData?: UserAgentDataLike;
}

/** Versões síncronas continuam disponíveis para diagnosticar falhas antes do SDK. */
export function desktopRuntime(api?: LouvorjaApi): EnvironmentProperties {
  const result: EnvironmentProperties = {};
  for (const [property, raw] of [
    ["electron_version", api?.runtime?.electron || api?.version],
    ["chromium_version", api?.runtime?.chrome],
    ["node_version", api?.runtime?.node],
  ]) {
    const version = text(raw, NUMERIC_VERSION);
    if (version && property) result[property] = version;
  }
  if (result.electron_version) {
    result.browser_name = "Electron";
    result.browser_version = result.electron_version;
    result.browser_version_source = "electron";
  }
  return result;
}

/** Falha, API ausente ou resposta que nunca chega não pode bloquear o bootstrap. */
async function boundedRead(read: () => unknown): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ENVIRONMENT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectEnvironment({
  desktop,
  platform,
  api,
  navigatorInfo,
}: {
  desktop: boolean;
  platform: string | null;
  api?: LouvorjaApi;
  navigatorInfo?: EnvironmentNavigator;
}): Promise<EnvironmentProperties> {
  if (desktop) {
    return {
      ...desktopRuntime(api),
      ...nativeEnvironment(await boundedRead(() => api?.telemetry?.systemInfo?.()), platform),
    };
  }

  const result = browserFromUA(navigatorInfo?.userAgent ?? "");
  const data = navigatorInfo?.userAgentData;
  if (!data) return result;
  const lowEntropyBrowser = browserFromBrands(data.brands, result);
  // A versão completa do UA continua mais útil do que só a major das brands.
  if (!result.browser_version || result.browser_version.endsWith(".0.0.0"))
    Object.assign(result, lowEntropyBrowser);
  const hints = record(
    await boundedRead(() =>
      data.getHighEntropyValues?.(["platformVersion", "fullVersionList", "architecture", "bitness"])
    )
  );
  Object.assign(result, browserFromBrands(hints.fullVersionList, result));
  const browserPlatform = text(data.platform, /^(?:Windows|macOS|Linux|Android|iOS|Chrome OS)$/);
  const platformVersion = text(hints.platformVersion, NUMERIC_VERSION);
  if (browserPlatform) result.browser_platform = browserPlatform;
  if (browserPlatform && platformVersion && !/^0(?:\.0)*$/.test(platformVersion)) {
    // No Windows este número representa UniversalApiContract, não o build do SO.
    result.browser_platform_version = platformVersion;
    result.browser_platform_version_source = "client_hints";
    if (["macOS", "Android", "iOS", "Chrome OS"].includes(browserPlatform)) {
      result.os_version = platformVersion;
      result.os_version_source = "client_hints";
      if (browserPlatform === "macOS") result.macos_version = platformVersion;
    }
    if (browserPlatform === "Windows") {
      const major = Number(platformVersion.split(".")[0]);
      if (major >= 13) result.windows_name = "Windows 11 or later";
      else if (major >= 1 && major <= 10) result.windows_name = "Windows 10";
      if (result.windows_name) result.windows_name_source = "client_hints";
    }
  }
  const architecture = text(hints.architecture, /^(?:x86|arm)$/);
  const bitness = text(hints.bitness, /^(?:32|64)$/);
  if (architecture) result.browser_architecture = architecture;
  if (bitness) result.browser_bitness = bitness;
  return result;
}
