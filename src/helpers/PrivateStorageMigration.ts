/** @category helper-puro — Migra somente referências a arquivos pessoais já copiados pelo main. */
import { DB_TABLE } from "@/constants/DbTables";
import IndexedDB from "@/helpers/IndexedDB";

interface PathMapping {
  from: string;
  to: string;
}

// Catálogos oficiais, caches, dispositivos e chat não participam desta mudança.
// O IndexedDB inteiro continua privado: somente os caminhos dos anexos mudam.
const PRIVATE_FILE_TABLES = [
  DB_TABLE.SETTINGS,
  DB_TABLE.MUSICS_PLAYLISTS,
  DB_TABLE.ANNOUNCEMENTS,
  DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
  DB_TABLE.BACKGROUND_SOUND_LIBRARY,
  DB_TABLE.OVERLAY_IMAGES,
  DB_TABLE.OVERLAY_SLOTS,
  DB_TABLE.CUSTOM_ONLINE_VIDEOS,
  DB_TABLE.CUSTOM_ONLINE_VIDEOS_THUMBNAILS,
  DB_TABLE.CUSTOM_SONGS,
  DB_TABLE.CUSTOM_COLLECTIONS,
  DB_TABLE.MEDIA_LIBRARY,
  DB_TABLE.AUDIO_LIBRARY,
  DB_TABLE.IMAGE_LIBRARY,
  DB_TABLE.LITURGY_LIBRARY,
  DB_TABLE.LITURGY_FILES,
  DB_TABLE.SCHEDULED_CATEGORIES,
  DB_TABLE.SCHEDULED_ITEMS,
] as const;
const PATH_KEYS = new Set([
  "path",
  "filePath",
  "localPath",
  "uri",
  "url",
  "src",
  "dir",
  "video_src",
  "imagePath",
  "thumbnailPath",
  "auto_folder",
  "audio",
  "image",
  "bg_image",
]);

function absolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value) &&
    !value.includes("\0") &&
    !value.split(/[\\/]/).includes("..")
  );
}

export function validatePrivatePathMappings(value: unknown): PathMapping[] {
  if (!Array.isArray(value)) throw new Error("Invalid private storage path mappings");
  return value
    .map((entry: unknown) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        !("from" in entry) ||
        !("to" in entry) ||
        !absolutePath(entry.from) ||
        !absolutePath(entry.to)
      ) {
        throw new Error("Invalid private storage path mapping");
      }
      const from = entry.from.replace(/\\/g, "/").replace(/\/+$/, "");
      const to = entry.to.replace(/\\/g, "/").replace(/\/+$/, "");
      // Não aceitar a raiz de um disco/sistema como escopo de dados pessoais.
      if (!from || !to || /^[a-z]:$/i.test(from) || /^[a-z]:$/i.test(to))
        throw new Error("Invalid private storage path root");
      return { from, to };
    })
    .sort((a, b) => b.from.length - a.from.length);
}

function replaceAbsolutePath(value: string, mappings: PathMapping[]): string {
  const normalized = value.replace(/\\/g, "/");
  for (const { from, to } of mappings) {
    const windows = /^[a-z]:\//i.test(from) || from.startsWith("//");
    const source = windows ? from.toLowerCase() : from;
    const input = windows ? normalized.toLowerCase() : normalized;
    if (input !== source && !input.startsWith(`${source}/`)) continue;
    const suffix = normalized.slice(from.length);
    if (suffix.split("/").some((part) => part === ".." || part === ".")) return value;
    const result = `${to}${suffix}`;
    return value.includes("\\") && !value.includes("/") ? result.replace(/\//g, "\\") : result;
  }
  return value;
}

function replaceReference(value: string, mappings: PathMapping[]): string {
  if (/^(?:file:|louvorja:\/\/local\/)/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" && (url.protocol !== "louvorja:" || url.hostname !== "local"))
        return value;
      let filePath = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(filePath)) filePath = filePath.slice(1);
      if (url.protocol === "file:" && url.hostname && url.hostname !== "localhost")
        filePath = `//${url.hostname}${filePath}`;
      const replaced = replaceAbsolutePath(filePath, mappings).replace(/\\/g, "/");
      if (replaced === filePath) return value;
      const encoded = replaced
        .split("/")
        .map((segment, index) =>
          index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)
        )
        .join("/");
      const prefix =
        url.protocol === "file:"
          ? encoded.startsWith("//")
            ? "file:"
            : encoded.startsWith("/")
              ? "file://"
              : "file:///"
          : encoded.startsWith("/")
            ? "louvorja://local"
            : "louvorja://local/";
      return `${prefix}${encoded}${url.search}${url.hash}`;
    } catch {
      return value;
    }
  }
  return absolutePath(value) ? replaceAbsolutePath(value, mappings) : value;
}

/** Sem JSON stringify: preserva bytes, blobs, datas e ciclos de structured clone. */
export function rewritePrivateFileReferences<T>(record: T, mappings: PathMapping[]): T {
  let changed = false;
  const seen = new WeakMap<object, object>();
  function visit(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      const next = PATH_KEYS.has(key.split(".").at(-1) || "")
        ? replaceReference(value, mappings)
        : value;
      if (next !== value) changed = true;
      return next;
    }
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = new Array(value.length);
      seen.set(value, result);
      for (const [index, entry] of Object.entries(value)) {
        Object.defineProperty(result, index, {
          value: visit(entry, key),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const result = Object.create(prototype) as Record<string, unknown>;
    seen.set(value, result);
    for (const [name, entry] of Object.entries(value)) {
      Object.defineProperty(result, name, {
        value: visit(entry, name),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  const result = visit(record) as T;
  return changed ? result : record;
}

/** Cada origem migra seu próprio banco. Repetir é seguro e não exige um marcador separado. */
export async function migratePrivateStorageReferences(rawMappings: unknown): Promise<void> {
  const mappings = validatePrivatePathMappings(rawMappings);
  if (!mappings.length) return;
  for (const table of PRIVATE_FILE_TABLES) {
    await IndexedDB.rewriteRecords(table, (record) =>
      rewritePrivateFileReferences(record, mappings)
    );
  }
}
