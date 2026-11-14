/**
 * Formato dos registros que a importação de pacote grava nas bibliotecas.
 *
 * Desktop guarda `path` relativo; web com OPFS guarda `opfs:`; sem OPFS, o
 * fallback continua sendo `data` Blob + `path: blob:`.
 */
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import Path from "@/helpers/Path";
import { blobOf, byteSize } from "@/helpers/Bytes";
import { mimeForName } from "@/helpers/Mime";
import type { StoredFile } from "@/helpers/LibraryFiles";
import type { FileSource } from "./format";

export type MediaKind = "image" | "video" | "audio" | "pdf";

export function mediaKindOf(name: string): MediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return ext === "pdf" ? "pdf" : null;
}

/** O MIME declarado precisa combinar com o tipo que a extensão promete. */
export function mimeMatches(kind: MediaKind, mime: string): boolean {
  const normalized = (mime || "").split(";")[0].trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return true;
  if (kind === "pdf") return normalized === "application/pdf";
  return normalized.startsWith(`${kind}/`);
}

/** `path` de registro autocontido (fallback web sem OPFS). */
export function placeholderPath(): string {
  try {
    const url = URL.createObjectURL(new Blob([]));
    URL.revokeObjectURL(url);
    return url;
  } catch {
    return "blob:imported";
  }
}

export function recordSize(record: Record<string, unknown>): number {
  const declared = Number(record.size);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return byteSize(record.data);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Primeiros/últimos 64 KB: barato e suficiente para não confundir dois arquivos. */
async function sameBlobContent(left: Blob, right: Blob): Promise<boolean> {
  if (left.size !== right.size) return false;
  const window = 64 * 1024;
  const start = await Promise.all([
    left.slice(0, window).arrayBuffer(),
    right.slice(0, window).arrayBuffer(),
  ]);
  if (!sameBytes(new Uint8Array(start[0]), new Uint8Array(start[1]))) return false;
  if (left.size <= window) return true;
  const end = await Promise.all([
    left.slice(left.size - window).arrayBuffer(),
    right.slice(right.size - window).arrayBuffer(),
  ]);
  return sameBytes(new Uint8Array(end[0]), new Uint8Array(end[1]));
}

/** O conteúdo guardado é o mesmo que acabou de ser gravado? */
export async function sameContent(
  record: Record<string, unknown>,
  stored: StoredFile
): Promise<boolean> {
  if (recordSize(record) !== stored.size) return false;
  const recordSha = typeof record.sha256 === "string" ? record.sha256 : "";
  if (recordSha && stored.mode === "path" && stored.sha256) {
    return recordSha === stored.sha256;
  }
  if (stored.mode === "blob") {
    const existing = blobOf(record.data, String(record.mime || ""));
    if (existing) return sameBlobContent(existing, stored.data);
  }
  // Registro antigo sem hash nem bytes (caminho no disco): nome + tamanho é o
  // que dá para conferir sem abrir o arquivo de novo.
  return true;
}

export function buildLibraryRecord(input: {
  source: Exclude<FileSource, "liturgy">;
  id: string;
  name: string;
  kind: MediaKind;
  categoryId: string;
  stored: StoredFile;
  now: number;
}): Record<string, unknown> {
  const { source, id, name, kind, categoryId, stored } = input;
  const path = stored.mode === "path" ? stored.path : placeholderPath();
  const common = {
    id,
    path,
    mime: stored.mode === "blob" ? stored.data.type : mimeForName(name),
    size: stored.size,
    ...(stored.mode === "blob" ? { data: stored.data } : {}),
    ...(stored.mode === "path" && stored.sha256 ? { sha256: stored.sha256 } : {}),
  };
  if (source === "background-sound") {
    return {
      ...common,
      categoryId,
      name: name.replace(/\.[^.]+$/, ""),
      fileName: name,
      mime: common.mime || "audio/mpeg",
    };
  }
  return {
    ...common,
    name,
    type: kind,
    addedAt: input.now,
    categoryId,
    ...(kind === "image" ? { thumb: stored.mode === "path" ? Path.media(path) : path } : {}),
  };
}
