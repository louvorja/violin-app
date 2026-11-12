/** Contagem dos temporizadores em HH:MM:SS, com sinal quando passa do zero. */
export function formatTimerSeconds(seconds: number): string {
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const sign = seconds < 0 ? "-" : "";
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function currentHourMinute(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** O que o temporizador projeta: a contagem e, abaixo, o horário-alvo quando ele é exibido. */
export function timerProjectionText(display: string, showTarget: boolean, target: string): string {
  return showTarget ? `${display}\n${target}` : display;
}
