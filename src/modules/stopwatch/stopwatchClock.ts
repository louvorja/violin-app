/**
 * Contas do Cronômetro, sem Vue — para poderem ser testadas sozinhas.
 *
 * O tempo sai do relógio do sistema, não de um contador que soma 1 por tick.
 * Somar a cada `setInterval` atrasava: com o app minimizado e sem projeção o
 * Chromium espaça os timers (backgroundThrottling da janela principal), e cada
 * tick perdido era um segundo a menos no telão. Guardando o instante em que a
 * contagem começou, um tick atrasado só demora a pintar — o valor chega certo.
 */

export type StopwatchMode = "up" | "down";

/** Nível do aviso: amarelo perto do fim, vermelho quando acabou. */
export type StopwatchAlert = "" | "warning" | "danger";

export interface StopwatchRun {
  /** Milissegundos contados em execuções anteriores (antes da última pausa). */
  baseMs: number;
  /** `Date.now()` do último Iniciar; `null` com a contagem parada. */
  startedAt: number | null;
}

export function elapsedMs(run: StopwatchRun, now: number): number {
  const live = run.startedAt === null ? 0 : Math.max(0, now - run.startedAt);
  return run.baseMs + live;
}

/**
 * Segundos que a tela mostra. No regressivo, negativo é tempo excedido —
 * só quando `overtime` está ligado; senão para no zero.
 */
export function shownSeconds(
  mode: StopwatchMode,
  targetSeconds: number,
  elapsed: number,
  overtime: boolean
): number {
  const done = Math.floor(elapsed / 1000);
  if (mode === "up") return done;
  const left = targetSeconds - done;
  return overtime ? left : Math.max(0, left);
}

/** `mm:ss`, `h:mm:ss` ou só os minutos; tempo excedido ganha um "+". */
export function formatStopwatch(seconds: number, showSeconds: boolean): string {
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const sign = seconds < 0 ? "+" : "";
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return showSeconds ? `${sign}${h}:${mm}:${ss}` : `${sign}${h}:${mm}`;
  return showSeconds ? `${sign}${mm}:${ss}` : `${sign}${mm}`;
}

/**
 * Amarelo nos últimos `warningSeconds` (0 desliga) e vermelho a partir do zero,
 * só depois de a contagem ter começado (`started`).
 * O vermelho só vale depois de a contagem ter de fato chegado ao fim
 * (`reachedEnd`): com 0 de meta e parado, a tela não deve nascer alarmada.
 */
export function stopwatchAlert(
  mode: StopwatchMode,
  seconds: number,
  warningSeconds: number,
  reachedEnd: boolean,
  started = true
): StopwatchAlert {
  // Parado na meta não avisa nada: com meta menor que o aviso (4 min de meta,
  // aviso aos 5) a borda piscaria no telão antes de alguém apertar Iniciar.
  if (mode !== "down" || !started) return "";
  if (seconds <= 0) return reachedEnd ? "danger" : "";
  if (warningSeconds > 0 && seconds <= warningSeconds) return "warning";
  return "";
}

/** Fração já percorrida no regressivo (0–1), para a barra de progresso. */
export function stopwatchProgress(targetSeconds: number, elapsed: number): number {
  if (targetSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, elapsed / 1000 / targetSeconds));
}

/** "19:52" — hora em que o regressivo zera, se seguir sem pausa. */
export function endsAtLabel(now: number, secondsLeft: number): string {
  const end = new Date(now + Math.max(0, secondsLeft) * 1000);
  return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
}
