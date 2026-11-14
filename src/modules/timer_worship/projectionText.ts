import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { currentHourMinute, formatTimerSeconds, timerProjectionText } from "@/helpers/TimerText";

export function worshipTargetTime(now = new Date()): string {
  const saved = $userdata.get<string>(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, "");
  return typeof saved === "string" && /^\d{2}:\d{2}$/.test(saved) ? saved : currentHourMinute(now);
}

export function worshipShowsTarget(): boolean {
  return $userdata.get<boolean>(KEYS.MODULES.TIMER_WORSHIP.SHOW_TARGET_TIME, true) ?? true;
}

/** O que o Temporizador de Culto projeta antes de ser iniciado. */
export function worshipIdleText(now = new Date()): string {
  return timerProjectionText(formatTimerSeconds(0), worshipShowsTarget(), worshipTargetTime(now));
}
