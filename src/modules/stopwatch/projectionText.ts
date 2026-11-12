import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { formatStopwatch } from "./stopwatchClock";

export function stopwatchShowsSeconds(): boolean {
  return !!$userdata.get(KEYS.MODULES.STOPWATCH.SHOW_SECONDS, true);
}

/** Mesma formatação da tela do Cronômetro (fica em `stopwatchClock`). */
export { formatStopwatch };

/** O que o Cronômetro projeta antes de ser iniciado. */
export function stopwatchIdleText(): string {
  return formatStopwatch(0, stopwatchShowsSeconds());
}
