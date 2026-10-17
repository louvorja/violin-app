import { API_URL_FILES, LEGACY_MEDIA_PREFIXES, MEDIA_URL } from "@/config/Api";

/**
 * Endereço atual de uma mídia guardada com o endereço antigo (`<API>/file/...`),
 * ou `null` quando ela não é desse tipo. Não é usado ao ler o catálogo: o
 * catálogo é renovado a cada atualização do app. Serve só para mudar a chave de
 * arquivos que a web já baixou, porque o Cache Storage é indexado pela URL.
 */
export function currentUrlOfLegacyMedia(url: string): string | null {
  const base = (MEDIA_URL || "").replace(/\/+$/, "");
  if (!base) return null;
  for (const prefix of LEGACY_MEDIA_PREFIXES ?? []) {
    const root = prefix.replace(/\/+$/, "");
    if (root && url.startsWith(`${root}/`)) return `${base}/${url.slice(root.length + 1)}`;
  }
  return null;
}

export interface MediaReference {
  url: string;
  relativePath: string;
}

function normalizePathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutFilePrefix = normalized.replace(/^file\//i, "");
  if (!withoutFilePrefix || withoutFilePrefix.split("/").some((part) => part === "..")) {
    return null;
  }
  return `/${withoutFilePrefix}`;
}

/** Aceita tanto o sufixo antigo quanto a URL completa nova da API. */
export function resolveMediaReference(value: string | null | undefined): MediaReference | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const relativePath = normalizePathname(parsed.pathname);
      return relativePath ? { url: parsed.toString(), relativePath } : null;
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return null;
  const relativePath = normalizePathname(raw);
  if (!relativePath || !API_URL_FILES) return null;
  return {
    url: `${API_URL_FILES.replace(/\/+$/, "")}${relativePath}`,
    relativePath,
  };
}

export function encodeMediaPath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
