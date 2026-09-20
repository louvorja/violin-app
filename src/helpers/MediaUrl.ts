import { API_URL_FILES } from "@/config/Api";

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
