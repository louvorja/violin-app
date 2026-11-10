import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

export function stopwatchShowsSeconds(): boolean {
  return !!$userdata.get(KEYS.MODULES.STOPWATCH.SHOW_SECONDS, true);
}

export function formatStopwatch(seconds: number, showSeconds: boolean): string {
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const sign = seconds < 0 ? "-" : "";
  if (h > 0) {
    return showSeconds
      ? `${sign}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${sign}${h}:${String(m).padStart(2, "0")}`;
  }
  return showSeconds
    ? `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${sign}${String(m).padStart(2, "0")}`;
}

/** O que o Cronômetro projeta antes de ser iniciado. */
export function stopwatchIdleText(): string {
  return formatStopwatch(0, stopwatchShowsSeconds());
}
