export type DesktopDownloadPlatform = "windows" | "macos" | "linux" | "other";

interface NavigatorSnapshot {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    platform?: string;
  };
}

const RELEASES_BASE_URL = "https://github.com/louvorja/violin-app/releases";
// Nome efetivamente publicado pelo electron-builder. Ele sanitiza os espaços
// de `productName` como pontos ao montar o asset da release.
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

/**
 * Windows e macOS têm um único instalador recomendado e baixam diretamente.
 * Linux abre a release para escolher formato e arquitetura.
 */
export function desktopDownloadUrl(platform: DesktopDownloadPlatform, version: string): string {
  const cleanVersion = normalizeVersion(version);
  const assetName =
    platform === "windows"
      ? `${RELEASE_ASSET_PRODUCT_NAME}-Setup-${cleanVersion}.exe`
      : platform === "macos"
        ? `${RELEASE_ASSET_PRODUCT_NAME}-${cleanVersion}.dmg`
        : null;

  if (!assetName) return desktopReleaseUrl(cleanVersion);

  return `${RELEASES_BASE_URL}/download/v${encodeURIComponent(cleanVersion)}/${encodeURIComponent(assetName)}`;
}
