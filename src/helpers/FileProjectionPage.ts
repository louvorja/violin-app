/** A page event belongs only to the file currently on stage. */
export function newFileProjectionId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fileProjectionPageFor(
  payload: unknown,
  activePlaybackId: string | undefined
): { page: number; totalPages?: number; source?: "operator" | "projection" } | null {
  if (!activePlaybackId || !payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (value.playback_id !== activePlaybackId ||
      !Number.isSafeInteger(value.page) || (value.page as number) < 1) return null;
  if (value.totalPages !== undefined &&
      (!Number.isSafeInteger(value.totalPages) || (value.totalPages as number) < 1)) return null;
  if (value.source !== undefined && value.source !== "operator" && value.source !== "projection") return null;
  return {
    page: value.page as number,
    ...(value.totalPages === undefined ? {} : { totalPages: value.totalPages as number }),
    ...(value.source === undefined ? {} : { source: value.source as "operator" | "projection" }),
  };
}
