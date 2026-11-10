import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { currentHourMinute, formatTimerSeconds, timerProjectionText } from "@/helpers/TimerText";

export function timerTargetTime(now = new Date()): string {
  return $userdata.get<string>(KEYS.MODULES.TIMER.TARGET_TIME, "") || currentHourMinute(now);
}

export function timerShowsTarget(): boolean {
  return $userdata.get<boolean>(KEYS.MODULES.TIMER.SHOW_TARGET_TIME, true) ?? true;
}

/** O que o Temporizador projeta antes de ser iniciado. */
export function timerIdleText(now = new Date()): string {
  return timerProjectionText(formatTimerSeconds(0), timerShowsTarget(), timerTargetTime(now));
}
