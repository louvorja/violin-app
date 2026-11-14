/**
 * Payload do arrasto de um card para um chip de categoria.
 *
 * O DnD nativo usa um MIME próprio para não se confundir com arquivos
 * arrastados de fora (que chegam em `dataTransfer.files`). O mesmo payload é
 * lido no drop nativo; no toque, o composable monta o objeto diretamente.
 */
export const MEDIA_CATEGORY_DRAG_MIME = "application/x-louvorja-category-item";

export type MediaCategoryDragSource =
  | "media_library"
  | "background_projection"
  | "background_sound"
  | "custom_online_videos";

export interface MediaCategoryDragPayload {
  source: MediaCategoryDragSource;
  id: string;
}

const SOURCES: ReadonlySet<string> = new Set<MediaCategoryDragSource>([
  "media_library",
  "background_projection",
  "background_sound",
  "custom_online_videos",
]);

export function writeMediaCategoryDrag(
  dataTransfer: DataTransfer | null,
  payload: MediaCategoryDragPayload
): void {
  if (!dataTransfer) return;
  dataTransfer.setData(MEDIA_CATEGORY_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "move";
}

/** `dragover` só pode ler os tipos, não o conteúdo, em vários navegadores. */
export function hasMediaCategoryDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes(MEDIA_CATEGORY_DRAG_MIME);
}

export function readMediaCategoryDrag(
  dataTransfer: DataTransfer | null
): MediaCategoryDragPayload | null {
  if (!dataTransfer) return null;

  let raw = "";
  try {
    raw = dataTransfer.getData(MEDIA_CATEGORY_DRAG_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.source !== "string" || !SOURCES.has(record.source)) return null;
  if (typeof record.id !== "string" || !record.id) return null;

  return { source: record.source as MediaCategoryDragSource, id: record.id };
}
