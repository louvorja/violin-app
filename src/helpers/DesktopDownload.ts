export type DesktopDownloadPlatform = "windows" | "macos" | "linux" | "other";
export type LinuxDownloadArchitecture = "x64" | "arm64";
export type LinuxDownloadFormat = "deb" | "rpm" | "appimage";

interface NavigatorSnapshot {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    platform?: string;
  };
}

const RELEASES_BASE_URL = "https://github.com/louvorja/violin-app/releases";
// Nome explícito definido em electron-builder.yml para coincidir com o asset
// publicado e com os nomes registrados nos arquivos latest*.yml.
const RELEASE_ASSET_PRODUCT_NAME = "LouvorJA.Violin";

/**
 * Detecta apenas sistemas para os quais publicamos um instalador desktop.
 * Android, iOS e ChromeOS ficam como `other`, mesmo quando o user-agent traz
 * "Linux" ou "Mac" por compatibilidade.
 */
export function detectDesktopDownloadPlatform(
  navigatorSnapshot: NavigatorSnapshot
): DesktopDownloadPlatform {
  const userAgent = navigatorSnapshot.userAgent?.toLowerCase() ?? "";
  const platform = [navigatorSnapshot.userAgentData?.platform, navigatorSnapshot.platform]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isMobile =
    /android|iphone|ipad|ipod/.test(userAgent) ||
    (platform.includes("mac") && (navigatorSnapshot.maxTouchPoints ?? 0) > 1);

  if (isMobile || /cros/.test(userAgent)) return "other";
  if (platform.includes("win") || userAgent.includes("windows")) return "windows";
  if (platform.includes("mac") || userAgent.includes("macintosh")) return "macos";
  if (platform.includes("linux") || userAgent.includes("linux")) return "linux";
  return "other";
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function desktopReleaseUrl(version: string): string {
  return `${RELEASES_BASE_URL}/tag/v${encodeURIComponent(normalizeVersion(version))}`;
}

/** Só pré-seleciona uma arquitetura de 64 bits quando o navegador a informa. */
export function detectLinuxDownloadArchitecture(
  navigatorSnapshot: NavigatorSnapshot
): LinuxDownloadArchitecture | null {
  const platform = navigatorSnapshot.platform?.toLowerCase() ?? "";
  const userAgent = navigatorSnapshot.userAgent?.toLowerCase() ?? "";
  // A plataforma explícita tem prioridade sobre um user-agent reduzido.
  for (const value of [platform, userAgent]) {
    if (/aarch64|arm64/.test(value)) return "arm64";
    if (/x86_64|amd64|\bx64\b/.test(value)) return "x64";
    if (/armv[5-8]l|i[3-6]86/.test(value)) return null;
  }
  return null;
}

/** Nomes publicados pelo electron-builder para cada formato e arquitetura. */
export function linuxDownloadUrl(
  format: LinuxDownloadFormat,
  architecture: LinuxDownloadArchitecture,
  version: string
): string {
  const cleanVersion = normalizeVersion(version);
  const arm = architecture === "arm64";
  const assets: Record<LinuxDownloadFormat, string> = {
    deb: `louvorja-violin_${cleanVersion}_${arm ? "arm64" : "amd64"}.deb`,
    rpm: `louvorja-violin-${cleanVersion}.${arm ? "aarch64" : "x86_64"}.rpm`,
    appimage: `LouvorJA-Violin-${cleanVersion}-${arm ? "arm64" : "x86_64"}.AppImage`,
  };
  return `${RELEASES_BASE_URL}/download/v${encodeURIComponent(cleanVersion)}/${encodeURIComponent(assets[format])}`;
}

/**
 * O .dmg universal ganhou "_universal" no nome a partir da 2.0.0-beta.19: o site
 * da comunidade deduz a arquitetura pelo nome e, sem a marca, o anunciava como
 * só Intel. As versões publicadas antes disso mantêm o nome antigo (sem sufixo).
 */
function macInstallerSuffix(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(version);
  if (!m) return "_universal";
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major < 2) return "";
  const beta = m[4] === undefined ? null : Number(m[4]);
  return major === 2 && minor === 0 && patch === 0 && beta !== null && beta <= 18
    ? ""
    : "_universal";
}

/**
 * Windows e macOS têm um único instalador recomendado e baixam diretamente.
 * Linux tem links por formato em LinuxDownloadOptions; sem uma escolha,
 * este link genérico continua levando à página da release.
 */
export function desktopDownloadUrl(platform: DesktopDownloadPlatform, version: string): string {
  const cleanVersion = normalizeVersion(version);
  const assetName =
    platform === "windows"
      ? `${RELEASE_ASSET_PRODUCT_NAME}-Setup-${cleanVersion}.exe`
      : platform === "macos"
        ? `${RELEASE_ASSET_PRODUCT_NAME}-${cleanVersion}${macInstallerSuffix(cleanVersion)}.dmg`
        : null;

  if (!assetName) return desktopReleaseUrl(cleanVersion);

  return `${RELEASES_BASE_URL}/download/v${encodeURIComponent(cleanVersion)}/${encodeURIComponent(assetName)}`;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Rótulo do botão principal de download — único para a home e para o diálogo de instalação. */
export function desktopDownloadLabel(platform: DesktopDownloadPlatform, t: Translate): string {
  if (platform === "other") return t("shell.desktop_download.view_downloads");
  if (platform === "linux") {
    return t("shell.desktop_download.view_downloads_for", {
      platform: t("shell.desktop_download.platform.linux"),
    });
  }
  return t("shell.desktop_download.download_for", {
    platform: t(`shell.desktop_download.platform.${platform}`),
  });
}
