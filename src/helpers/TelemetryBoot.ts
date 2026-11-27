import { KEYS_LS } from "@/constants/LocalStorageKeys";

interface BootCheckpoint {
  at: number;
  last_stage: string;
  stages: Record<string, number>;
}
type Emit = (event: string, properties: Record<string, unknown>) => void;

const MAIN_MARKS = [
  "script_start",
  "storage_ready",
  "monitor_start",
  "app_ready",
  "window_create",
  "window_created",
] as const;
const MAX_BOOT_MS = 3_600_000;

function bounded(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    ? Math.round(value)
    : undefined;
}

/**
 * Abertura medida desde a criação do processo, não desde a navegação da janela.
 * Apenas números reconhecidos do processo principal atravessam a fronteira IPC.
 */
export function mainBootProperties(
  value: unknown,
  now: number,
  pageStartedAt: number
): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const info = value as Record<string, unknown>;
  const origin = info.origin;
  if (typeof origin !== "number" || !(origin > 0) || origin > now || now - origin > MAX_BOOT_MS)
    return {};
  const result: Record<string, unknown> = {
    process_elapsed_ms: Math.round(now - origin),
    // "script": o sistema não informou a criação do processo; conta do início do main.cjs.
    process_origin: info.origin_source === "process" ? "process" : "script",
  };
  const page = bounded(pageStartedAt - origin, MAX_BOOT_MS);
  if (page !== undefined) result.page_start_ms = page;
  const marks =
    info.marks && typeof info.marks === "object" ? (info.marks as Record<string, unknown>) : {};
  for (const name of MAIN_MARKS) {
    const at = bounded(marks[name], MAX_BOOT_MS);
    if (at !== undefined) result[`main_${name}_ms`] = at;
  }
  const uptime = bounded(info.system_uptime_s, 315_360_000);
  if (uptime !== undefined) result.system_uptime_s = uptime;
  const free = bounded(info.system_free_memory_mb, 16_777_216);
  if (free !== undefined) result.system_free_memory_mb = free;
  return result;
}

/** Only stage names/timings are persisted. Auxiliary windows use their own sessionStorage. */
export class TelemetryBoot {
  private checkpoint: BootCheckpoint | null = null;
  private completed = false;
  constructor(
    private storage: () => Storage | undefined,
    private emit: Emit,
    private extra: () => Record<string, unknown> = () => ({})
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
      this.emit("app_boot_summary", {
        status: "completed",
        ...this.checkpoint,
        ...this.extra(),
      });
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
