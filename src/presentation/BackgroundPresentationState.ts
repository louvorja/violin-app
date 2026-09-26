export interface BackgroundPresentationState {
  active: boolean;
  epoch: number;
  type?: "image" | "video";
  url?: string;
  title?: string;
}

let lastEpoch = 0;

export function nextBackgroundEpoch(): number {
  lastEpoch = Math.max(Date.now(), lastEpoch + 1);
  return lastEpoch;
}

export function readBackgroundState(value: unknown): BackgroundPresentationState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.active !== "boolean" || !Number.isSafeInteger(raw.epoch) ||
      (raw.epoch as number) < 1) return null;
  if (!raw.active) return { active: false, epoch: raw.epoch as number };
  if ((raw.type !== "image" && raw.type !== "video") ||
      typeof raw.url !== "string" || !raw.url || raw.url.length > 8_192 ||
      (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.length > 1_000)))
    return null;
  return {
    active: true,
    epoch: raw.epoch as number,
    type: raw.type,
    url: raw.url,
    title: typeof raw.title === "string" ? raw.title : "",
  };
}

/** Preserve only the transient selection saved by beta versions before epochs. */
export function readStoredBackgroundState(value: unknown): BackgroundPresentationState | null {
  const current = readBackgroundState(value);
  if (current) return current;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.epoch !== undefined) return null;
  return readBackgroundState({ ...raw, active: true, epoch: 1 });
}

export class BackgroundPresentationGate {
  private epoch = 0;

  accept(value: unknown): BackgroundPresentationState | null {
    const state = readBackgroundState(value);
    if (!state || state.epoch <= this.epoch) return null;
    this.epoch = state.epoch;
    return state;
  }
}
