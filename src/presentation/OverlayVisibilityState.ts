export interface OverlayVisibilityState {
  enabled: boolean;
  overlay_epoch: number;
}

let lastEpoch = 0;

export function nextOverlayEpoch(): number {
  lastEpoch = Math.max(Date.now(), lastEpoch + 1);
  return lastEpoch;
}

export class OverlayVisibilityGate {
  private epoch = 0;

  accept(value: unknown): OverlayVisibilityState | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.enabled !== "boolean" || !Number.isSafeInteger(raw.overlay_epoch) ||
        (raw.overlay_epoch as number) <= this.epoch) return null;
    this.epoch = raw.overlay_epoch as number;
    return { enabled: raw.enabled, overlay_epoch: this.epoch };
  }
}
