import UserData from "@/helpers/UserData";
import { DEFAULT_CLOCK_DATE_FORMAT, formatClockDate } from "./formatClockDate";

export interface ClockOptions {
  hour_cycle?: unknown;
  time_format?: unknown;
  show_date?: unknown;
  date_format?: unknown;
}

/** As opções que o painel de formatação e a ribbon do Relógio gravam. */
export function readClockOptions(): ClockOptions {
  const get = (key: keyof ClockOptions) => UserData.get(`modules.clock.${key}`, null);
  return {
    hour_cycle: get("hour_cycle"),
    time_format: get("time_format"),
    show_date: get("show_date"),
    date_format: get("date_format"),
  };
}

export function clockIs24h(options: ClockOptions): boolean {
  return (options.hour_cycle ?? "24h") === "24h";
}

export function clockShowsSeconds(options: ClockOptions): boolean {
  return (options.time_format ?? "hh:mm:ss") === "hh:mm:ss";
}

export function clockTimeText(now: Date, localeTag: string, options: ClockOptions): string {
  return now.toLocaleTimeString(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
    ...(clockShowsSeconds(options) ? { second: "2-digit" } : {}),
    hour12: !clockIs24h(options),
  });
}

export function clockDateText(now: Date, localeTag: string, options: ClockOptions): string {
  if (options.show_date !== true) return "";
  const format = (options.date_format as string | null | undefined) ?? DEFAULT_CLOCK_DATE_FORMAT;
  return formatClockDate(now, localeTag, format, clockShowsSeconds(options));
}
