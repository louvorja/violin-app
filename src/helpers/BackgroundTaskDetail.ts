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
    bible_: "startup_check.bundle_importing_bible",
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

  for (const prefix of ["album_", "music_", "bible_", "pt_", "es_"]) {
    if (key.startsWith(prefix)) return t ? t(map[prefix]) : token;
  }

  const translatedKey = map[key];
  if (translatedKey && t) return t(translatedKey);
  if (translatedKey) return token;

  return _basename(token);
}

export function formatBackgroundTaskDetail(detail: string | null | undefined, t?: TranslateFn): string {
  if (!detail) return "";

  const value = String(detail).trim();
  if (!value) return "";

  const parts = value.split(" — ");
  if (parts.length >= 2) {
    const head = parts.shift() || "";
    const tail = parts.join(" — ");
    return `${head} — ${_translateToken(tail, t)}`;
  }

  return _translateToken(value, t);
}
