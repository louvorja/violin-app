export interface LibrasVisibilityState {
  enabled: boolean;
  musics: boolean;
  bible: boolean;
  obs: boolean;
  libras_epoch: number;
}

let lastEpoch = 0;

export function nextLibrasEpoch(): number {
  lastEpoch = Math.max(Date.now(), lastEpoch + 1);
  return lastEpoch;
}

export class LibrasVisibilityGate {
  private epoch = 0;

  accept(value: unknown): LibrasVisibilityState | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (!Number.isSafeInteger(raw.libras_epoch) || (raw.libras_epoch as number) <= this.epoch ||
        typeof raw.enabled !== "boolean" || typeof raw.musics !== "boolean" ||
        typeof raw.bible !== "boolean" || typeof raw.obs !== "boolean") return null;
    this.epoch = raw.libras_epoch as number;
    return {
      enabled: raw.enabled, musics: raw.musics, bible: raw.bible, obs: raw.obs,
      libras_epoch: this.epoch,
    };
  }
}
