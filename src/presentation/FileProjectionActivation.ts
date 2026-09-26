import type { FileProjectionState } from "@/types/Media";

export type FileActivation = FileProjectionState & { stage_epoch: number };

let lastIssuedEpoch = 0;

/** Selection order is reserved before asynchronous window/media work starts. */
export function nextFileProjectionEpoch(): number {
  lastIssuedEpoch = Math.max(Date.now(), lastIssuedEpoch + 1);
  return lastIssuedEpoch;
}

export function readFileActivation(value: unknown): FileActivation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.stage_epoch) || (raw.stage_epoch as number) < 1 ||
      typeof raw.url !== "string" || !raw.url || raw.url.length > 8_192 ||
      !["image", "pdf", "video", "youtube"].includes(raw.type as string) ||
      (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.length > 1_000)) ||
      (raw.playback_id !== undefined &&
        (typeof raw.playback_id !== "string" || !raw.playback_id || raw.playback_id.length > 128)) ||
      (raw.page !== undefined && (!Number.isSafeInteger(raw.page) || (raw.page as number) < 1)) ||
      (raw.totalPages !== undefined &&
        (!Number.isSafeInteger(raw.totalPages) || (raw.totalPages as number) < 1))) return null;
  if (raw.libRef !== undefined) {
    if (!raw.libRef || typeof raw.libRef !== "object" || Array.isArray(raw.libRef)) return null;
    const ref = raw.libRef as Record<string, unknown>;
    if (typeof ref.id !== "string" || !ref.id || ref.id.length > 256 ||
        (ref.table !== undefined && (typeof ref.table !== "string" || ref.table.length > 128))) return null;
  }
  return {
    active: true,
    type: raw.type as string,
    url: raw.url,
    title: typeof raw.title === "string" ? raw.title : "",
    stage_epoch: raw.stage_epoch as number,
    ...(typeof raw.playback_id === "string" ? { playback_id: raw.playback_id } : {}),
    ...(typeof raw.page === "number" ? { page: raw.page } : {}),
    ...(typeof raw.totalPages === "number" ? { totalPages: raw.totalPages } : {}),
    ...(raw.libRef ? { libRef: raw.libRef as FileProjectionState["libRef"] } : {}),
  };
}

/** Accept a new selection or a matching identity upgrade within that selection. */
export class FileProjectionActivationGate {
  private current: FileActivation | null = null;
  private retired = false;

  accept(value: unknown): FileActivation | null {
    const activation = readFileActivation(value);
    if (!activation) return null;
    const current = this.current;
    if (current) {
      if (activation.stage_epoch < current.stage_epoch) return null;
      if (activation.stage_epoch === current.stage_epoch) {
        if (this.retired || activation.url !== current.url || activation.type !== current.type ||
            (current.playback_id && activation.playback_id !== current.playback_id)) return null;
        // Only the initial video packet may gain its playback identity. Replaying
        // the same activation could reset a PDF page or restart a player.
        if (!activation.playback_id || current.playback_id) return null;
      }
    }
    this.current = activation;
    this.retired = false;
    return activation;
  }

  retire(): void { this.retired = true; }
}
