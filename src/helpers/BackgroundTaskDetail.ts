import { BOOKS } from "@/constants/Bible";
import type { BibleVersion } from "@/types/Bible";

export type TranslateFn = (key: string) => string;

function _basename(value: string): string {
  const parts = String(value).split(/[\\/]/);
  return parts[parts.length - 1] || String(value);
}

function _translateToken(token: string, t?: TranslateFn): string {
  const key = String(token).trim().toLowerCase();
  if (!key) return "";

  const map: Record<string, string> = {
    album_: "startup_check.bundle_importing_albums",
    music_: "startup_check.bundle_importing_musics",
    pt_: "startup_check.bundle_importing_catalog",
    es_: "startup_check.bundle_importing_catalog",
    download: "shell.background_tasks.download",
    extract: "shell.background_tasks.extract",
    import: "shell.background_tasks.import",
    loading: "shell.background_tasks.loading",
    clearing: "shell.background_tasks.clearing",
    writing: "shell.background_tasks.writing",
    bundles: "shell.background_tasks.packages",
    bundle: "shell.background_tasks.packages",
    gloss: "shell.background_tasks.gloss",
  };

  for (const prefix of Object.keys(map)) {
    if (key.startsWith(prefix)) return t ? t(map[prefix]) : token;
  }

  const translatedKey = map[key];
  if (translatedKey && t) return t(translatedKey);
  if (translatedKey) return token;

  return _basename(token);
}

function _formatBibleKey(value: string, t?: TranslateFn, versions?: BibleVersion[]): string {
  const parts = value.split("_");
  const versionId = Number(parts[1]);
  const bookId = Number(parts[2]);
  const chapter = Number(parts[3]);

  const version = versions?.find((v) => v.id_bible_version === versionId);
  const bookKey = BOOKS[bookId - 1]?.id;
  const bookName = bookKey ? (t ? t(`bible.books.${bookKey}`) : bookKey) : String(bookId);

  if (version) {
    const abbrev = version.abbreviation || String(versionId);
    return `${abbrev} — ${bookName} ${chapter}`;
  }

  const suffix = t ? t("startup_check.bundle_version_suffix") : "Versão";
  return `${bookName} ${chapter} - ${suffix} ${versionId}`;
}

export function formatBibleDownloadDetail(
  detail: string | null | undefined,
  t?: TranslateFn,
  versions?: BibleVersion[]
): string {
  if (!detail) return "";

  const value = String(detail).trim();
  if (!value) return "";

  if (/^bible_\d+_\d+_\d+$/.test(value)) {
    return _formatBibleKey(value, t, versions);
  }

  const parts = value.split(" — ");
  if (parts.length >= 2) {
    const head = parts.shift() || "";
    const tail = parts.join(" — ");
    if (/^[\p{L}\p{N}]{1,8}$/u.test(head) && /\d+$/.test(tail)) {
      return value;
    }
  }

  return "";
}

export function formatBackgroundTaskDetail(
  detail: string | null | undefined,
  t?: TranslateFn,
  versions?: BibleVersion[]
): string {
  if (!detail) return "";

  const value = String(detail).trim();
  if (!value) return "";

  if (/\d/.test(value) && /(?:KB|MB|GB|TB|\/s\b|baixados)/i.test(value)) {
    return value;
  }

  if (/^bible_\d+_\d+_\d+$/.test(value)) {
    return _formatBibleKey(value, t, versions);
  }

  const bibleDetail = formatBibleDownloadDetail(value, t, versions);
  if (bibleDetail) return bibleDetail;

  const parts = value.split(" — ");
  if (parts.length >= 2) {
    const head = parts.shift() || "";
    const tail = parts.join(" — ");
    return `${head} — ${_translateToken(tail, t)}`;
  }

  return _translateToken(value, t);
}
