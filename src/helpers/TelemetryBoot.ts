import { KEYS_LS } from "@/constants/LocalStorageKeys";

interface BootCheckpoint {
  at: number;
  last_stage: string;
  stages: Record<string, number>;
}
type Emit = (event: string, properties: Record<string, unknown>) => void;

/** Only stage names/timings are persisted. Auxiliary windows use their own sessionStorage. */
export class TelemetryBoot {
  private checkpoint: BootCheckpoint | null = null;
  private completed = false;
  constructor(
    private storage: () => Storage | undefined,
    private emit: Emit
  ) {}

  record(stage: unknown, duration: unknown): void {
    if (this.completed || typeof stage !== "string" || !/^[a-z_]{1,64}$/.test(stage)) return;
    const now = Date.now();
    if (!this.checkpoint) {
      try {
        const raw = this.storage()?.getItem(KEYS_LS.TELEMETRY_BOOT_STATE);
        const previous = raw && raw.length < 2048 ? JSON.parse(raw) : null;
        if (
          previous &&
          typeof previous.at === "number" &&
          previous.at <= now &&
          now - previous.at < 86_400_000 &&
          typeof previous.last_stage === "string" &&
          /^[a-z_]{1,64}$/.test(previous.last_stage)
        ) {
          this.emit("app_boot_interrupted", {
            last_stage: previous.last_stage,
            previous_started_at: new Date(previous.at).toISOString(),
          });
        }
      } catch {
        /* storage can be unavailable during the incident being diagnosed */
      }
      this.checkpoint = { at: now, last_stage: stage, stages: {} };
    }
    this.checkpoint.last_stage = stage;
    if (
      typeof duration === "number" &&
      Number.isFinite(duration) &&
      duration >= 0 &&
      Object.keys(this.checkpoint.stages).length < 16
    ) {
      this.checkpoint.stages[stage] = Math.round(duration);
    }
    if (stage === "first_paint") {
      this.completed = true;
      this.emit("app_boot_summary", { status: "completed", ...this.checkpoint });
      this.remove();
    } else {
      try {
        this.storage()?.setItem(KEYS_LS.TELEMETRY_BOOT_STATE, JSON.stringify(this.checkpoint));
      } catch {
        /* best effort */
      }
    }
  }

  snapshot(): Record<string, unknown> {
    return this.checkpoint
      ? {
          boot_last_stage: this.checkpoint.last_stage,
          boot_stages: { ...this.checkpoint.stages },
          boot_completed: this.completed,
        }
      : {};
  }
  private remove(): void {
    try {
      this.storage()?.removeItem(KEYS_LS.TELEMETRY_BOOT_STATE);
    } catch {
      /* best effort */
    }
  }
  clear(): void {
    this.remove();
    this.checkpoint = null;
    this.completed = false;
  }
}
