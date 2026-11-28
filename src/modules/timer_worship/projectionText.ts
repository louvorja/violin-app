import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { currentHourMinute, formatTimerSeconds, timerProjectionText } from "@/helpers/TimerText";
import type { CountdownDefineBy } from "./countdown";

export type WorshipSecondLine = "target" | "clock" | "both" | "none";

export const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 24 * 60;

export function worshipTargetTime(now = new Date()): string {
  const saved = $userdata.get<string>(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, "");
  return typeof saved === "string" && /^\d{2}:\d{2}$/.test(saved) ? saved : currentHourMinute(now);
}

/** A antiga caixinha "Exibir hora na projeção"; hoje é o "Só a contagem" do seletor. */
function legacyShowsTarget(): boolean {
  return $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SHOW_TARGET_TIME, true) !== false;
}

/** Hora de término (padrão, como sempre foi) ou duração em minutos. */
export function worshipDefineBy(): CountdownDefineBy {
  return $userdata.get<string>(KEYS.MODULES.TIMER_WORSHIP.DEFINE_BY, "end") === "duration"
    ? "duration"
    : "end";
}

export function worshipDurationMinutes(): number {
  const value = Number(
    $userdata.get<number>(KEYS.MODULES.TIMER_WORSHIP.DURATION_MINUTES, DEFAULT_DURATION_MINUTES)
  );
  if (!Number.isFinite(value) || value < 1) return DEFAULT_DURATION_MINUTES;
  return Math.min(Math.round(value), MAX_DURATION_MINUTES);
}

/**
 * O que vai abaixo da contagem. Quem nunca mexeu no seletor herda a caixinha
 * antiga: desligada vira "Só a contagem".
 */
export function worshipSecondLine(): WorshipSecondLine {
  const value = $userdata.get<string>(KEYS.MODULES.TIMER_WORSHIP.SECOND_LINE, "");
  if (value === "target" || value === "clock" || value === "both" || value === "none") return value;
  return legacyShowsTarget() ? "target" : "none";
}

/** Relógio atual, HH:MM:SS — o "relógio sempre ativo" do Cronômetro de Culto do Classic. */
export function clockText(now = new Date()): string {
  return `${currentHourMinute(now)}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/** Linha(s) abaixo da contagem: término, relógio, os dois ou nada. */
export function worshipExtraLines(endTime: string, now = new Date()): string {
  const line = worshipSecondLine();
  if (line === "none") return "";
  if (line === "clock") return clockText(now);
  if (line === "both") return `${endTime}\n${clockText(now)}`;
  return endTime;
}

/** Hora de término antes de iniciar: a digitada, ou agora + duração. */
function idleEndTime(now: Date): string {
  if (worshipDefineBy() === "duration") {
    return currentHourMinute(new Date(now.getTime() + worshipDurationMinutes() * 60_000));
  }
  return worshipTargetTime(now);
}

/** O que o Temporizador de Culto projeta antes de ser iniciado. */
export function worshipIdleText(now = new Date()): string {
  const extra = worshipExtraLines(idleEndTime(now), now);
  return timerProjectionText(formatTimerSeconds(0), extra !== "", extra);
}
